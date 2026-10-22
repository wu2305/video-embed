from __future__ import annotations

import json

import numpy as np
import pytest

from mmindex.coordinator import Coordinator
from mmindex.pipeline import Pipeline
from mmindex.queue import DONE, WorkQueue
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


def test_coordinator_does_not_wait_forever_on_failed_tasks(layout, settings):
    """Regression: failed rows counted as remaining, so timeout=None never returned."""
    coordinator = Coordinator(layout, settings, poll_interval=0.01, log=lambda _msg: None)
    try:
        queue = coordinator.queue
        queue.max_retries = 0
        queue.enqueue("prepare", [("a", "/m/a.jpg", "da"), ("b", "/m/b.jpg", "db")])
        first = queue.claim("prepare", "w")
        queue.mark_failed(first.task_id, "decode error", "w")
        second = queue.claim("prepare", "w")
        queue.mark_done(second.task_id, "w")

        # No timeout: this used to spin forever.
        assert coordinator.wait_for_stage("prepare") is False
    finally:
        coordinator.close()


def test_coordinator_run_reports_failed_files(media_tree, layout, settings):
    pipeline = Pipeline(layout, settings, log=lambda _m: None)
    try:
        pipeline.run_scan(media_tree)
    finally:
        pipeline.close()
    coordinator = Coordinator(layout, settings, poll_interval=0.01, log=lambda _msg: None)
    try:
        coordinator.queue.max_retries = 0
        coordinator.enqueue_stage("prepare")
        for _ in range(3):
            task = coordinator.queue.claim("prepare", "w")
            coordinator.queue.mark_failed(task.task_id, "decode error", "w")
        with pytest.raises(RuntimeError, match=r"(?s)did not finish.*decode error"):
            coordinator.run(["prepare"])
    finally:
        coordinator.close()


def test_workers_on_separate_machines_share_progress_only_through_shards(
    media_tree, layout, settings, tmp_path
):
    """Three 'machines' with machine-local databases and one shared root.

    Each stage's worker reads the previous stage's records written by another
    machine, and the coordinator exports from shards alone.
    """
    from mmindex.config import Layout

    def machine(name):
        return Layout(layout.root, local_dir=tmp_path / name)

    pipeline = Pipeline(layout, settings, log=lambda _m: None)
    try:
        pipeline.run_scan(media_tree)
    finally:
        pipeline.close()

    coordinator = Coordinator(machine("coordinator"), settings, poll_interval=0.01, log=lambda _m: None)
    try:
        for stage, host in (("prepare", "a"), ("extract", "b"), ("infer", "a")):
            coordinator.enqueue_stage(stage)
            summary = Worker(stage, machine(host), settings, worker_id=f"w-{stage}").run()
            assert summary["failed"] == 0 and summary["processed"] == 3, (stage, summary)
            assert coordinator.wait_for_stage(stage, timeout=5)

        manifest = coordinator.run_export()
    finally:
        coordinator.close()

    assert manifest["unit_count"] == 3
    # Nobody opened a database on the shared root.
    assert not layout.checkpoint_db.exists()
    shards = list(layout.shard_dir.glob("shard-*.json.gz"))
    assert len(shards) >= 3 and len({s.name for s in shards}) == len(shards)


def test_durable_worker_syncs_before_marking_done(media_tree, layout, settings, tmp_path):
    """A task must not be 'done' while its record exists only on the worker's disk."""
    from mmindex.config import Layout

    local = Layout(layout.root, local_dir=tmp_path / "host")
    pipeline = Pipeline(layout, settings, log=lambda _m: None)
    try:
        pipeline.run_scan(media_tree)
    finally:
        pipeline.close()
    coordinator = Coordinator(local, settings, poll_interval=0.01, log=lambda _m: None)
    try:
        coordinator.enqueue_stage("prepare")
    finally:
        coordinator.close()

    worker = Worker("prepare", local, settings, worker_id="w")
    try:
        assert worker.run_once() is True
        assert worker.queue.stats("prepare").get(DONE) == 1
        assert worker.checkpoint.pending_outbox() == 0
        assert len(list(local.shard_dir.glob("shard-*.json.gz"))) == 1
    finally:
        worker.close()


def test_queue_accepts_delete_journal_mode_for_network_mounts(tmp_path):
    queue = WorkQueue(tmp_path / "q.sqlite", journal_mode="delete")
    try:
        mode = queue._conn.execute("PRAGMA journal_mode").fetchone()[0]
        assert mode.lower() == "delete"
        queue.enqueue("infer", [("a", "/a.jpg", "da")])
        assert queue.claim("infer", "w") is not None
    finally:
        queue.close()
    with pytest.raises(ValueError):
        WorkQueue(tmp_path / "q2.sqlite", journal_mode="truncate")


def _local_machine(layout, tmp_path, name):
    from mmindex.config import Layout

    return Layout(layout.root, local_dir=tmp_path / name)


def _run_until_infer_queued(media_tree, layout, settings, tmp_path):
    machine = _local_machine(layout, tmp_path, "host")
    pipeline = Pipeline(layout, settings, log=lambda _m: None)
    try:
        pipeline.run_scan(media_tree)
    finally:
        pipeline.close()
    coordinator = Coordinator(machine, settings, poll_interval=0.01, log=lambda _m: None)
    try:
        for stage in ("prepare", "extract"):
            coordinator.enqueue_stage(stage)
            summary = Worker(stage, machine, settings, worker_id=f"w-{stage}").run()
            assert summary["failed"] == 0
        coordinator.enqueue_stage("infer")
    finally:
        coordinator.close()
    return machine


def test_durable_infer_keeps_frames_until_the_shard_is_synced(
    media_tree, layout, settings, tmp_path, monkeypatch
):
    """Regression: frames were deleted as soon as the record hit the machine-local
    database, so a machine lost before its sync left a record-less task whose
    extract output was already gone."""
    machine = _run_until_infer_queued(media_tree, layout, settings, tmp_path)
    worker = Worker("infer", machine, settings, worker_id="w")
    try:
        def vanish():
            raise OSError("machine preempted before the shard was written")

        monkeypatch.setattr(worker.checkpoint, "sync", vanish)
        assert worker.run_once() is True
        assert worker.failed == 1
        assert len(list(layout.frames_dir.glob("*.jpg"))) == 3  # nothing deleted
    finally:
        worker.close()


def test_durable_infer_discards_frames_once_synced(media_tree, layout, settings, tmp_path):
    machine = _run_until_infer_queued(media_tree, layout, settings, tmp_path)
    summary = Worker("infer", machine, settings, worker_id="w").run()
    assert summary["processed"] == 3 and summary["failed"] == 0
    assert list(layout.frames_dir.glob("*.jpg")) == []


def test_pipeline_cluster_and_export_read_machine_local_shards(
    media_tree, layout, settings, tmp_path
):
    """Regression: Pipeline always opened the shared database, so with --local-dir
    workers cluster/export saw no units."""
    machine = _run_until_infer_queued(media_tree, layout, settings, tmp_path)
    Worker("infer", machine, settings, worker_id="w").run()
    other = _local_machine(layout, tmp_path, "finaliser")
    pipeline = Pipeline(other, settings, log=lambda _m: None)
    try:
        pipeline.run_cluster()
        manifest = pipeline.run_export()
    finally:
        pipeline.close()
    assert manifest["unit_count"] == 3
