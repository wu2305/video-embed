from __future__ import annotations

import numpy as np
import pytest

from mmindex.checkpoint import IncrementalCheckpoint
from mmindex.config import ALL_STAGES
from mmindex.pipeline import Pipeline
from mmindex.scan import read_manifest, scan
from mmindex.stages import extract_entry, infer_entry, prepare_entry, run_stage


@pytest.fixture
def prepared_tree(media_tree, layout):
    scan(media_tree, layout)
    return read_manifest(layout)


def test_prepare_is_idempotent(prepared_tree, layout, settings):
    store = IncrementalCheckpoint(layout.checkpoint_db, stage="prepare", auto_sync=False)
    try:
        entry = prepared_tree[0]
        first = prepare_entry(entry, layout, settings, store)
        second = prepare_entry(entry, layout, settings, store)
        assert first["digest"] == second["digest"]
        assert store.count("prepare") == 1
    finally:
        store.close(sync=False)


def test_extract_writes_frames(prepared_tree, layout, settings):
    prepare_store = IncrementalCheckpoint(layout.checkpoint_db, stage="prepare", auto_sync=False)
    extract_store = IncrementalCheckpoint(layout.checkpoint_db, stage="extract", auto_sync=False)
    try:
        entry = prepared_tree[0]
        prepare_entry(entry, layout, settings, prepare_store)
        record = extract_entry(entry, layout, settings, extract_store)
        assert len(record["frames"]) == 1
        from mmindex.media import load_frame

        frame = record["frames"][0]
        assert frame["file"].endswith(".jpg")
        assert load_frame(frame["file"]).ndim == 3
        assert frame["width"] <= settings.frame_max_edge
    finally:
        prepare_store.close(sync=False)
        extract_store.close(sync=False)


def test_extract_requires_prepare(prepared_tree, layout, settings):
    store = IncrementalCheckpoint(layout.checkpoint_db, stage="extract", auto_sync=False)
    try:
        with pytest.raises(RuntimeError, match="stage 1 record missing"):
            extract_entry(prepared_tree[0], layout, settings, store)
    finally:
        store.close(sync=False)


def test_stored_frame_is_bounded_and_much_smaller_than_raw(tmp_path, layout, settings):
    """Regression: frames were full-resolution raw arrays, so a large photo cost
    tens of megabytes on disk for every unit."""
    import numpy as np

    from mmindex.media import save_frame

    image = np.zeros((3000, 4000, 3), dtype=np.uint8)
    image[::7, ::5] = 255
    target = tmp_path / "big.jpg"
    size = save_frame(target, image, settings.frame_max_edge, settings.frame_jpeg_quality)
    assert max(size["width"], size["height"]) == settings.frame_max_edge
    assert target.stat().st_size < image.nbytes // 20


def test_infer_deletes_frames_after_the_record_is_stored(
    prepared_tree, layout, settings, backend
):
    """Regression: frames were never removed, so extract's output accumulated."""
    from pathlib import Path

    prepare_store = IncrementalCheckpoint(layout.checkpoint_db, stage="prepare", auto_sync=False)
    extract_store = IncrementalCheckpoint(layout.checkpoint_db, stage="extract", auto_sync=False)
    infer_store = IncrementalCheckpoint(layout.checkpoint_db, stage="infer", auto_sync=False)
    try:
        entry = prepared_tree[0]
        prepare_entry(entry, layout, settings, prepare_store, backend)
        extracted = extract_entry(entry, layout, settings, extract_store)
        assert Path(extracted["frames"][0]["file"]).exists()
        infer_entry(entry, layout, settings, infer_store, backend)
        assert not Path(extracted["frames"][0]["file"]).exists()
    finally:
        for store in (prepare_store, extract_store, infer_store):
            store.close(sync=False)


