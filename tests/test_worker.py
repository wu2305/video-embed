from __future__ import annotations

import threading
import time

import pytest

from mmindex.coordinator import Coordinator
from mmindex.pipeline import Pipeline
from mmindex.queue import CLAIMED, DONE, PENDING, WorkQueue
from mmindex.worker import Worker


class _AsrBackend:
    """Backend stub whose only job is to transcribe."""

    name = "stub"

    def __init__(self):
        self.closed = False
        self.transcribed: list[str] = []

    def transcribe(self, path, language=None):
        return " ".join(s["text"] for s in self.transcribe_segments(path, language))

    def transcribe_segments(self, path, language=None):
        self.transcribed.append(path)
        return [{"start": 0.0, "end": 1.0, "text": "hello from the clip"}]

    def close(self):
        self.closed = True


def _scan(media_root, layout, settings):
    pipeline = Pipeline(layout, settings, log=lambda _m: None)
    try:
        pipeline.run_scan(media_root)
    finally:
        pipeline.close()


def _enqueue(layout, settings, stage):
    coordinator = Coordinator(layout, settings, poll_interval=0.01, log=lambda _m: None)
    try:
        coordinator.enqueue_stage(stage)
    finally:
        coordinator.close()


def test_prepare_worker_transcribes_videos(media_tree, layout, settings, monkeypatch):
    """Regression: the prepare worker never built a backend, so ASR was silently empty."""
    # A file that is a "video" by extension; scene detection falls back to one span.
    (media_tree / "clip.mp4").write_bytes(b"not really a video")
    _scan(media_tree, layout, settings)
    _enqueue(layout, settings, "prepare")

    stub = _AsrBackend()
    built = []
    monkeypatch.setattr(
        "mmindex.worker.build_backend", lambda _settings: built.append(1) or stub
    )
    summary = Worker("prepare", layout, settings, worker_id="w").run()

    assert summary["failed"] == 0 and summary["processed"] == 4
    assert built == [1], "backend should be built once, lazily, for the video only"
    assert len(stub.transcribed) == 1 and stub.transcribed[0].endswith("clip.mp4")
    assert stub.closed, "a backend the worker built must be closed with the worker"

    from mmindex.checkpoint import IncrementalCheckpoint

    with IncrementalCheckpoint(layout.checkpoint_db, stage="prepare", auto_sync=False) as store:
        records = {r["path"].rsplit("/", 1)[-1]: r for _p, _d, r in store.records("prepare")}
    assert records["clip.mp4"]["asr_text"] == "hello from the clip"
    assert records["shot_1.png"]["asr_text"] == ""


def test_prepare_worker_does_not_load_models_for_images(media_tree, layout, settings, monkeypatch):
    _scan(media_tree, layout, settings)
    _enqueue(layout, settings, "prepare")
    monkeypatch.setattr(
        "mmindex.worker.build_backend",
        lambda _s: pytest.fail("images must not trigger a backend build"),
    )
    assert Worker("prepare", layout, settings, worker_id="w").run()["failed"] == 0


def test_injected_backend_is_not_closed_by_the_worker(media_tree, layout, settings):
    (media_tree / "clip.mp4").write_bytes(b"x")
    _scan(media_tree, layout, settings)
    _enqueue(layout, settings, "prepare")
    stub = _AsrBackend()
    Worker("prepare", layout, settings, worker_id="w", backend=stub).run()
    assert not stub.closed and len(stub.transcribed) == 1


def test_long_task_keeps_its_lease_alive(media_tree, layout, settings, monkeypatch):
    """Regression: heartbeats fired only after a task, so a slow task was reclaimed."""
    _scan(media_tree, layout, settings)
    _enqueue(layout, settings, "prepare")
    worker = Worker(
        "prepare", layout, settings, worker_id="slow", lease_seconds=0.6, heartbeat_every=0.05
    )
    watchdog = WorkQueue(layout.queue_db, lease_seconds=0.6)
    reclaimed: list[int] = []

    def slow_process(task):
        # Three leases' worth of work; the watchdog polls throughout.
        deadline = time.time() + 1.8
        while time.time() < deadline:
            reclaimed.append(watchdog.reclaim_stale())
            time.sleep(0.05)

    monkeypatch.setattr(worker, "_process", slow_process)
    try:
        assert worker.run_once() is True
        assert sum(reclaimed) == 0, "the lease expired while the task was still running"
        assert worker.processed == 1 and worker.lost == 0
    finally:
        watchdog.close()
        worker.close()


def test_lease_without_heartbeat_does_expire(tmp_path):
    """Control for the test above: the watchdog does reclaim a silent claim."""
    queue = WorkQueue(tmp_path / "q.sqlite", lease_seconds=0.1)
    try:
        queue.enqueue("infer", [("a", "/a.jpg", "da")])
        queue.claim("infer", "silent")
        time.sleep(0.25)
        assert queue.reclaim_stale() == 1
    finally:
        queue.close()


def test_worker_that_lost_its_lease_cannot_finish_the_row(media_tree, layout, settings, monkeypatch):
    _scan(media_tree, layout, settings)
    _enqueue(layout, settings, "prepare")
    worker = Worker("prepare", layout, settings, worker_id="late", lease_seconds=300)
    rival = WorkQueue(layout.queue_db)
    taken: dict = {}

    def stolen(task):
        # The lease expires and another worker claims the same row mid-task.
        rival.reclaim_stale(lease_seconds=-1)
        taken["task"] = rival.claim("prepare", "rival", shard=None)

    monkeypatch.setattr(worker, "_process", stolen)
    try:
        worker.run_once()
        assert worker.lost == 1, "late worker must be told its completion was refused"
        row = rival._conn.execute(
            "SELECT status, worker_id FROM work_queue WHERE task_id=?",
            (taken["task"].task_id,),
        ).fetchone()
        assert row["status"] == CLAIMED and row["worker_id"] == "rival"
    finally:
        rival.close()
        worker.close()


def test_failed_task_is_requeued_by_owner(media_tree, layout, settings, monkeypatch):
    _scan(media_tree, layout, settings)
    _enqueue(layout, settings, "prepare")
    worker = Worker("prepare", layout, settings, worker_id="w")

    def boom(task):
        raise RuntimeError("boom")

    monkeypatch.setattr(worker, "_process", boom)
    try:
        worker.run_once()
        assert worker.failed == 1 and worker.lost == 0
        assert worker.queue.stats("prepare").get(PENDING) == 3  # retried, not parked
    finally:
        worker.close()


def test_heartbeat_thread_stops_with_the_task(media_tree, layout, settings):
    _scan(media_tree, layout, settings)
    _enqueue(layout, settings, "prepare")
    before = {t.name for t in threading.enumerate()}
    worker = Worker("prepare", layout, settings, worker_id="w", heartbeat_every=0.05)
    worker.run()
    leaked = [t for t in threading.enumerate() if t.name == "lease-heartbeat" and t.name not in before]
    assert leaked == []
    assert DONE  # imported for parity with the queue tests
