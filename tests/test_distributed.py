from __future__ import annotations

import json

import numpy as np
import pytest

from mmindex.coordinator import Coordinator
from mmindex.pipeline import Pipeline
from mmindex.queue import WorkQueue
from mmindex.scan import read_manifest
from mmindex.worker import Worker


def test_workers_drain_stage_and_coordinator_finalises(media_tree, layout, settings):
    pipeline = Pipeline(layout, settings)
    try:
        pipeline.run_scan(media_tree)
    finally:
        pipeline.close()
    entries = read_manifest(layout)
    assert len(entries) == 3

    coordinator = Coordinator(layout, settings, poll_interval=0.01, log=lambda _msg: None)
    try:
        count = coordinator.enqueue_stage("prepare", n_shards=2)
        assert count == 3

        workers = [
            Worker("prepare", layout, settings, worker_id=f"w{i}", shard=i)
            for i in range(2)
        ]
        summaries = [worker.run() for worker in workers]
        assert sum(s["processed"] for s in summaries) == 3
        assert coordinator.wait_for_stage("prepare", timeout=5)
    finally:
        coordinator.close()

    queue = WorkQueue(layout.queue_db)
    try:
        assert queue.is_complete("prepare")
    finally:
        queue.close()


def test_reclaimed_work_is_a_noop(media_tree, layout, settings):
    """A preempted worker's file is re-claimed and skipped, not reprocessed."""
    pipeline = Pipeline(layout, settings)
    try:
        pipeline.run_scan(media_tree)
        pipeline.run_stage("prepare")
    finally:
        pipeline.close()

    coordinator = Coordinator(layout, settings, poll_interval=0.01, log=lambda _msg: None)
    try:
        coordinator.enqueue_stage("prepare")
        queue = coordinator.queue
        task = queue.claim("prepare", "doomed-worker")
        assert task is not None
        queue.reclaim_stale(lease_seconds=-1)
    finally:
        coordinator.close()

    worker = Worker("prepare", layout, settings, worker_id="replacement")
    summary = worker.run()
    assert summary["processed"] == 0
    assert summary["skipped"] == 3


def test_coordinator_cluster_and_export(media_tree, layout, settings):
    pipeline = Pipeline(layout, settings)
    try:
        pipeline.run_all(media_tree, stages=["prepare", "extract", "infer"])
    finally:
        pipeline.close()

    coordinator = Coordinator(layout, settings, poll_interval=0.01, log=lambda _msg: None)
    try:
        catalog = coordinator.run_cluster()
        manifest = coordinator.run_export()
    finally:
        coordinator.close()

    assert "persons" in catalog
    assert manifest["complete"] is True
    assert manifest["unit_count"] == 3
    snapshot = layout.snapshots_dir / manifest["snapshot"]
    assert (snapshot / "siglip_embeddings_fp16.npy").exists()
    assert (snapshot / "historical_media_index.sqlite").exists()
    published = json.loads(layout.index_manifest.read_text())
    assert published["snapshot"] == manifest["snapshot"]


def test_coordinator_aborts_when_a_stage_does_not_finish(media_tree, layout, settings):
    """Regression: a timed-out stage must abort, not export a partial index."""
    from mmindex.export import read_manifest
    from mmindex.pipeline import Pipeline

    pipeline = Pipeline(layout, settings)
    try:
        pipeline.run_scan(media_tree)
    finally:
        pipeline.close()

    coordinator = Coordinator(
        layout, settings, poll_interval=0.01, log=lambda _msg: None
    )
    try:
        with pytest.raises(RuntimeError, match="did not finish"):
            coordinator.run(["prepare"], timeout=0.05)
    finally:
        coordinator.close()
    assert read_manifest(layout) is None


def test_coordinator_refuses_to_export_an_empty_index(layout, settings):
    """Regression: exporting zero units must fail loudly, not publish an index."""
    coordinator = Coordinator(layout, settings, poll_interval=0.01, log=lambda _msg: None)
    try:
        with pytest.raises(RuntimeError, match="no units"):
            coordinator.run_export()
    finally:
        coordinator.close()
    assert not layout.index_manifest.exists()


def test_person_ids_flow_into_export(layout, settings):
    from mmindex.export import export_snapshot
    from mmindex.search import Index

    settings.clip_embedding_dim = 4
    units = [
        {
            "unit_index": 0,
            "path": "/a.jpg",
            "digest": "a",
            "kind": "image",
            "canonical_time": 1.0,
            "clip_embedding": np.ones(4, dtype=np.float32),
            "faces": [{"embedding": np.ones(4)}],
            "person_ids": ["person-0000"],
            "dhash": "a" * 16,
        }
    ]
    export_snapshot(units, layout, settings)
    index = Index.open(layout, settings)
    hits = index.search(np.ones(4, dtype=np.float32), person_id="person-0000")
    assert len(hits) == 1
    assert hits[0].person_ids == ["person-0000"]
