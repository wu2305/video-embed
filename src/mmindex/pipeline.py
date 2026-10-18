"""Single-machine pipeline driver.

This is the local CPU port end to end: scan → prepare → extract → infer →
cluster → export, with an optional search step.  It uses the same stage
functions as the distributed workers, so a library indexed locally and one
indexed by spot machines produce identical snapshots.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Callable, Iterable

from .backends import Backend, build_backend
from .checkpoint import IncrementalCheckpoint
from .clustering import cluster_units
from .config import ALL_STAGES, Layout, Settings
from .export import collect_units, export_snapshot
from .scan import read_manifest, scan
from .stages import run_stage


class Pipeline:
    def __init__(
        self,
        layout: Layout,
        settings: Settings,
        *,
        backend: Backend | None = None,
        log: Callable[[str], None] = print,
    ) -> None:
        self.layout = layout.ensure()
        self.settings = settings
        self.backend = backend
        self.log = log
        self._checkpoints: dict[str, IncrementalCheckpoint] = {}

    def checkpoint(self, stage: str) -> IncrementalCheckpoint:
        if stage not in self._checkpoints:
            self._checkpoints[stage] = IncrementalCheckpoint(
                self.layout.checkpoint_db,
                stage=stage,
                shard_dir=self.layout.shard_dir,
                namespace=self.layout.namespace,
            )
        return self._checkpoints[stage]

    def _backend(self) -> Backend:
        if self.backend is None:
            self.backend = build_backend(self.settings)
            self.log(f"using backend '{self.backend.name}'")
        return self.backend

    # --------------------------------------------------------------- stages

    def run_scan(self, media_root: str | Path, *, exclude: Iterable[str] = ()) -> dict:
        started = time.time()
        result = scan(media_root, self.layout, exclude=exclude)
        summary = {
            "canonical": len(result.canonical),
            "duplicates": sum(len(v) - 1 for v in result.duplicates.values()),
            "skipped": len(result.skipped),
            "elapsed": round(time.time() - started, 2),
        }
        self.log(
            f"scan: {summary['canonical']} canonical, {summary['duplicates']} duplicates, "
            f"{summary['skipped']} skipped in {summary['elapsed']}s"
        )
        return summary

    def run_stage(self, stage: str) -> dict:
        entries = read_manifest(self.layout)
        if not entries:
            raise RuntimeError("manifest is empty; run scan first")
        backend = self._backend() if stage in ("prepare", "infer") else None
        started = time.time()
        result = run_stage(
            stage,
            entries,
            self.layout,
            self.settings,
            self.checkpoint(stage),
            backend=backend,
        )
        result["elapsed"] = round(time.time() - started, 2)
        self.log(
            f"{stage}: {result['done']} done, {result['skipped']} skipped, "
            f"{len(result['failed'])} failed in {result['elapsed']}s"
        )
        for failure in result["failed"][:10]:
            self.log(f"  failed: {failure['path']}: {failure['error']}")
        return result

    def run_cluster(self) -> dict:
        units = self.collect_units()
        catalog = cluster_units(units, self.layout, self.settings)
        self.log(
            f"cluster: {catalog.get('person_count', 0)} persons, "
            f"{catalog.get('noise_faces', 0)} noise faces"
        )
        return catalog

    def collect_units(self) -> list[dict]:
        checkpoint = self.checkpoint("infer")
        records = [record for _path, _digest, record in checkpoint.records("infer")]
        return collect_units(records)

    def run_export(self) -> dict:
        units = self.collect_units()
        catalog = None
        if self.layout.persons.exists():
            catalog = json.loads(self.layout.persons.read_text(encoding="utf-8"))
        labels = None
        if self.layout.person_labels.exists():
            labels = json.loads(self.layout.person_labels.read_text(encoding="utf-8"))
        units = collect_units([{"units": units}], labels)
        manifest = export_snapshot(
            units, self.layout, self.settings, catalog=catalog
        )
        self.log(
            f"export: snapshot {manifest['snapshot']} with {manifest['unit_count']} units"
        )
        return manifest

    # ----------------------------------------------------------------- full

    def run_all(
        self,
        media_root: str | Path,
        *,
        stages: Iterable[str] = ALL_STAGES,
        exclude: Iterable[str] = (),
        skip_scan: bool = False,
    ) -> dict:
        results: dict = {}
        stages = tuple(stages)
        if not skip_scan:
            results["scan"] = self.run_scan(media_root, exclude=exclude)
        for stage in stages:
            if stage == "cluster":
                results["cluster"] = self.run_cluster()
            elif stage == "export":
                results["export"] = self.run_export()
            else:
                results[stage] = self.run_stage(stage)
        return results

    def close(self) -> None:
        for checkpoint in self._checkpoints.values():
            checkpoint.close()
        self._checkpoints.clear()
        if self.backend is not None:
            self.backend.close()
