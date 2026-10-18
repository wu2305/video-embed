"""Stateless spot worker: claim, process, checkpoint, report.

The loop mirrors section 4.4 exactly: a completed file found in the checkpoint
is marked done and skipped, so a preempted worker costs at most one file of
re-work.  Machines exit on their own when :meth:`WorkQueue.claim` returns
``None``.
"""

from __future__ import annotations

import os
import socket
import time
import uuid

from .backends import Backend, build_backend
from .checkpoint import IncrementalCheckpoint
from .config import Layout, Settings
from .scan import ManifestEntry, read_manifest
from .stages import extract_entry, infer_entry, prepare_entry


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
        from .queue import WorkQueue

        self.stage = stage
        self.layout = layout.ensure()
        self.settings = settings
        self.worker_id = worker_id or f"{socket.gethostname()}-{os.getpid()}-{uuid.uuid4().hex[:6]}"
        self.backend = backend
        self.heartbeat_every = heartbeat_every
        self.shard = shard
        self.max_tasks = max_tasks
        self.queue = WorkQueue(layout.queue_db, lease_seconds=lease_seconds)
        self.checkpoint = IncrementalCheckpoint(
            layout.checkpoint_db,
            stage=stage,
            shard_dir=layout.shard_dir,
            namespace=layout.namespace,
        )
        self._entries: dict[str, ManifestEntry] = {
            entry.path: entry for entry in read_manifest(layout)
        }
        self._last_heartbeat = 0.0
        self.processed = 0
        self.skipped = 0
        self.failed = 0

    # -------------------------------------------------------------- helpers

    def _entry(self, task_path: str, digest: str) -> ManifestEntry:
        entry = self._entries.get(task_path)
        if entry is not None:
            return entry
        return ManifestEntry(
            path=task_path,
            rel_path=os.path.basename(task_path),
            kind="image",
            size=0,
            digest=digest,
            fast_digest="",
            canonical_time=0.0,
            time_source="mtime",
            mtime=0.0,
        )

    def _process(self, task) -> None:
        entry = self._entry(task.file_path, task.digest)
        if self.stage == "prepare":
            prepare_entry(entry, self.layout, self.settings, self.checkpoint, self.backend)
        elif self.stage == "extract":
            extract_entry(entry, self.layout, self.settings, self.checkpoint)
        elif self.stage == "infer":
            if self.backend is None:
                self.backend = build_backend(self.settings)
            infer_entry(
                entry, self.layout, self.settings, self.checkpoint, self.backend
            )
        else:
            raise ValueError(f"unknown stage: {self.stage}")

    def _maybe_heartbeat(self, file_id: str, force: bool = False) -> None:
        now = time.time()
        if force or now - self._last_heartbeat >= self.heartbeat_every:
            self.queue.heartbeat(file_id)
            self._last_heartbeat = now

    # ----------------------------------------------------------------- loop

    def run_once(self) -> bool:
        """Process at most one task.  Returns ``False`` when the stage is drained."""
        task = self.queue.claim(self.stage, self.worker_id, shard=self.shard)
        if task is None:
            return False

        if self.checkpoint.has(task.file_path, task.digest, stage=self.stage):
            self.queue.mark_done(task.file_id)
            self.skipped += 1
            return True

        try:
            self._process(task)
            self.queue.mark_done(task.file_id)
            self.processed += 1
        except Exception as exc:
            self.queue.mark_failed(task.file_id, f"{type(exc).__name__}: {exc}")
            self.failed += 1
        self._maybe_heartbeat(task.file_id, force=True)
        return True

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
            "queue": self.queue.stats(self.stage),
        }
        self.close()
        return summary

    def close(self) -> None:
        self.checkpoint.close()
        self.queue.close()
