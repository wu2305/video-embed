"""Stateless spot worker: claim, process, checkpoint, report.

The loop mirrors section 4.4: a completed file found in the checkpoint is
marked done and skipped, so a preempted worker costs at most one file of
re-work.  While a task runs, a background thread keeps its lease alive, so only
a vanished machine (not a slow video) loses its claim.  Machines exit on their
own when :meth:`WorkQueue.claim` returns ``None``.
"""

from __future__ import annotations

import os
import socket
import threading
import time
import uuid
from pathlib import Path

from .backends import Backend, build_backend
from .checkpoint import IncrementalCheckpoint
from .config import Layout, Settings, media_kind
from .queue import WorkQueue
from .scan import ManifestEntry, read_manifest
from .stages import extract_entry, infer_entry, prepare_entry


class _Heartbeat:
    """Refresh one task's lease from a background thread while it is processed.

    The thread opens its own queue connection: the worker's connection is not
    safe to share while the main thread is inside a claim transaction.
    """

    def __init__(
        self,
        db_path: Path,
        task_id: str,
        worker_id: str,
        interval: float,
        journal_mode: str = "WAL",
    ) -> None:
        self._db_path = db_path
        self._journal_mode = journal_mode
        self._task_id = task_id
        self._worker_id = worker_id
        self._interval = interval
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, name="lease-heartbeat", daemon=True)

    def _run(self) -> None:
        queue = WorkQueue(self._db_path, journal_mode=self._journal_mode)
        try:
            while not self._stop.wait(self._interval):
                queue.heartbeat(self._task_id, self._worker_id)
        except Exception:  # pragma: no cover - the lease then simply expires
            pass
        finally:
            queue.close()

    def __enter__(self) -> "_Heartbeat":
        self._thread.start()
        return self

    def __exit__(self, *exc: object) -> None:
        self._stop.set()
        self._thread.join(timeout=self._interval + 5)


# Stage records a stage reads, which another machine may have written.
_INPUT_STAGES = {"extract": ("prepare",), "infer": ("extract", "prepare")}


class Worker:
    def __init__(
        self,
        stage: str,
        layout: Layout,
        settings: Settings,
        *,
        worker_id: str | None = None,
        backend: Backend | None = None,
        lease_seconds: float = 300.0,
        heartbeat_every: float = 30.0,
        shard: int | None = None,
        max_tasks: int | None = None,
    ) -> None:
        self.stage = stage
        self.layout = layout.ensure()
        self.settings = settings
        self.worker_id = worker_id or f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"
        self.backend = backend
        self._owns_backend = False
        # Beat several times per lease so one missed beat cannot expire it.
        self.heartbeat_every = min(heartbeat_every, lease_seconds / 3)
        self.shard = shard
        self.max_tasks = max_tasks
        self.queue = WorkQueue(
            layout.queue_db,
            lease_seconds=lease_seconds,
            journal_mode=layout.queue_journal_mode,
        )
        self.checkpoint = IncrementalCheckpoint(
            layout.worker_checkpoint_db,
            stage=stage,
            shard_dir=layout.shard_dir,
            namespace=layout.namespace,
        )
        # With a machine-local database, other machines only see this worker's
        # progress through shards, and this worker only sees theirs by importing.
        self.durable = layout.local_dir is not None
        if self.durable:
            self.checkpoint.import_shards()
        self._entries: dict[str, ManifestEntry] = {
            entry.path: entry for entry in read_manifest(layout)
        }
        self.processed = 0
        self.skipped = 0
        self.failed = 0
        self.lost = 0

    # -------------------------------------------------------------- helpers

    def _entry(self, task_path: str, digest: str) -> ManifestEntry:
        entry = self._entries.get(task_path)
        if entry is not None:
            return entry
        return ManifestEntry(
            path=task_path,
            rel_path=os.path.basename(task_path),
            kind=media_kind(task_path) or "image",
            size=0,
            digest=digest,
            fast_digest="",
            canonical_time=0.0,
            time_source="mtime",
            mtime=0.0,
        )

    def _ensure_backend(self) -> Backend:
        if self.backend is None:
            self.backend = build_backend(self.settings)
            self._owns_backend = True
        return self.backend

    def _import_inputs(self, entry: ManifestEntry) -> None:
        """Pull earlier-stage records written by other machines, if any are missing."""
        for earlier in _INPUT_STAGES.get(self.stage, ()):
            if not self.checkpoint.has(entry.path, entry.digest, stage=earlier):
                self.checkpoint.import_shards()
                return

    def _process(self, task) -> None:
        entry = self._entry(task.file_path, task.digest)
        if self.durable:
            self._import_inputs(entry)
        if self.stage == "prepare":
            # Only videos need a backend (ASR); images never load the models.
            backend = self._ensure_backend() if entry.kind == "video" else self.backend
            prepare_entry(entry, self.layout, self.settings, self.checkpoint, backend)
        elif self.stage == "extract":
            extract_entry(entry, self.layout, self.settings, self.checkpoint)
        elif self.stage == "infer":
            infer_entry(
                entry, self.layout, self.settings, self.checkpoint, self._ensure_backend()
            )
        else:
            raise ValueError(f"unknown stage: {self.stage}")

    # ----------------------------------------------------------------- loop

    def run_once(self) -> bool:
        """Process at most one task.  Returns ``False`` when the stage is drained."""
        task = self.queue.claim(self.stage, self.worker_id, shard=self.shard)
        if task is None:
            return False

        if self.checkpoint.has(task.file_path, task.digest, stage=self.stage):
            self._settle(self.queue.mark_done(task.task_id, self.worker_id))
            self.skipped += 1
            return True

        try:
            with _Heartbeat(
                self.layout.queue_db,
                task.task_id,
                self.worker_id,
                self.heartbeat_every,
                self.layout.queue_journal_mode,
            ):
                self._process(task)
                if self.durable:
                    # A task is only "done" once its record is in a shard the next
                    # stage's workers can read; otherwise a machine that vanishes
                    # after marking done would take the record with it.
                    self.checkpoint.sync()
        except Exception as exc:
            self._settle(
                self.queue.mark_failed(task.task_id, f"{type(exc).__name__}: {exc}", self.worker_id)
            )
            self.failed += 1
        else:
            self._settle(self.queue.mark_done(task.task_id, self.worker_id))
            self.processed += 1
        return True

    def _settle(self, applied: bool) -> None:
        """Count results the queue refused because the lease was lost mid-task.

        The checkpoint write already happened and is idempotent, so a lost lease
        wastes work but never corrupts it.
        """
        if not applied:
            self.lost += 1

    def run(self, max_idle_polls: int = 1) -> dict:
        """Drain the stage, exiting after consecutive empty claims."""
        idle = 0
        while True:
            if self.max_tasks is not None and self.processed + self.skipped >= self.max_tasks:
                break
            progressed = self.run_once()
            if not progressed:
                idle += 1
                if idle >= max_idle_polls:
                    break
                time.sleep(1.0)
            else:
                idle = 0
        summary = {
            "worker_id": self.worker_id,
            "stage": self.stage,
            "processed": self.processed,
            "skipped": self.skipped,
            "failed": self.failed,
            "lost": self.lost,
            "queue": self.queue.stats(self.stage),
        }
        self.close()
        return summary

    def close(self) -> None:
        if self._owns_backend and self.backend is not None:
            self.backend.close()
            self.backend = None
            self._owns_backend = False
        self.checkpoint.close()
        self.queue.close()
