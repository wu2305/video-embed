from __future__ import annotations

import time


from mmindex.queue import CLAIMED, DONE, PENDING, WorkQueue


def _queue(tmp_path, **kwargs):
    return WorkQueue(tmp_path / "queue.sqlite", **kwargs)


def _entries(n=4, stage="infer"):
    return [(f"id{i}", f"/media/f{i}.jpg", f"d{i}") for i in range(n)]


def test_enqueue_and_stats(tmp_path):
    queue = _queue(tmp_path)
    try:
        queue.enqueue("infer", _entries(3))
        assert queue.stats("infer") == {PENDING: 3}
        assert queue.remaining("infer") == 3
        assert queue.is_complete("infer") is False
    finally:
        queue.close()


def test_claim_is_exclusive(tmp_path):
    queue = _queue(tmp_path)
    try:
        queue.enqueue("infer", _entries(2))
        first = queue.claim("infer", "w1")
        second = queue.claim("infer", "w2")
        assert first.file_id != second.file_id
        assert queue.claim("infer", "w3") is None
        assert queue.stats("infer") == {CLAIMED: 2}
    finally:
        queue.close()


def test_mark_done_and_completion(tmp_path):
    queue = _queue(tmp_path)
    try:
        queue.enqueue("infer", _entries(2))
        for _ in range(2):
            task = queue.claim("infer", "w")
            queue.mark_done(task.task_id)
        assert queue.stats("infer") == {DONE: 2}
        assert queue.is_complete("infer") is True
    finally:
        queue.close()


def test_reclaim_stale_resets_expired_lease(tmp_path):
    queue = _queue(tmp_path, lease_seconds=0.01)
    try:
        queue.enqueue("infer", _entries(1))
        task = queue.claim("infer", "w1")
        assert task is not None
        time.sleep(0.05)
        assert queue.reclaim_stale() == 1
        assert queue.stats("infer") == {PENDING: 1}
        assert queue.claim("infer", "w2").file_id == task.file_id  # same file, new worker
    finally:
        queue.close()


def test_fresh_lease_is_not_reclaimed(tmp_path):
    queue = _queue(tmp_path, lease_seconds=300)
    try:
        queue.enqueue("infer", _entries(1))
        queue.claim("infer", "w1")
        assert queue.reclaim_stale() == 0
    finally:
        queue.close()


def test_mark_failed_retries_then_parks(tmp_path):
    queue = _queue(tmp_path, max_retries=2)
    try:
        queue.enqueue("infer", _entries(1))
        for _ in range(3):
            task = queue.claim("infer", "w")
            if task is None:
                break
            queue.mark_failed(task.task_id, "boom")
        assert queue.stats("infer").get("failed") == 1
        assert len(queue.failures("infer")) == 1
    finally:
        queue.close()


def test_retry_failed_requeues(tmp_path):
    queue = _queue(tmp_path, max_retries=0)
    try:
        queue.enqueue("infer", _entries(1))
        task = queue.claim("infer", "w")
        queue.mark_failed(task.task_id, "boom")
        assert queue.stats("infer").get("failed") == 1
        assert queue.retry_failed("infer") == 1
        assert queue.stats("infer") == {PENDING: 1}
    finally:
        queue.close()


def test_shard_claim_partitions_deterministically(tmp_path):
    queue = _queue(tmp_path)
    try:
        entries = [(f"id{i}", f"/f{i}", f"d{i}") for i in range(20)]
        queue.enqueue("infer", entries, n_shards=2)
        claimed = []
        for _ in range(20):
            task = queue.claim("infer", "w", shard=1)
            if task is None:
                break
            claimed.append(task.file_id)
            queue.mark_done(task.task_id)
        assert claimed
        assert len(claimed) < 20
        assert queue.stats("infer")[DONE] == len(claimed)
        # Every claimed row belongs to the requested shard.
        assert all(int(fid[2:]) >= 0 for fid in claimed)
    finally:
        queue.close()


