"""Stage 4 — face clustering with HDBSCAN and KMeans prototypes.

CPU behaviour follows ``ARCHITECTURE.md`` section 3.3: exact HDBSCAN below the
PCA threshold, approximate PCA-reduced clustering above it.  The CUDA path from
the production notebook is intentionally not reproduced here; the CPU port is
the target of this package.
"""

from __future__ import annotations

import json
import time
from pathlib import Path
from typing import Sequence

import numpy as np

from .backends import l2_normalize
from .config import Layout, Settings


def cluster_labels(vectors: np.ndarray, settings: Settings) -> tuple[np.ndarray, dict]:
    """Cluster face vectors, returning labels and a diagnostics dict.

    Label ``-1`` marks HDBSCAN noise, which stays unassigned in the catalogue.
    """
    vectors = np.asarray(vectors, dtype=np.float32)
    diagnostics: dict = {"count": int(len(vectors)), "reduced": False}
    if len(vectors) == 0:
        return np.zeros(0, dtype=np.int32), diagnostics
    if len(vectors) < settings.hdbscan_min_cluster_size:
        diagnostics["reason"] = "below min_cluster_size"
        return np.full(len(vectors), -1, dtype=np.int32), diagnostics

    import hdbscan

    reduced = vectors
    if len(vectors) > settings.pca_threshold:
        from sklearn.decomposition import PCA

        pca = PCA(n_components=min(settings.pca_components, vectors.shape[1]), random_state=42)
        reduced = pca.fit_transform(vectors)
        diagnostics["reduced"] = True
        diagnostics["explained_variance"] = float(pca.explained_variance_ratio_.sum())

    clusterer = hdbscan.HDBSCAN(
        min_cluster_size=settings.hdbscan_min_cluster_size,
        min_samples=settings.hdbscan_min_samples,
        metric="euclidean",
        cluster_selection_epsilon=settings.hdbscan_cluster_selection_epsilon,
        core_dist_n_jobs=-1,
    )
    labels = clusterer.fit_predict(reduced)
    diagnostics["clusters"] = int(len(set(labels.tolist()) - {-1}))
    diagnostics["noise"] = int((labels == -1).sum())
    return labels.astype(np.int32), diagnostics


def prototypes(vectors: np.ndarray, settings: Settings) -> np.ndarray:
    """KMeans prototype centres for one cluster, or the mean for tiny clusters."""
    vectors = np.asarray(vectors, dtype=np.float32)
    if len(vectors) == 0:
        return np.zeros((0, vectors.shape[1] if vectors.ndim == 2 else 0), dtype=np.float32)
    k = min(settings.kmeans_prototypes, len(vectors))
    if k < 2:
        return l2_normalize(vectors.mean(axis=0, keepdims=True))
    from sklearn.cluster import KMeans

    model = KMeans(n_clusters=k, n_init=settings.kmeans_n_init, random_state=42)
    model.fit(vectors)
    return l2_normalize(model.cluster_centers_)


def build_catalog(
    labels: np.ndarray,
    vectors: np.ndarray,
    unit_refs: Sequence[tuple[int, int]],
    settings: Settings,
) -> dict:
    """Build ``person_catalog.json`` payload.

    ``unit_refs[i]`` is ``(unit_global_index, face_index)`` for face ``i`` so a
    cluster can be traced back to the units that reference it.
    """
    catalog: dict = {"generated_at": time.time(), "persons": []}
    for label in sorted(set(labels.tolist()) - {-1}):
        mask = labels == label
        member_vectors = vectors[mask]
        refs = [unit_refs[i] for i in np.flatnonzero(mask)]
        centres = prototypes(member_vectors, settings)
        catalog["persons"].append(
            {
                "person_id": f"person-{label:04d}",
                "cluster_label": int(label),
                "face_count": int(mask.sum()),
                "unit_count": int(len({unit for unit, _ in refs})),
                "prototypes": centres,
                "sample_refs": [[int(u), int(f)] for u, f in refs[:32]],
            }
        )
    catalog["noise_faces"] = int((labels == -1).sum())
    catalog["person_count"] = len(catalog["persons"])
    return catalog


def write_catalog(layout: Layout, catalog: dict) -> Path:
    layout.ensure()
    target = layout.persons
    tmp = target.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(catalog, handle, default=_encode_default)
    tmp.replace(target)
    return target


def write_labels(layout: Layout, labels: np.ndarray, unit_refs: Sequence[tuple[int, int]]) -> Path:
    layout.ensure()
    payload = {
        "labels": labels.astype(int).tolist(),
        "unit_refs": [[int(u), int(f)] for u, f in unit_refs],
    }
    target = layout.person_labels
    tmp = target.with_suffix(".json.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle)
    tmp.replace(target)
    return target


def _encode_default(obj):
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, np.generic):
        return obj.item()
    raise TypeError(f"not JSON serialisable: {type(obj)!r}")


def collect_faces(units: Sequence[dict]) -> tuple[np.ndarray, list[tuple[int, int]]]:
    """Flatten every face embedding across units with back-references."""
    vectors: list[np.ndarray] = []
    refs: list[tuple[int, int]] = []
    for unit_index, unit in enumerate(units):
        for face_index, face in enumerate(unit.get("faces") or []):
            vectors.append(np.asarray(face["embedding"], dtype=np.float32))
            refs.append((unit_index, face_index))
    if not vectors:
        return np.zeros((0, 0), dtype=np.float32), []
    return np.vstack(vectors), refs


def cluster_units(units: Sequence[dict], layout: Layout, settings: Settings) -> dict:
    """Run clustering over units and write the catalogue and label files."""
    vectors, refs = collect_faces(units)
    labels, diagnostics = cluster_labels(vectors, settings)
    if len(vectors):
        catalog = build_catalog(labels, vectors, refs, settings)
    else:
        catalog = {"generated_at": time.time(), "persons": [], "person_count": 0, "noise_faces": 0}
    catalog["diagnostics"] = diagnostics
    write_catalog(layout, catalog)
    write_labels(layout, labels, refs)
    return catalog


def assign_person_ids(units: list[dict], labels: np.ndarray, refs: Sequence[tuple[int, int]]) -> None:
    """Attach ``person_ids`` to each unit in place from clustering labels."""
    by_unit: dict[int, list[str]] = {}
    for label, (unit_index, _face_index) in zip(labels.tolist(), refs):
        if label == -1:
            continue
        by_unit.setdefault(unit_index, []).append(f"person-{label:04d}")
    for index, unit in enumerate(units):
        unit["person_ids"] = sorted(set(by_unit.get(index, [])))
