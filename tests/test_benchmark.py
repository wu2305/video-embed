from __future__ import annotations


import numpy as np

from mmindex.benchmark.evaluate import (
    DedupScore,
    score_clusters,
    score_dedup,
    score_retrieval,
)
from mmindex.config import Settings
from mmindex.export import export_snapshot
from mmindex.search import Index


def _unit(index: int, rel: str, *, dim: int = 8, people=(), dhash="", sharp=1.0, master=True):
    return {
        "unit_index": index,
        "path": f"/corpus/{rel}",
        "digest": f"d{index}",
        "kind": "image",
        "canonical_time": 1700000000.0 + index,
        "clip_embedding": np.eye(dim, dtype=np.float32)[index % dim],
        "faces": [{"embedding": np.ones(4, dtype=np.float32)}] * len(people),
        "ocr_text": "",
        "asr_text": "",
        "dhash": dhash or f"{index:016x}",
        "sharpness": sharp,
        "person_ids": list(people),
        "is_master": master,
    }


def _manifest(rows):
    return [
        {
            "rel_path": rel,
            "digest": digest,
            "is_canonical": canonical,
        }
        for rel, digest, canonical in rows
    ]


# ------------------------------------------------------------------ dedup


def test_score_dedup_counts_exact_copies(tmp_path, layout, settings):
    settings.clip_embedding_dim = 8
    export_snapshot([_unit(0, "a.jpg")], layout, settings)
    manifest = _manifest([("a.jpg", "same", True)])
    report = {"groups": {"a.jpg": ["a.jpg", "backup/a.jpg"]}}
    gt = {"exact_duplicates": [{"master": "a.jpg", "duplicate": "backup/a.jpg"}]}
    score = score_dedup(manifest, gt, layout.root, report)
    assert score.exact_expected == 1
    assert score.exact_detected == 1
    assert score.exact_recall == 1.0


def test_score_dedup_detects_missed_copy(tmp_path, layout, settings):
    settings.clip_embedding_dim = 8
    export_snapshot([_unit(0, "a.jpg"), _unit(1, "backup/a.jpg")], layout, settings)
    manifest = _manifest([("a.jpg", "one", True), ("backup/a.jpg", "two", True)])
    gt = {"exact_duplicates": [{"master": "a.jpg", "duplicate": "backup/a.jpg"}]}
    score = score_dedup(manifest, gt, layout.root, {"groups": {}})
    assert score.exact_detected == 0
    assert score.exact_missed
    assert score.exact_missed[0]["reason"] == "not detected as a duplicate"


def test_score_dedup_reports_wrong_master_group(tmp_path, layout, settings):
    settings.clip_embedding_dim = 8
    export_snapshot([_unit(0, "a.jpg")], layout, settings)
    manifest = _manifest([("a.jpg", "same", True)])
    # The duplicate was folded, but under a different master.
    report = {"groups": {"other.jpg": ["other.jpg", "backup/a.jpg"]}}
    gt = {"exact_duplicates": [{"master": "a.jpg", "duplicate": "backup/a.jpg"}]}
    score = score_dedup(manifest, gt, layout.root, report)
    assert score.exact_detected == 0
    assert score.exact_missed[0]["reason"] == "folded into a different master"


def test_score_dedup_uses_separate_index_root(tmp_path, layout, settings):
    """Corpus paths and the published snapshot live in different directories."""
    settings.clip_embedding_dim = 8
    settings.near_dup_hamming = 4
    corpus = tmp_path / "corpus"
    corpus.mkdir()
    # Snapshot lives in the layout root; ground truth is corpus-relative.
    export_snapshot(
        [
            _unit(0, "shot.jpg", dhash="0000000000000000", sharp=100.0),
            _unit(1, "shot_burst.jpg", dhash="0000000000000000", sharp=1.0),
        ],
        layout,
        settings,
    )
    gt = {"blurry_bursts": [{"sharp_cover": "shot.jpg", "blurry_frame": "shot_burst.jpg"}]}
    score = score_dedup([], gt, corpus, {}, index_root=layout.root)
    assert score.blurred_expected == 1
    assert score.blurred_folded == 1
    assert score.master_correct == 1


def test_score_dedup_rebases_absolute_report_paths(tmp_path, layout, settings):
    """The dedup report stores absolute paths; ground truth is relative."""
    settings.clip_embedding_dim = 8
    export_snapshot([_unit(0, "a.jpg")], layout, settings)
    manifest = _manifest([("a.jpg", "same", True)])
    corpus = tmp_path / "corpus"
    report = {
        "groups": {
            f"{corpus}/a.jpg": [f"{corpus}/a.jpg", f"{corpus}/backup/a.jpg"],
        }
    }
    gt = {"exact_duplicates": [{"master": "a.jpg", "duplicate": "backup/a.jpg"}]}
    score = score_dedup(manifest, gt, corpus, report)
    assert score.exact_detected == 1
    assert score.exact_recall == 1.0


def test_score_dedup_master_election_prefers_sharp(tmp_path, layout, settings):
    settings.clip_embedding_dim = 8
    # Same dhash, very different sharpness: export must elect the sharp one.
    export_snapshot(
        [
            _unit(0, "shot.jpg", dhash="0000000000000000", sharp=100.0),
            _unit(1, "shot_burst.jpg", dhash="0000000000000000", sharp=2.0),
        ],
        layout,
        settings,
    )
    gt = {"blurry_bursts": [{"sharp_cover": "shot.jpg", "blurry_frame": "shot_burst.jpg"}]}
    score = score_dedup(_manifest([("shot.jpg", "a", True)]), gt, layout.root)
    assert score.blurred_expected == 1
    assert score.blurred_folded == 1
    assert score.master_correct == 1
    assert score.master_wrong == []


