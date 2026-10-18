"""Coordinator: stage sequencing, watchdog and single-machine finalisation.

Stages 1-3 are drained by spot workers; this module only enqueues their work and
polls for completion.  Stages 4-5 (cluster, export) run here, on one machine,
after the previous stage reports 100% done — exactly the sequence in section 4.5.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from typing import Callable, Iterable

from .checkpoint import IncrementalCheckpoint
from .clustering import cluster_units
from .config import ALL_STAGES, FINAL_STAGES, Layout, Settings
from .export import collect_units, export_snapshot
from .queue import WorkQueue
from .scan import ManifestEntry, read_manifest

@dataclass
class Coordinator:
    layout: Layout
    settings: Settings
    poll_interval: float = 5.0
    lease_seconds: float = 300.0
    log: Callable[[str], None] = print
    _queue: WorkQueue | None = field(default=None, repr=False)

    @property
    def queue(self) -> WorkQueue:
        if self._queue is None:
            self._queue = WorkQueue(self.layout.queue_db, lease_seconds=self.lease_seconds)
        return self._queue

    # ------------------------------------------------------------ enqueue

    def enqueue_stage(
        self,
        stage: str,
        entries: Iterable[ManifestEntry] | None = None,
        *,
        n_shards: int = 1,
    ) -> int:
        entries = list(entries if entries is not None else read_manifest(self.layout))
        triples = [(entry.digest, entry.path, entry.digest) for entry in entries]
        count = self.queue.enqueue(stage, triples, n_shards=n_shards)
        self.log(f"enqueued {count} files for stage '{stage}' across {n_shards} shard(s)")
        return count

    # --------------------------------------------------------------- poll

    def wait_for_stage(self, stage: str, timeout: float | None = None) -> bool:
        """Poll until no pending/claimed/failed rows remain for ``stage``."""
        started = time.time()
        while True:
            self.queue.reclaim_stale(self.lease_seconds)
            stats = self.queue.stats(stage)
            remaining = self.queue.remaining(stage)
            if remaining == 0:
                self.log(f"stage '{stage}' complete: {stats}")
                return True
            if timeout is not None and time.time() - started > timeout:
                self.log(f"stage '{stage}' timed out with {stats}")
                return False
            time.sleep(self.poll_interval)

    # ----------------------------------------------------------- finalise

    def run_cluster(self) -> dict:
        units = self._all_units()
        catalog = cluster_units(units, self.layout, self.settings)
        self.log(
            f"clustered {catalog.get('person_count', 0)} persons from {len(units)} units"
        )
        return catalog

    def _all_units(self) -> list[dict]:
        checkpoint = IncrementalCheckpoint(
            self.layout.checkpoint_db,
            stage="infer",
            shard_dir=self.layout.shard_dir,
            auto_sync=False,
            namespace=self.layout.namespace,
        )
        try:
            checkpoint.import_shards()
            records = [record for _path, _digest, record in checkpoint.records("infer")]
        finally:
            checkpoint.close(sync=False)
        units = collect_units(records)
        self.log(f"collected {len(units)} units from stage 3")
        return units

    def run_export(self) -> dict:
        units = self._all_units()
        catalog = None
        if self.layout.persons.exists():
            catalog = json.loads(self.layout.persons.read_text(encoding="utf-8"))
        labels = None
        if self.layout.person_labels.exists():
            labels = json.loads(self.layout.person_labels.read_text(encoding="utf-8"))
        units = collect_units([{"units": units}], labels)
        manifest = export_snapshot(
            units,
            self.layout,
            self.settings,
            catalog=catalog,
            manifest_extra={"coordinator": "local"},
        )
        self.log(
            f"exported snapshot {manifest['snapshot']} with {manifest['unit_count']} units"
        )
        return manifest

    # ------------------------------------------------------------- driver

    def run(self, stages: Iterable[str] = ALL_STAGES, timeout: float | None = None) -> dict:
        """Enqueue and wait for worker stages, then cluster and export."""
        results: dict = {}
        for stage in stages:
            if stage in FINAL_STAGES:
                if stage == "cluster":
                    results[stage] = self.run_cluster()
                else:
                    results[stage] = self.run_export()
                continue
            self.enqueue_stage(stage)
            results[stage] = {"complete": self.wait_for_stage(stage, timeout=timeout)}
        return results

    def close(self) -> None:
        if self._queue is not None:
            self._queue.close()
            self._queue = None