def test_keep_frames_leaves_them_on_disk(prepared_tree, layout, settings, backend):
    from dataclasses import replace
    from pathlib import Path

    keeping = replace(settings, keep_frames=True)
    stores = {
        stage: IncrementalCheckpoint(layout.checkpoint_db, stage=stage, auto_sync=False)
        for stage in ("prepare", "extract", "infer")
    }
    try:
        entry = prepared_tree[0]
        prepare_entry(entry, layout, keeping, stores["prepare"], backend)
        extracted = extract_entry(entry, layout, keeping, stores["extract"])
        infer_entry(entry, layout, keeping, stores["infer"], backend)
        assert Path(extracted["frames"][0]["file"]).exists()
    finally:
        for store in stores.values():
            store.close(sync=False)


def test_infer_produces_units(prepared_tree, layout, settings, backend):
    stores = {
        stage: IncrementalCheckpoint(layout.checkpoint_db, stage=stage, auto_sync=False)
        for stage in ALL_STAGES
    }
    try:
        entry = prepared_tree[0]
        prepare_entry(entry, layout, settings, stores["prepare"], backend)
        extract_entry(entry, layout, settings, stores["extract"])
        record = infer_entry(
            entry, layout, settings, stores["infer"], backend
        )
        assert record["backend"] == "hash"
        unit = record["units"][0]
        assert unit["clip_embedding"].shape == (settings.clip_embedding_dim,)
        assert unit["ocr_text"] == ""
        assert unit["dhash"]
        assert unit["sharpness"] >= 0
    finally:
        for store in stores.values():
            store.close(sync=False)


def test_run_stage_reports_skips(prepared_tree, layout, settings, backend):
    store = IncrementalCheckpoint(layout.checkpoint_db, stage="infer", auto_sync=False)
    try:
        # The extract stage was never run, so infer must fail per-entry rather
        # than crash the whole stage.
        result = run_stage("infer", prepared_tree, layout, settings, store, backend=backend)
        assert result["done"] == 0
        assert len(result["failed"]) == len(prepared_tree)
    finally:
        store.close(sync=False)


def test_full_pipeline_end_to_end(media_tree, layout, settings):
    pipeline = Pipeline(layout, settings)
    try:
        results = pipeline.run_all(media_tree)
    finally:
        pipeline.close()

    assert results["scan"]["canonical"] == 3
    assert results["prepare"]["done"] == 3
    assert results["extract"]["done"] == 3
    assert results["infer"]["done"] == 3
    assert results["export"]["complete"] is True
    assert results["export"]["unit_count"] == 3


def test_pipeline_rerun_skips_completed_work(media_tree, layout, settings):
    pipeline = Pipeline(layout, settings)
    try:
        pipeline.run_all(media_tree)
        second = pipeline.run_all(media_tree, skip_scan=True)
    finally:
        pipeline.close()
    assert second["prepare"]["done"] == 0
    assert second["prepare"]["skipped"] == 3
    assert second["infer"]["skipped"] == 3


def test_unit_size_is_the_source_resolution_not_the_scratch_jpeg(
    prepared_tree, layout, settings, backend
):
    """Regression: width/height came from the bounded frame, so a 4000 px photo
    was recorded at the scratch-frame size."""
    from dataclasses import replace

    small = replace(settings, frame_max_edge=32)
    stores = {
        stage: IncrementalCheckpoint(layout.checkpoint_db, stage=stage, auto_sync=False)
        for stage in ("prepare", "extract", "infer")
    }
    try:
        entry = prepared_tree[0]
        prepare_entry(entry, layout, small, stores["prepare"], backend)
        extracted = extract_entry(entry, layout, small, stores["extract"])
        assert max(extracted["frames"][0]["width"], extracted["frames"][0]["height"]) == 32
        record = infer_entry(entry, layout, small, stores["infer"], backend)
        unit = record["units"][0]
        assert (unit["width"], unit["height"]) == (80, 64)
    finally:
        for store in stores.values():
            store.close(sync=False)
