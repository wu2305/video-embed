from __future__ import annotations

import numpy as np
import pytest

from mmindex.export import export_snapshot, read_manifest, verify_snapshot
from mmindex.search import Index


def _unit(index: int, dim: int = 8, text: str = "", people=(), faces=0, sharp=1.0, dhash=""):
    return {
        "unit_index": index,
        "path": f"/media/file{index}.jpg",
        "digest": f"d{index}",
        "kind": "image",
        "canonical_time": 1700000000.0 + index,
        "scene_start": 0.0,
        "scene_end": 0.0,
        "clip_embedding": np.eye(dim, dtype=np.float32)[index % dim],
        "faces": [{"embedding": np.ones(4, dtype=np.float32)}] * faces,
        "ocr_text": text,
        "asr_text": "",
        "dhash": dhash or f"{index:016x}",
        "sharpness": sharp,
        "person_ids": list(people),
        "width": 100,
        "height": 100,
    }


def test_export_publishes_complete_manifest(layout, settings):
    settings.clip_embedding_dim = 8
    units = [_unit(0), _unit(1)]
    manifest = export_snapshot(units, layout, settings)
    assert manifest["complete"] is True
    assert manifest["unit_count"] == 2
    stored = read_manifest(layout)
    assert stored["snapshot"] == manifest["snapshot"]


def test_export_row_alignment(layout, settings):
    settings.clip_embedding_dim = 8
    manifest = export_snapshot([_unit(0), _unit(1), _unit(2)], layout, settings)
    checks = verify_snapshot(
        layout.snapshots_dir / manifest["snapshot"], 3, settings.clip_embedding_dim
    )
    assert checks["ok"], checks["errors"]
    assert checks["rows"] == checks["units"] == 3
    assert checks["dim"] == 8


def test_export_rejects_wrong_dimension(layout, settings):
    settings.clip_embedding_dim = 8
    bad = _unit(0)
    bad["clip_embedding"] = np.ones(5, dtype=np.float32)
    from mmindex.export import ExportError

    with pytest.raises(ExportError):
        export_snapshot([bad], layout, settings)
    assert read_manifest(layout) is None


def test_verify_detects_missing_files(layout, settings, tmp_path):
    settings.clip_embedding_dim = 8
    empty = tmp_path / "empty_snapshot"
    empty.mkdir()
    checks = verify_snapshot(empty, 0, 8)
    assert checks["ok"] is False
    assert any("missing" in error for error in checks["errors"])


def test_near_duplicates_mark_sharpest_as_master(layout, settings):
    settings.clip_embedding_dim = 8
    settings.near_dup_hamming = 4
    units = [
        _unit(0, dhash="ffffffffffffffff", sharp=10.0),
        _unit(1, dhash="ffffffffffffffff", sharp=1.0),
    ]
    export_snapshot(units, layout, settings)
    index = Index.open(layout, settings)
    hits = index.search(np.eye(8, dtype=np.float32)[0], limit=10)
    assert len(hits) == 1
    assert hits[0].is_master is True


def test_search_text_bonus_changes_ranking(layout, settings):
    settings.clip_embedding_dim = 8
    units = [_unit(0), _unit(1, text="a red bridge at night")]
    export_snapshot(units, layout, settings)
    index = Index.open(layout, settings)
    hits = index.search(text="bridge", limit=5)
    assert hits[0].path.endswith("file1.jpg")
    assert hits[0].text_bonus == pytest.approx(settings.text_bonus)


def test_search_person_and_face_filters(layout, settings):
    settings.clip_embedding_dim = 8
    units = [
        _unit(0, people=["person-0001"], faces=1),
        _unit(1, people=["person-0002"], faces=2),
        _unit(2),
    ]
    export_snapshot(units, layout, settings)
    index = Index.open(layout, settings)
    assert [h.path for h in index.search(text="x", person_id="person-0001")] == ["/media/file0.jpg"]
    assert [h.path for h in index.search(text="x", min_faces=2)] == ["/media/file1.jpg"]


def test_search_vector_similarity_orders_hits(layout, settings):
    settings.clip_embedding_dim = 8
    export_snapshot([_unit(0), _unit(3)], layout, settings)
    index = Index.open(layout, settings)
    query = np.eye(8, dtype=np.float32)[3]
    hits = index.search(query, limit=2)
    assert hits[0].path.endswith("file3.jpg")
    assert hits[0].similarity > hits[1].similarity


def test_search_requires_query(layout, settings):
    settings.clip_embedding_dim = 8
    export_snapshot([_unit(0)], layout, settings)
    index = Index.open(layout, settings)
    with pytest.raises(ValueError):
        index.search()
