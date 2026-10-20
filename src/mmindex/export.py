"""Stage 5 — build a consistent index snapshot and swap the manifest atomically.

The snapshot is three files whose row alignment is verified before the
``index_manifest.json`` pointer is replaced:

``historical_media_index.sqlite``
    One row per visual unit.  ``vec_row_idx`` is the row in the embedding matrix.
``siglip_embeddings_fp16.npy``
    ``float16`` matrix with one row per unit, L2-normalised.
``person_catalog.json``
    Cluster catalogue from stage 4.

A snapshot is only published after every check passes, so a crashed export can
never leave a half-written index visible to search.
"""

from __future__ import annotations

import json
import os
import shutil
import sqlite3
import time
import uuid
from pathlib import Path
from typing import Iterable, Sequence

import numpy as np

from .backends import l2_normalize
from .clustering import unit_key
from .config import Layout, Settings

SCHEMA = """
CREATE TABLE IF NOT EXISTS units (
    unit_id        INTEGER PRIMARY KEY,
    vec_row_idx    INTEGER NOT NULL UNIQUE,
    path           TEXT NOT NULL,
    digest         TEXT NOT NULL,
    kind           TEXT NOT NULL,
    unit_index     INTEGER NOT NULL,
    canonical_time REAL NOT NULL,
    scene_start    REAL,
    scene_end      REAL,
    ocr_text       TEXT,
    asr_text       TEXT,
    dhash          TEXT,
    sharpness      REAL,
    face_count     INTEGER NOT NULL,
    person_ids     TEXT,
    width          INTEGER,
    height         INTEGER,
    is_master      INTEGER NOT NULL DEFAULT 1,
    clip_norm      REAL
);
CREATE INDEX IF NOT EXISTS units_path ON units(path);
CREATE INDEX IF NOT EXISTS units_digest ON units(digest);
CREATE INDEX IF NOT EXISTS units_master ON units(is_master);
CREATE TABLE IF NOT EXISTS meta (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
"""


class ExportError(RuntimeError):
    """Raised when the snapshot fails a consistency check."""


def _snapshot_id() -> str:
    return f"{time.strftime('%Y%m%dT%H%M%SZ', time.gmtime())}_{uuid.uuid4().hex[:8]}"


_DHASH_BITS = 64
_PAIR_BLOCK = 4_000_000  # xor-matrix cells per numpy block, bounds peak memory


def _band_layout(bands: int, total_bits: int = _DHASH_BITS) -> list[tuple[int, int]]:
    """``(shift, width)`` for ``bands`` contiguous bit ranges covering every bit."""
    base, extra = divmod(total_bits, bands)
    layout: list[tuple[int, int]] = []
    shift = 0
    for band in range(bands):
        width = base + (1 if band < extra else 0)
        layout.append((shift, width))
        shift += width
    return layout


def _popcount(values: np.ndarray) -> np.ndarray:
    """Per-element population count of a ``uint64`` array."""
    if hasattr(np, "bitwise_count"):  # numpy >= 2.0
        return np.bitwise_count(values).astype(np.int64)
    one, two, four = np.uint64(1), np.uint64(2), np.uint64(4)
    m1, m2, m4 = (np.uint64(c) for c in (0x5555555555555555, 0x3333333333333333, 0x0F0F0F0F0F0F0F0F))
    values = values - ((values >> one) & m1)
    values = (values & m2) + ((values >> two) & m2)
    values = (values + (values >> four)) & m4
    return ((values * np.uint64(0x0101010101010101)) >> np.uint64(56)).astype(np.int64)


