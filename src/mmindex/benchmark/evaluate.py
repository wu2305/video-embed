"""Score an index against the benchmark ground truth.

Three families of metric, matching what the reference notebook's injected
redundancy is designed to test:

``dedup``
    Exact-copy detection (xxhash64 + SHA256), and how many injected copies were
    folded into their master instead of becoming separate units.
``master_election``
    Whether the sharp original, not the lossy or motion-blurred variant, is the
    searchable master of a near-duplicate group.
``retrieval``
    Recall@K for SigLIP text queries built from Flickr30k captions, and face
    clustering purity on LFW, where the directory name is the person label.

The metrics are computed from the exported snapshot, not from pipeline
internals, so they measure the artefact users actually search.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

import numpy as np


@dataclass
class DedupScore:
    exact_expected: int = 0
    exact_detected: int = 0
    exact_missed: list = field(default_factory=list)
    compressed_expected: int = 0
    compressed_folded: int = 0
    blurred_expected: int = 0
    blurred_folded: int = 0
    master_correct: int = 0
    master_wrong: list = field(default_factory=list)

    @property
    def exact_recall(self) -> float:
        return self.exact_detected / self.exact_expected if self.exact_expected else 1.0

    @property
    def compressed_fold_rate(self) -> float:
        return self.compressed_folded / self.compressed_expected if self.compressed_expected else 1.0

    @property
    def blurred_fold_rate(self) -> float:
        return self.blurred_folded / self.blurred_expected if self.blurred_expected else 1.0

    @property
    def master_accuracy(self) -> float:
        total = self.master_correct + len(self.master_wrong)
        return self.master_correct / total if total else 1.0

    def to_dict(self) -> dict:
        return {
            "exact_expected": self.exact_expected,
            "exact_detected": self.exact_detected,
            "exact_recall": round(self.exact_recall, 4),
            "compressed_expected": self.compressed_expected,
            "compressed_folded": self.compressed_folded,
            "compressed_fold_rate": round(self.compressed_fold_rate, 4),
            "blurred_expected": self.blurred_expected,
            "blurred_folded": self.blurred_folded,
            "blurred_fold_rate": round(self.blurred_fold_rate, 4),
            "master_correct": self.master_correct,
            "master_accuracy": round(self.master_accuracy, 4),
            "master_wrong": self.master_wrong[:20],
            "exact_missed": self.exact_missed[:20],
        }


@dataclass
class RetrievalScore:
    queries: int = 0
    skipped: int = 0
    recall_at_1: float = 0.0
    recall_at_5: float = 0.0
    recall_at_10: float = 0.0
    mrr: float = 0.0
    per_query: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "queries": self.queries,
            "skipped_non_master": self.skipped,
            "recall_at_1": round(self.recall_at_1, 4),
            "recall_at_5": round(self.recall_at_5, 4),
            "recall_at_10": round(self.recall_at_10, 4),
            "mrr": round(self.mrr, 4),
        }


@dataclass
class ClusterScore:
    labelled_faces: int = 0
    clusters: int = 0
    purity: float = 0.0
    persons_in_ground_truth: int = 0
    persons_recovered: int = 0
    noise_fraction: float = 0.0

    def to_dict(self) -> dict:
        return {
            "labelled_faces": self.labelled_faces,
            "clusters": self.clusters,
            "purity": round(self.purity, 4),
            "persons_in_ground_truth": self.persons_in_ground_truth,
            "persons_recovered": self.persons_recovered,
            "noise_fraction": round(self.noise_fraction, 4),
        }


# --------------------------------------------------------------- dedup


def score_dedup(
    manifest: Sequence[dict],
    ground_truth: dict,
    root: Path,
    dedup_report: dict | None = None,
) -> DedupScore:
    """Compare the pipeline's dedup decisions with the injected ground truth.

    The manifest holds canonical files only — exact duplicates are folded into
    ``deduplicated.json`` rather than listed — so a duplicate is correctly
    detected when it appears in a group keyed by its master, not when it
    carries its own manifest entry.
    """
    score = DedupScore()
    by_rel = {entry["rel_path"]: entry for entry in manifest}
    duplicate_groups = (dedup_report or {}).get("groups") or {}
    folded_paths = {dup for dups in duplicate_groups.values() for dup in dups}

    for pair in ground_truth.get("exact_duplicates", []):
        score.exact_expected += 1
        master_rel = pair["master"]
        duplicate_rel = pair["duplicate"]
        master = by_rel.get(master_rel)
        if master is None:
            score.exact_missed.append({"duplicate": duplicate_rel, "reason": "master missing"})
            continue
        # Correct when the duplicate was folded into this master's group.
        if duplicate_rel in duplicate_groups.get(master_rel, []):
            score.exact_detected += 1
        elif duplicate_rel in folded_paths:
            score.exact_missed.append(
                {"duplicate": duplicate_rel, "reason": "folded into a different master"}
            )
        else:
            score.exact_missed.append(
                {"duplicate": duplicate_rel, "reason": "not detected as a duplicate"}
            )

    snapshot = _load_units(root)
    if snapshot is None:
        return score

    def lookup(rel: str):
        """Find a unit by relative path; stored paths may be absolute."""
        return snapshot.get(_norm(rel)) or _lookup_suffix(snapshot, rel)

    def folded(path_rel: str, master_rel: str) -> bool:
        row = lookup(path_rel)
        master = lookup(master_rel)
        if row is None or master is None:
            return False
        # Folded means not a searchable master, or mapped onto the master's unit.
        return (not row["is_master"]) or row["path"] == master["path"]

    for pair in ground_truth.get("compressed_variants", []):
        score.compressed_expected += 1
        if folded(pair["compressed"], pair["master"]):
            score.compressed_folded += 1

    for pair in ground_truth.get("blurry_bursts", []):
        score.blurred_expected += 1
        if folded(pair["blurry_frame"], pair["sharp_cover"]):
            score.blurred_folded += 1
        master = lookup(pair["sharp_cover"])
        blurry = lookup(pair["blurry_frame"])
        if master is None:
            continue
        if blurry is not None and blurry["is_master"]:
            score.master_wrong.append(
                {"expected_master": pair["sharp_cover"], "chosen": pair["blurry_frame"]}
            )
        else:
            score.master_correct += 1

    return score


# ----------------------------------------------------------- retrieval


def score_retrieval(
    index,
    captions: dict[str, list[str]],
    backend,
    *,
    ks: Sequence[int] = (1, 5, 10),
    max_queries: int = 200,
    seed: int = 42,
    log=print,
) -> RetrievalScore:
    """Recall@K when querying with a real caption for its own image.

    A query counts as a hit at rank ``k`` when the retrieved unit's path is the
    image the caption describes. Queries whose target is not in the index are
    skipped so the denominator stays honest.
    """
    score = RetrievalScore()
    paths = sorted(captions)
    if not paths:
        return score
    rng = np.random.default_rng(seed)
    if len(paths) > max_queries:
        picks = rng.choice(len(paths), size=max_queries, replace=False)
        paths = [paths[i] for i in sorted(picks)]

    hits = {k: 0 for k in ks}
    reciprocal = 0.0
    used = 0
    skipped = 0
    # Search as a user does: masters only, matching the reference
    # hybrid_search(only_master=True). A target demoted to a non-master (for
    # example because it was chosen as a compressed variant) cannot be found,
    # so its query is skipped rather than counted as a miss.
    master_paths = _master_paths(index)
    for position, rel in enumerate(paths, start=1):
        captions_for = captions.get(rel) or []
        caption = next((c.strip() for c in captions_for if c and c.strip()), "")
        if not caption:
            continue
        target = _norm(rel)
        if master_paths is not None and not any(p.endswith(target) for p in master_paths):
            skipped += 1
            continue
        if position % 25 == 0:
            log(f"  retrieval: {position}/{len(paths)} queries")
        vector = backend.embed_text(caption)
        results = index.search(vector, limit=max(ks))
        if not results:
            continue
        used += 1
        found = next(
            (rank for rank, hit in enumerate(results, start=1) if _norm(hit.path).endswith(target)),
            None,
        )
        if found is None:
            score.per_query.append({"caption": caption, "target": rel, "rank": None})
            continue
        for k in ks:
            if found <= k:
                hits[k] += 1
        reciprocal += 1.0 / found
        score.per_query.append({"caption": caption, "target": rel, "rank": found})

    score.queries = used
    score.skipped = skipped
    if used:
        score.recall_at_1 = hits[1] / used
        score.recall_at_5 = hits[5] / used
        score.recall_at_10 = hits[10] / used
        score.mrr = reciprocal / used
    return score


def _master_paths(index) -> set[str] | None:
    """Paths of units that are searchable masters."""
    conn = sqlite3.connect(index.db_path)
    try:
        rows = conn.execute("SELECT path FROM units WHERE is_master = 1").fetchall()
    finally:
        conn.close()
    return {_norm(row[0]) for row in rows}


# ------------------------------------------------------------- clusters


def score_clusters(index, corpus_root: Path) -> ClusterScore:
    """Purity of person clusters against LFW directory labels.

    Each LFW image lives under ``<year>_<person>/``, so the person name is the
    ground-truth identity. Purity is the fraction of labelled units whose
    assigned person cluster is dominated by their own name.
    """
    score = ClusterScore()
    lfw_root = corpus_root / "01_LFW_People_Archive"
    if not lfw_root.exists():
        return score

    labels: dict[str, str] = {}
    for path in lfw_root.rglob("*.jpg"):
        person = path.parent.name
        if "_" in person:
            person = person.split("_", 1)[1]
        labels[_norm(str(path.relative_to(corpus_root)))] = person
    score.persons_in_ground_truth = len(set(labels.values()))

    conn = sqlite3.connect(index.db_path)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT path, person_ids FROM units WHERE person_ids != '[]'"
        ).fetchall()
    finally:
        conn.close()

    cluster_to_names: dict[str, list[str]] = {}
    assigned = 0
    for row in rows:
        rel = _norm(row["path"])
        name = next((v for k, v in labels.items() if rel.endswith(k)), None)
        if name is None:
            continue
        assigned += 1
        for person_id in json.loads(row["person_ids"]):
            cluster_to_names.setdefault(person_id, []).append(name)

    score.labelled_faces = assigned
    score.clusters = len(cluster_to_names)
    if not cluster_to_names:
        return score

    from collections import Counter

    correct = 0
    recovered = set()
    for names in cluster_to_names.values():
        counts = Counter(names)
        top_name, top_count = counts.most_common(1)[0]
        correct += top_count
        recovered.add(top_name)
    score.purity = correct / assigned if assigned else 0.0
    score.persons_recovered = len(recovered)

    total_units = _unit_count(index)
    if total_units:
        score.noise_fraction = 1.0 - (assigned / total_units)
    return score


# --------------------------------------------------------------- helpers


def _unit_count(index) -> int:
    conn = sqlite3.connect(index.db_path)
    try:
        return int(conn.execute("SELECT COUNT(*) FROM units").fetchone()[0])
    finally:
        conn.close()


def _load_units(root: Path) -> dict[str, dict] | None:
    """Load the active snapshot's units keyed by normalised relative path."""
    manifest_path = root / "index_manifest.json"
    if not manifest_path.exists():
        return None
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    if not manifest.get("complete"):
        return None
    db = Path(manifest["snapshot_dir"]) / "historical_media_index.sqlite"
    if not db.exists():
        return None
    conn = sqlite3.connect(db)
    conn.row_factory = sqlite3.Row
    try:
        rows = conn.execute(
            "SELECT path, is_master FROM units ORDER BY unit_index"
        ).fetchall()
    finally:
        conn.close()
    return {
        _norm(row["path"]): {"path": row["path"], "is_master": bool(row["is_master"])}
        for row in rows
    }


def _norm(path: str) -> str:
    return str(path).replace("\\", "/")


def _lookup_suffix(snapshot: dict[str, dict], rel: str) -> dict | None:
    """Match a relative ground-truth path against an absolute stored path."""
    suffix = "/" + _norm(rel).lstrip("/")
    for key, row in snapshot.items():
        if key.endswith(suffix):
            return row
    return None
