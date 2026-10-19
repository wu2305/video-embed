from __future__ import annotations

import numpy as np
import pytest

from mmindex.checkpoint import CheckpointConflict, GuardedCheckpoint, IncrementalCheckpoint


def _store(tmp_path, **kwargs):
    return IncrementalCheckpoint(tmp_path / "cp.sqlite", stage="infer", **kwargs)


def test_put_and_get_roundtrip(tmp_path):
    store = _store(tmp_path, auto_sync=False)
    try:
        payload = {"units": [{"clip_embedding": np.ones(4, dtype=np.float32)}], "n": 1}
        assert store.put("a.jpg", "d1", payload) is True
        loaded = store.get("a.jpg", "d1")
        assert loaded["n"] == 1
        assert np.allclose(loaded["units"][0]["clip_embedding"], np.ones(4))
    finally:
        store.close(sync=False)


def test_put_identical_payload_is_noop(tmp_path):
    store = _store(tmp_path, auto_sync=False)
    try:
        store.put("a.jpg", "d1", {"v": 1})
        assert store.put("a.jpg", "d1", {"v": 1}) is False
        assert store.pending_outbox() == 1
    finally:
        store.close(sync=False)


def test_get_missing_returns_none(tmp_path):
    store = _store(tmp_path, auto_sync=False)
    try:
        assert store.get("nope.jpg", "d") is None
        assert store.has("nope.jpg", "d") is False
    finally:
        store.close(sync=False)


def test_stage_isolation(tmp_path):
    store = _store(tmp_path, auto_sync=False)
    try:
        store.put("a.jpg", "d1", {"stage": "infer"})
        assert store.get("a.jpg", "d1", stage="prepare") is None
        store.stage = "prepare"
        store.put("a.jpg", "d1", {"stage": "prepare"})
        assert store.get("a.jpg", "d1", stage="infer")["stage"] == "infer"
        assert store.get("a.jpg", "d1", stage="prepare")["stage"] == "prepare"
    finally:
        store.close(sync=False)


def test_resume_skips_completed_work(tmp_path):
    store = _store(tmp_path, auto_sync=False)
    store.put("a.jpg", "d1", {"done": True})
    store.close(sync=False)

    reopened = _store(tmp_path, auto_sync=False)
    try:
        assert reopened.has("a.jpg", "d1") is True
        assert reopened.get("a.jpg", "d1")["done"] is True
    finally:
        reopened.close(sync=False)


def test_sync_writes_shard_and_import_restores(tmp_path):
    source_dir = tmp_path / "src"
    shard_dir = tmp_path / "shards"
    store = IncrementalCheckpoint(
        source_dir / "cp.sqlite", stage="infer", shard_dir=shard_dir, auto_sync=False
    )
    try:
        store.put("a.jpg", "d1", {"units": [{"clip_embedding": np.arange(3, dtype=np.float32)}]})
        store.put("b.jpg", "d2", {"units": []})
        shard = store.sync()
        assert shard is not None and shard.exists()
        assert store.pending_outbox() == 0
    finally:
        store.close(sync=False)

    target = IncrementalCheckpoint(
        tmp_path / "dst" / "cp.sqlite", stage="infer", shard_dir=shard_dir, auto_sync=False
    )
    try:
        inserted = target.import_shards()
        assert inserted == 2
        record = target.get("a.jpg", "d1")
        assert np.allclose(record["units"][0]["clip_embedding"], np.arange(3))
        assert target.import_shards() == 0
    finally:
        target.close(sync=False)


def test_guarded_checkpoint_rejects_divergent_overwrite(tmp_path):
    path = tmp_path / "cp.sqlite"
    store = GuardedCheckpoint(path, stage="infer", auto_sync=False)
    store.put("a.jpg", "d1", {"v": 1})
    store.close(sync=False)

    guarded = GuardedCheckpoint(path, stage="infer", auto_sync=False)
    try:
        with pytest.raises(CheckpointConflict):
            guarded.put("a.jpg", "d1", {"v": 2})
        assert guarded.put("a.jpg", "d1", {"v": 1}) is False
    finally:
        guarded.close(sync=False)