def test_score_dedup_reports_wrong_master(tmp_path, layout, settings):
    settings.clip_embedding_dim = 8
    # The blurred frame is sharper per the metric, so export elects it — a
    # mis-election the scorer must report rather than silently accept.
    export_snapshot(
        [
            _unit(0, "shot.jpg", dhash="0000000000000000", sharp=2.0),
            _unit(1, "shot_burst.jpg", dhash="0000000000000000", sharp=100.0),
        ],
        layout,
        settings,
    )
    gt = {"blurry_bursts": [{"sharp_cover": "shot.jpg", "blurry_frame": "shot_burst.jpg"}]}
    score = score_dedup([], gt, layout.root)
    assert score.master_wrong
    assert score.master_accuracy == 0.0


def test_score_dedup_empty_ground_truth_is_perfect(tmp_path, layout, settings):
    settings.clip_embedding_dim = 8
    export_snapshot([_unit(0, "a.jpg")], layout, settings)
    score = score_dedup([], {}, layout.root)
    assert score.exact_recall == 1.0
    assert score.master_accuracy == 1.0


# -------------------------------------------------------------- retrieval


class _FakeBackend:
    """Returns the embedding of whichever image the caption names."""

    def __init__(self, mapping):
        self.mapping = mapping
        self.settings = Settings()

    def embed_text(self, text):
        vector = self.mapping.get(text)
        if vector is None:
            raise AssertionError(f"unexpected caption {text!r}")
        return vector


def test_score_retrieval_recall_at_k(layout, settings):
    settings.clip_embedding_dim = 8
    units = [_unit(i, f"img{i}.jpg") for i in range(4)]
    export_snapshot(units, layout, settings)
    index = Index.open(layout, settings)
    captions = {f"img{i}.jpg": [f"caption {i}"] for i in range(4)}
    backend = _FakeBackend(
        {f"caption {i}": np.eye(8, dtype=np.float32)[i] for i in range(4)}
    )
    score = score_retrieval(index, captions, backend, log=lambda _m: None)
    assert score.queries == 4
    assert score.recall_at_1 == 1.0
    assert score.mrr == 1.0


def test_score_retrieval_handles_misses(layout, settings):
    settings.clip_embedding_dim = 8
    export_snapshot([_unit(0, "a.jpg"), _unit(1, "b.jpg")], layout, settings)
    index = Index.open(layout, settings)
    captions = {"a.jpg": ["caption a"]}
    # Query with b's vector, so a.jpg is not the top hit.
    backend = _FakeBackend({"caption a": np.eye(8, dtype=np.float32)[1]})
    score = score_retrieval(index, captions, backend, log=lambda _m: None)
    assert score.queries == 1
    assert score.recall_at_1 == 0.0


def test_score_retrieval_skips_empty_captions(layout, settings):
    settings.clip_embedding_dim = 8
    export_snapshot([_unit(0, "a.jpg")], layout, settings)
    index = Index.open(layout, settings)
    score = score_retrieval(index, {"a.jpg": []}, _FakeBackend({}), log=lambda _m: None)
    assert score.queries == 0


def test_score_retrieval_skips_demoted_targets(layout, settings):
    """A target folded into a near-duplicate group cannot be retrieved."""
    settings.clip_embedding_dim = 8
    settings.near_dup_hamming = 4
    export_snapshot(
        [
            _unit(0, "sharp.jpg", dhash="0000000000000000", sharp=100.0),
            _unit(1, "blurry.jpg", dhash="0000000000000000", sharp=1.0),
        ],
        layout,
        settings,
    )
    index = Index.open(layout, settings)
    captions = {"blurry.jpg": ["a blurry shot"]}
    backend = _FakeBackend({"a blurry shot": np.eye(8, dtype=np.float32)[1]})
    score = score_retrieval(index, captions, backend, log=lambda _m: None)
    assert score.queries == 0
    assert score.skipped == 1


# --------------------------------------------------------------- clusters


def test_score_clusters_purity(layout, settings, tmp_path):
    settings.clip_embedding_dim = 8
    corpus = tmp_path / "corpus"
    lfw = corpus / "01_LFW_People_Archive" / "2020_Alice"
    lfw.mkdir(parents=True)
    (lfw / "a1.jpg").write_bytes(b"x")
    (lfw / "a2.jpg").write_bytes(b"x")

    units = [
        {**_unit(0, "01_LFW_People_Archive/2020_Alice/a1.jpg"), "person_ids": ["person-0000"]},
        {**_unit(1, "01_LFW_People_Archive/2020_Alice/a2.jpg"), "person_ids": ["person-0000"]},
    ]
    export_snapshot(units, layout, settings)
    index = Index.open(layout, settings)
    score = score_clusters(index, corpus)
    assert score.labelled_faces == 2
    assert score.clusters == 1
    assert score.purity == 1.0
    assert score.persons_recovered == 1


def test_score_clusters_without_lfw_is_empty(layout, settings, tmp_path):
    settings.clip_embedding_dim = 8
    export_snapshot([_unit(0, "x.jpg")], layout, settings)
    index = Index.open(layout, settings)
    score = score_clusters(index, tmp_path / "empty")
    assert score.labelled_faces == 0
    assert score.purity == 0.0


def test_dedup_score_to_dict_shape():
    payload = DedupScore(exact_expected=2, exact_detected=1).to_dict()
    assert payload["exact_recall"] == 0.5
    assert "master_accuracy" in payload