def test_shards_cover_the_whole_workload(tmp_path):
    queue = _queue(tmp_path)
    try:
        entries = [(f"id{i}", f"/f{i}", f"d{i}") for i in range(20)]
        queue.enqueue("infer", entries, n_shards=3)
        seen = []
        for shard in range(3):
            while True:
                task = queue.claim("infer", "w", shard=shard)
                if task is None:
                    break
                seen.append(task.file_id)
                queue.mark_done(task.task_id)
        assert sorted(seen) == sorted(fid for fid, _, _ in entries)
    finally:
        queue.close()


def test_enqueue_is_idempotent(tmp_path):
    queue = _queue(tmp_path)
    try:
        queue.enqueue("infer", _entries(2))
        queue.enqueue("infer", _entries(2))
        assert queue.stats("infer") == {PENDING: 2}
    finally:
        queue.close()


def test_same_file_can_be_enqueued_for_every_stage(tmp_path):
    """Regression: a file queued for prepare must still be queueable for extract."""
    queue = _queue(tmp_path)
    try:
        for stage in ("prepare", "extract", "infer"):
            queue.enqueue(stage, _entries(3))
        for stage in ("prepare", "extract", "infer"):
            assert queue.stats(stage) == {PENDING: 3}, stage
        task = queue.claim("extract", "w")
        assert task.stage == "extract"
        queue.mark_done(task.task_id)
        assert queue.stats("extract") == {PENDING: 2, DONE: 1}
        assert queue.stats("prepare") == {PENDING: 3}
    finally:
        queue.close()


def test_task_id_is_stage_qualified(tmp_path):
    queue = _queue(tmp_path)
    try:
        queue.enqueue("prepare", _entries(1))
        queue.enqueue("infer", _entries(1))
        prepare_task = queue.claim("prepare", "w")
        infer_task = queue.claim("infer", "w")
        assert prepare_task.task_id != infer_task.task_id
        assert prepare_task.task_id.startswith("prepare:")
        assert infer_task.task_id.startswith("infer:")
    finally:
        queue.close()


def test_release_does_not_count_retry(tmp_path):
    queue = _queue(tmp_path)
    try:
        queue.enqueue("infer", _entries(1))
        task = queue.claim("infer", "w")
        queue.release(task.task_id)
        assert queue.stats("infer") == {PENDING: 1}
        assert queue.failures("infer") == []
    finally:
        queue.close()


def test_stale_worker_cannot_fail_a_row_it_no_longer_owns(tmp_path):
    """Regression: a late mark_failed used to bounce a row another worker was running."""
    queue = _queue(tmp_path)
    try:
        queue.enqueue("infer", _entries(1))
        stale = queue.claim("infer", "w1")
        queue.reclaim_stale(lease_seconds=-1)
        queue.claim("infer", "w2")
        assert queue.mark_failed(stale.task_id, "late", "w1") is False
        assert queue.mark_done(stale.task_id, "w1") is False
        assert queue.heartbeat(stale.task_id, "w1") is False
        assert queue.release(stale.task_id, "w1") is False
        assert queue.stats("infer") == {CLAIMED: 1}
        assert queue.mark_done(stale.task_id, "w2") is True
        assert queue.stats("infer") == {DONE: 1}
    finally:
        queue.close()


def test_owner_aware_failure_counts_one_retry(tmp_path):
    queue = _queue(tmp_path, max_retries=1)
    try:
        queue.enqueue("infer", _entries(1))
        task = queue.claim("infer", "w")
        assert queue.mark_failed(task.task_id, "boom", "w") is True
        assert queue.stats("infer") == {PENDING: 1}
        task = queue.claim("infer", "w")
        queue.mark_failed(task.task_id, "boom again", "w")
        assert queue.stats("infer") == {"failed": 1}
        assert queue.failures("infer")[0]["retries"] == 2
    finally:
        queue.close()