def test_count_and_records(tmp_path):
    store = _store(tmp_path, auto_sync=False)
    try:
        store.put("a.jpg", "d1", {"v": 1})
        store.put("b.jpg", "d2", {"v": 2})
        assert store.count() == 2
        paths = [path for path, _digest, _record in store.records()]
        assert paths == ["a.jpg", "b.jpg"]
    finally:
        store.close(sync=False)


def test_meta_roundtrip(tmp_path):
    store = _store(tmp_path, auto_sync=False)
    try:
        store.set_meta("feature_sha", "abc")
        assert store.get_meta("feature_sha") == "abc"
        assert store.get_meta("missing", "fallback") == "fallback"
    finally:
        store.close(sync=False)


def test_two_machines_syncing_to_one_shard_dir_do_not_overwrite_each_other(tmp_path):
    """Regression: shard numbers came from listing the folder, so two machines with
    their own databases both wrote shard-000001 and the second silently replaced
    the first."""
    shards = tmp_path / "shared" / "shards"
    machine_a = IncrementalCheckpoint(
        tmp_path / "a" / "cp.sqlite", stage="infer", shard_dir=shards, auto_sync=False
    )
    machine_b = IncrementalCheckpoint(
        tmp_path / "b" / "cp.sqlite", stage="infer", shard_dir=shards, auto_sync=False
    )
    try:
        machine_a.put("a.jpg", "da", {"from": "a"})
        machine_b.put("b.jpg", "db", {"from": "b"})
        shard_a, shard_b = machine_a.sync(), machine_b.sync()
        assert shard_a != shard_b and shard_a.exists() and shard_b.exists()
        assert machine_a.writer_id != machine_b.writer_id
        assert len(list(shards.glob("shard-*.json.gz"))) == 2

        # A third machine rebuilds the union.
        reader = IncrementalCheckpoint(
            tmp_path / "c" / "cp.sqlite", stage="infer", shard_dir=shards, auto_sync=False
        )
        try:
            assert reader.import_shards() == 2
            assert reader.get("a.jpg", "da") == {"from": "a"}
            assert reader.get("b.jpg", "db") == {"from": "b"}
        finally:
            reader.close(sync=False)
    finally:
        machine_a.close(sync=False)
        machine_b.close(sync=False)


def test_shard_sequence_and_writer_id_survive_a_restart(tmp_path):
    db, shards = tmp_path / "cp.sqlite", tmp_path / "shards"
    first = IncrementalCheckpoint(db, stage="infer", shard_dir=shards, auto_sync=False)
    first.put("a.jpg", "da", {"n": 1})
    one = first.sync()
    writer = first.writer_id
    first.close(sync=False)

    again = IncrementalCheckpoint(db, stage="infer", shard_dir=shards, auto_sync=False)
    try:
        assert again.writer_id == writer
        again.put("b.jpg", "db", {"n": 2})
        two = again.sync()
        assert two != one and one.exists() and two.exists()
    finally:
        again.close(sync=False)


def test_corrupt_shard_is_rejected(tmp_path):
    import gzip
    import json

    shards = tmp_path / "shards"
    shards.mkdir()
    envelope = {
        "path": "a.jpg", "digest": "da", "stage": "infer",
        "payload_sha": "0" * 64, "created_at": 1.0, "payload": '{"n":1}',
    }
    with gzip.open(shards / "shard-bad-000001.json.gz", "wb") as handle:
        handle.write(json.dumps(envelope).encode() + b"\n")
    store = IncrementalCheckpoint(
        tmp_path / "cp.sqlite", stage="infer", shard_dir=shards, auto_sync=False
    )
    try:
        with pytest.raises(CheckpointConflict, match="corrupt"):
            store.import_shards()
        assert store.has("a.jpg", "da") is False
    finally:
        store.close(sync=False)
