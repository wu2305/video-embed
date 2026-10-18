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


def near_duplicates(units: Sequence[dict], settings: Settings) -> dict[int, bool]:
    """Mark the sharpest member of each dhash near-duplicate group as master.

    Returns ``{unit_index: is_master}`` for every unit.
    """
    from .media import hamming

    masters: dict[int, bool] = {i: True for i in range(len(units))}
    buckets: dict[str, list[int]] = {}
    for index, unit in enumerate(units):
        key = (unit.get("dhash") or "")[:8]
        if key:
            buckets.setdefault(key, []).append(index)

    for key, members in buckets.items():
        if len(members) < 2:
            continue
        # Cluster by hamming distance within the prefix bucket.
        groups: list[list[int]] = []
        for member in members:
            placed = False
            for group in groups:
                if hamming(units[group[0]]["dhash"], units[member]["dhash"]) <= settings.near_dup_hamming:
                    group.append(member)
                    placed = True
                    break
            if not placed:
                groups.append([member])
        for group in groups:
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
    """Flatten stage-3 records into a flat unit list with person ids attached."""
    units: list[dict] = []
    for record in records:
        for unit in record.get("units") or []:
            copy = dict(unit)
            copy.setdefault("person_ids", [])
            units.append(copy)

    if person_labels:
        labels = person_labels.get("labels") or []
        refs = person_labels.get("unit_refs") or []
        by_unit: dict[int, list[str]] = {}
        for label, ref in zip(labels, refs):
            if label == -1:
                continue
            by_unit.setdefault(int(ref[0]), []).append(f"person-{int(label):04d}")
        for index, unit in enumerate(units):
            unit["person_ids"] = sorted(set(by_unit.get(index, [])))
    return units


def _unit_text(unit: dict) -> str:
    return " ".join(
        part.strip()
        for part in (unit.get("ocr_text") or "", unit.get("asr_text") or "")
        if part and part.strip()
    )


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
                "backend": settings.backend,
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
            "backend": settings.backend,
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