def near_duplicates(units: Sequence[dict], settings: Settings) -> dict[int, bool]:
    """Mark the sharpest member of each dhash near-duplicate group as master.

    Candidate pairs come from multi-index hashing: the 64-bit dhash is cut into
    ``near_dup_hamming + 1`` bands covering every bit, and two hashes within
    ``near_dup_hamming`` bits must agree exactly on at least one band (pigeonhole),
    so no qualifying pair is missed. Candidates sharing a band are confirmed with
    a full hamming comparison in numpy blocks, and confirmed pairs are merged
    into groups with union-find, so memory stays proportional to the unit count.

    Returns ``{unit_index: is_master}`` for every unit.
    """
    masters: dict[int, bool] = {i: True for i in range(len(units))}
    indices = [i for i, unit in enumerate(units) if unit.get("dhash")]
    if len(indices) < 2:
        return masters

    values = [int(units[i]["dhash"], 16) for i in indices]
    if any(value >> _DHASH_BITS for value in values):
        raise ValueError(f"dhash wider than {_DHASH_BITS} bits")
    # Identical hashes (a run of black or fade frames, say) are one node: they
    # are trivially duplicates of each other, and comparing every pair of them
    # would be quadratic in the size of the run.
    hashes, inverse = np.unique(np.array(values, dtype=np.uint64), return_inverse=True)
    threshold = settings.near_dup_hamming

    parent = np.arange(len(hashes), dtype=np.int64)

    def find_many(nodes: np.ndarray) -> np.ndarray:
        """Roots of ``nodes``, halving paths as it climbs."""
        while True:
            up = parent[nodes]
            if (up == nodes).all():
                return nodes
            parent[nodes] = parent[up]
            nodes = up

    def union_many(left: np.ndarray, right: np.ndarray) -> None:
        """Merge the sets of every ``(left[k], right[k])`` pair."""
        while len(left):
            a, b = find_many(left), find_many(right)
            apart = a != b
            if not apart.any():
                return
            left, right, a, b = left[apart], right[apart], a[apart], b[apart]
            # Several pairs may write the same high root; the survivors are
            # re-checked next round, so a lost write only costs another pass.
            parent[np.maximum(a, b)] = np.minimum(a, b)

    bands = max(1, min(_DHASH_BITS, threshold + 1))
    for shift, width in _band_layout(bands):
        keys = (hashes >> np.uint64(shift)) & np.uint64((1 << width) - 1)
        order = np.argsort(keys, kind="stable")
        sorted_keys = keys[order]
        cuts = np.flatnonzero(sorted_keys[1:] != sorted_keys[:-1]) + 1
        for chunk in np.split(order, cuts):
            size = len(chunk)
            if size < 2:
                continue
            members = hashes[chunk]
            rows_per_block = max(1, _PAIR_BLOCK // size)
            for start in range(0, size, rows_per_block):
                block = members[start : start + rows_per_block]
                close = _popcount(block[:, None] ^ members[None, :]) <= threshold
                rows, cols = np.nonzero(close)
                union_many(chunk[start + rows], chunk[cols])

    roots = find_many(np.arange(len(hashes)))[inverse]
    grouped: dict[int, list[int]] = {}
    for position, root in enumerate(roots.tolist()):
        grouped.setdefault(root, []).append(indices[position])

    for group in grouped.values():
        if len(group) < 2:
            continue
        best = max(group, key=lambda i: float(units[i].get("sharpness") or 0.0))
        best_sharp = float(units[best].get("sharpness") or 0.0)
        for member in group:
            if member == best:
                continue
            member_sharp = float(units[member].get("sharpness") or 0.0)
            if best_sharp <= 0 or member_sharp < best_sharp * settings.near_dup_sharpness_ratio:
                masters[member] = False
    return masters


def collect_units(
    records: Iterable[dict],
    person_labels: dict | None = None,
) -> list[dict]:
    """Flatten stage-3 records into a flat unit list with person ids attached.

    Labels written with ``unit_keys`` are joined by unit identity and must cover
    exactly the units being exported; otherwise they were computed for a different
    corpus and :class:`ExportError` tells the caller to re-run ``cluster``. Labels
    from older runs carry no keys and fall back to the positional join.
    """
    units: list[dict] = []
    for record in records:
        for unit in record.get("units") or []:
            copy = dict(unit)
            copy.setdefault("person_ids", [])
            if record.get("backend"):
                copy.setdefault("backend", record["backend"])
            if "sharpness_edge" in record:
                copy.setdefault("sharpness_edge", record["sharpness_edge"])
            units.append(copy)

    if person_labels:
        labels = person_labels.get("labels") or []
        refs = person_labels.get("unit_refs") or []
        keys = person_labels.get("unit_keys")
        if keys is not None:
            labelled = [(k[0], k[1], int(k[2])) for k in keys]
            current = {unit_key(unit) for unit in units}
            if current != set(labelled):
                raise ExportError(
                    "person labels are stale: they cover "
                    f"{len(set(labelled))} units, {len(set(labelled) - current)} no longer "
                    f"present and {len(current - set(labelled))} not yet clustered; "
                    "re-run the cluster stage before exporting"
                )
            by_key: dict[tuple, set[str]] = {}
            for label, ref in zip(labels, refs):
                if label != -1:
                    by_key.setdefault(labelled[int(ref[0])], set()).add(f"person-{int(label):04d}")
            for unit in units:
                unit["person_ids"] = sorted(by_key.get(unit_key(unit), ()))
            return units

        by_unit: dict[int, list[str]] = {}
        for label, ref in zip(labels, refs):
            if label == -1:
                continue
            by_unit.setdefault(int(ref[0]), []).append(f"person-{int(label):04d}")
        for index, unit in enumerate(units):
            unit["person_ids"] = sorted(set(by_unit.get(index, [])))
    return units


def resolve_backend(units: Sequence[dict], settings: Settings) -> str:
    """The one inference backend that produced ``units``.

    Hash pseudo-embeddings and real model embeddings live in unrelated vector
    spaces, so a snapshot mixing them would rank nonsense. Units carry the name
    of the backend that made them; with none recorded, fall back to the setting.
    """
    names = sorted({unit["backend"] for unit in units if unit.get("backend")})
    if len(names) > 1:
        raise ExportError(
            f"units come from several inference backends {names}; re-run the infer "
            "stage with one backend before exporting"
        )
    return names[0] if names else settings.backend


def resolve_sharpness_edge(units: Sequence[dict], settings: Settings) -> int:
    """The one scale the units' sharpness values were measured at.

    Sharpness is only comparable at a fixed size (``media.sharpness``), and
    master election compares it across files. A record set written partly at the
    old full-resolution scale and partly at the normalised one would elect
    masters by an artefact of when each file was inferred, so refuse the mix.
    Units with no scale recorded predate the field and are all treated as raw.
    """
    edges = sorted({int(unit.get("sharpness_edge") or 0) for unit in units})
    if len(edges) > 1:
        raise ExportError(
            f"units record {len(edges)} sharpness scales {edges}; sharpness is only "
            "comparable at one scale, so re-run the infer stage for the whole corpus"
        )
    return edges[0] if edges else int(settings.sharpness_edge)


def export_snapshot(
    units: Sequence[dict],
    layout: Layout,
    settings: Settings,
    *,
    catalog: dict | None = None,
    manifest_extra: dict | None = None,
) -> dict:
    """Write a snapshot to local disk and flip the manifest when consistent."""
    layout.ensure()
    backend_name = resolve_backend(units, settings)
    # Checked before any file is written: a mixed-scale corpus must not publish.
    sharpness_edge = resolve_sharpness_edge(units, settings)
    snapshot_dir = layout.snapshots_dir / _snapshot_id()
    tmp_dir = snapshot_dir.with_name(snapshot_dir.name + ".tmp")
    tmp_dir.mkdir(parents=True, exist_ok=False)

    try:
        masters = near_duplicates(units, settings)

        embeddings = np.zeros((len(units), settings.clip_embedding_dim), dtype=np.float32)
        for index, unit in enumerate(units):
            vector = np.asarray(unit.get("clip_embedding"), dtype=np.float32).reshape(-1)
            if vector.shape[0] != settings.clip_embedding_dim:
                raise ExportError(
                    f"unit {index} embedding has {vector.shape[0]} dims, "
                    f"expected {settings.clip_embedding_dim}"
                )
            embeddings[index] = vector
        embeddings = l2_normalize(embeddings) if len(units) else embeddings

        npy_path = tmp_dir / "siglip_embeddings_fp16.npy"
        np.save(npy_path, embeddings.astype(np.float16))

        db_path = tmp_dir / "historical_media_index.sqlite"
        conn = sqlite3.connect(db_path)
        try:
            conn.executescript(SCHEMA)
            rows = []
            for index, unit in enumerate(units):
                rows.append(
                    (
                        index,
                        index,
                        unit.get("path", ""),
                        unit.get("digest", ""),
                        unit.get("kind", ""),
                        int(unit.get("unit_index", 0)),
                        float(unit.get("canonical_time", 0.0)),
                        float(unit.get("scene_start", 0.0)),
                        float(unit.get("scene_end", 0.0)),
                        unit.get("ocr_text", ""),
                        unit.get("asr_text", ""),
                        unit.get("dhash", ""),
                        float(unit.get("sharpness", 0.0)),
                        len(unit.get("faces") or []),
                        json.dumps(unit.get("person_ids") or []),
                        int(unit.get("width", 0)),
                        int(unit.get("height", 0)),
                        1 if masters.get(index, True) else 0,
                        float(np.linalg.norm(embeddings[index])) if len(units) else 0.0,
                    )
                )
            conn.executemany(
                "INSERT INTO units (unit_id, vec_row_idx, path, digest, kind, unit_index,"
                " canonical_time, scene_start, scene_end, ocr_text, asr_text, dhash,"
                " sharpness, face_count, person_ids, width, height, is_master, clip_norm)"
                " VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
                rows,
            )
            meta = {
                "created_at": str(time.time()),
                "unit_count": str(len(units)),
                "embedding_dim": str(settings.clip_embedding_dim),
                "embedding_dtype": "float16",
                "backend": backend_name,
                "master_count": str(sum(1 for v in masters.values() if v)),
            }
            conn.executemany(
                "INSERT OR REPLACE INTO meta (key, value) VALUES (?,?)", sorted(meta.items())
            )
            conn.commit()
        finally:
            conn.close()

        catalog = catalog or {"persons": [], "person_count": 0, "noise_faces": 0}
        (tmp_dir / "person_catalog.json").write_text(
            json.dumps(catalog, default=_encode_default), encoding="utf-8"
        )

        checks = verify_snapshot(tmp_dir, len(units), settings.clip_embedding_dim)
        if not checks["ok"]:
            raise ExportError(f"snapshot consistency check failed: {checks['errors']}")

        os.replace(tmp_dir, snapshot_dir)
    except Exception:
        shutil.rmtree(tmp_dir, ignore_errors=True)
        raise

    manifest = {
        "complete": True,
        "snapshot": snapshot_dir.name,
        "snapshot_dir": str(snapshot_dir),
        "created_at": time.time(),
        "unit_count": len(units),
        "person_count": int((catalog or {}).get("person_count", 0)),
        "checks": checks,
        "settings": {
            "clip_embedding_dim": settings.clip_embedding_dim,
            "face_embedding_dim": settings.face_embedding_dim,
            "backend": backend_name,
            "sharpness_edge": sharpness_edge,
        },
    }
    if manifest_extra:
        manifest.update(manifest_extra)
    write_manifest(layout, manifest)
    return manifest


def verify_snapshot(snapshot_dir: Path, expected_units: int, dim: int) -> dict:
    """Check row alignment, dtype and dimension agreement."""
    errors: list[str] = []
    db_path = snapshot_dir / "historical_media_index.sqlite"
    npy_path = snapshot_dir / "siglip_embeddings_fp16.npy"
    catalog_path = snapshot_dir / "person_catalog.json"

    for path in (db_path, npy_path, catalog_path):
        if not path.exists():
            errors.append(f"missing {path.name}")
    if errors:
        return {"ok": False, "errors": errors}

    matrix = np.load(npy_path, mmap_mode="r")
    if matrix.dtype != np.float16:
        errors.append(f"embedding dtype is {matrix.dtype}, expected float16")
    if matrix.ndim != 2:
        errors.append(f"embedding matrix has {matrix.ndim} dims, expected 2")
    elif matrix.shape[1] != dim:
        errors.append(f"embedding dim is {matrix.shape[1]}, expected {dim}")

    conn = sqlite3.connect(db_path)
    try:
        count = conn.execute("SELECT COUNT(*) FROM units").fetchone()[0]
        max_row = conn.execute("SELECT MAX(vec_row_idx) FROM units").fetchone()[0]
        distinct = conn.execute("SELECT COUNT(DISTINCT vec_row_idx) FROM units").fetchone()[0]
    finally:
        conn.close()

    if count != expected_units:
        errors.append(f"sqlite has {count} units, expected {expected_units}")
    if distinct != count:
        errors.append("vec_row_idx is not unique")
    if count and (max_row is None or max_row != count - 1):
        errors.append(f"max vec_row_idx is {max_row}, expected {count - 1}")
    if matrix.ndim == 2 and matrix.shape[0] != count:
        errors.append(f"matrix has {matrix.shape[0]} rows, sqlite has {count}")

    try:
        json.loads(catalog_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as exc:
        errors.append(f"person_catalog.json invalid: {exc}")

    return {
        "ok": not errors,
        "errors": errors,
        "units": count,
        "rows": int(matrix.shape[0]) if matrix.ndim == 2 else 0,
        "dim": int(matrix.shape[1]) if matrix.ndim == 2 else 0,
    }


def write_manifest(layout: Layout, manifest: dict) -> Path:
    """Atomically replace ``index_manifest.json``."""
    target = layout.index_manifest
    tmp = target.with_name(target.name + ".tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, indent=2, default=_encode_default)
        handle.flush()
        os.fsync(handle.fileno())
    os.replace(tmp, target)
    return target


def read_manifest(layout: Layout) -> dict | None:
    if not layout.index_manifest.exists():
        return None
    return json.loads(layout.index_manifest.read_text(encoding="utf-8"))


def _encode_default(obj):
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    if isinstance(obj, np.generic):
        return obj.item()
    raise TypeError(f"not JSON serialisable: {type(obj)!r}")
