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


def _unit_for(i, backend=None, dim=4):
    import numpy as np

    unit = {
        "unit_index": 0,
        "path": f"/m/{i}.jpg",
        "digest": f"d{i}",
        "kind": "image",
        "canonical_time": 0.0,
        "clip_embedding": np.eye(dim, dtype=np.float32)[i % dim],
        "faces": [],
        "dhash": f"{i * 0x0101010101010101 % (1 << 64):016x}",
        "sharpness": 1.0,
    }
    if backend:
        unit["backend"] = backend
    return unit


def test_export_records_the_real_backend_not_the_setting(layout, settings):
    from mmindex.export import export_snapshot
    from mmindex.search import Index

    settings.clip_embedding_dim = 4
    settings.backend = "auto"
    manifest = export_snapshot([_unit_for(0, "ml"), _unit_for(1, "ml")], layout, settings)
    assert manifest["settings"]["backend"] == "ml"
    assert Index.open(layout, settings).backend == "ml"


def test_export_refuses_to_mix_backends(layout, settings):
    """Regression: hash and ml vectors were accepted into one index."""
    import pytest

    from mmindex.export import ExportError, export_snapshot

    settings.clip_embedding_dim = 4
    with pytest.raises(ExportError, match="several inference backends"):
        export_snapshot([_unit_for(0, "hash"), _unit_for(1, "ml")], layout, settings)
    assert not layout.index_manifest.exists()


def test_search_rejects_a_query_from_another_backend(layout, settings):
    import pytest

    from mmindex.export import export_snapshot
    from mmindex.search import Index

    settings.clip_embedding_dim = 4
    export_snapshot([_unit_for(0, "hash")], layout, settings)
    index = Index.open(layout, settings)
    index.check_backend("hash")
    with pytest.raises(ValueError, match="built with the 'hash' backend"):
        index.check_backend("ml")


def test_snapshots_without_a_recorded_backend_still_open(layout, settings):
    from mmindex.export import export_snapshot
    from mmindex.search import Index

    settings.clip_embedding_dim = 4
    settings.backend = "auto"
    export_snapshot([_unit_for(0)], layout, settings)
    index = Index.open(layout, settings)
    index.check_backend("ml")  # legacy/unknown index: nothing to compare against


def test_stale_person_labels_are_refused_not_misapplied(layout, settings):
    """Regression: labels joined by list position, so a new record shifted persons."""
    import pytest

    from mmindex.clustering import write_labels
    from mmindex.export import ExportError, collect_units

    a, b = _unit_for(0), _unit_for(1)
    records = [{"units": [a, b]}]
    import numpy as np

    write_labels(
        layout,
        np.array([0, 1]),
        [(0, 0), (1, 0)],
        [("/m/0.jpg", "d0", 0), ("/m/1.jpg", "d1", 0)],
    )
    import json

    labels = json.loads(layout.person_labels.read_text())

    # Same units in a different order: persons follow the unit, not the position.
    flipped = collect_units([{"units": [b, a]}], labels)
    assert {u["path"]: u["person_ids"] for u in flipped} == {
        "/m/0.jpg": ["person-0000"],
        "/m/1.jpg": ["person-0001"],
    }

    # A unit inferred after clustering makes the labels stale.
    with pytest.raises(ExportError, match="stale"):
        collect_units([{"units": [_unit_for(2), a, b]}], labels)
    # So does a unit that disappeared.
    with pytest.raises(ExportError, match="stale"):
        collect_units(records[:0] + [{"units": [a]}], labels)


def test_legacy_labels_without_keys_still_join_by_position(layout):
    from mmindex.export import collect_units

    units = collect_units(
        [{"units": [_unit_for(0), _unit_for(1)]}],
        {"labels": [0], "unit_refs": [[1, 0]]},
    )
    assert [u["person_ids"] for u in units] == [[], ["person-0000"]]


def test_search_ranks_without_building_a_hit_per_row(layout, settings, monkeypatch):
    """Regression: every candidate row got a SearchHit, parsed person_ids and
    lowercased its OCR/ASR text before the top k was taken."""
    from mmindex.export import export_snapshot
    from mmindex.search import Index

    dim = 64
    settings.clip_embedding_dim = dim
    # One distinct axis per unit, so no two similarities tie.
    units = []
    for i in range(dim):
        unit = _unit(i, dim=dim, text=f"caption {i}")
        unit["clip_embedding"] = np.eye(dim, dtype=np.float32)[i]
        units.append(unit)
    export_snapshot(units, layout, settings)
    index = Index.open(layout, settings)

    built: list = []
    original = index.search.__globals__["SearchHit"]

    class Counting(original):
        def __init__(self, *args, **kwargs):
            built.append(kwargs.get("unit_id"))
            super().__init__(*args, **kwargs)

    monkeypatch.setitem(index.search.__globals__, "SearchHit", Counting)
    query = np.eye(dim, dtype=np.float32)[3]
    hits = index.search(query, text="caption 3", limit=5)

    assert len(hits) == 5
    assert len(built) == 5, "a SearchHit was built for a row outside the top k"
    assert hits[0].path.endswith("file3.jpg")
    assert hits[0].text_bonus == pytest.approx(settings.text_bonus)


def test_search_still_honours_min_score_and_ties(layout, settings):
    from mmindex.export import export_snapshot
    from mmindex.search import Index

    settings.clip_embedding_dim = 8
    # Three units share one vector, so their scores tie exactly.
    units = [_unit(0), _unit(8), _unit(16), _unit(3)]
    export_snapshot(units, layout, settings)
    index = Index.open(layout, settings)

    query = np.eye(8, dtype=np.float32)[0]
    hits = index.search(query, limit=2)
    assert [h.path for h in hits] == ["/media/file0.jpg", "/media/file16.jpg"]

    assert index.search(query, limit=0) == []
    assert all(hit.score >= 0.9 for hit in index.search(query, limit=4, min_score=0.9))
