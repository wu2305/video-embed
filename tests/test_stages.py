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
        assert np.load(record["frames"][0]["file"]).ndim == 3
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
