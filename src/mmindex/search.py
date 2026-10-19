"""Hybrid search over an exported index snapshot.

Score = cosine similarity over normalised SigLIP vectors, plus a fixed bonus
when the query term appears in the unit's OCR/ASR text (``text_bonus`` 0.15 by
default).  Supports person filtering and a minimum face count, matching the
production ``hybrid_search()`` contract.
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field
from pathlib import Path
from typing import Sequence

import numpy as np

from .backends import l2_normalize
from .config import Layout, Settings
from .export import read_manifest


@dataclass
class SearchHit:
    unit_id: int
    path: str
    score: float
    similarity: float
    text_bonus: float
    kind: str
    canonical_time: float
    ocr_text: str = ""
    asr_text: str = ""
    person_ids: list[str] = field(default_factory=list)
    face_count: int = 0
    is_master: bool = True
    unit_index: int = 0

    def to_dict(self) -> dict:
        return {
            "unit_id": self.unit_id,
            "path": self.path,
            "score": self.score,
            "similarity": self.similarity,
            "text_bonus": self.text_bonus,
            "kind": self.kind,
            "canonical_time": self.canonical_time,
            "ocr_text": self.ocr_text,
            "asr_text": self.asr_text,
            "person_ids": self.person_ids,
            "face_count": self.face_count,
            "is_master": self.is_master,
            "unit_index": self.unit_index,
        }


class Index:
    """Read-only handle on one published snapshot."""

    def __init__(self, snapshot_dir: str | Path, settings: Settings | None = None) -> None:
        self.snapshot_dir = Path(snapshot_dir)
        self.settings = settings or Settings()
        self.db_path = self.snapshot_dir / "historical_media_index.sqlite"
        self.npy_path = self.snapshot_dir / "siglip_embeddings_fp16.npy"
        if not self.db_path.exists() or not self.npy_path.exists():
            raise FileNotFoundError(f"incomplete snapshot: {self.snapshot_dir}")
        self.matrix = np.load(self.npy_path).astype(np.float32)
        self.matrix = l2_normalize(self.matrix)
        self.backend = self._read_backend()
        catalog_path = self.snapshot_dir / "person_catalog.json"
        self.catalog = (
            json.loads(catalog_path.read_text(encoding="utf-8"))
            if catalog_path.exists()
            else {"persons": []}
        )

    @classmethod
    def open(cls, layout: Layout, settings: Settings | None = None) -> "Index":
        manifest = read_manifest(layout)
        if not manifest or not manifest.get("complete"):
            raise FileNotFoundError(f"no complete index manifest at {layout.index_manifest}")
        return cls(manifest["snapshot_dir"], settings)

    def _read_backend(self) -> str | None:
        conn = sqlite3.connect(self.db_path)
        try:
            row = conn.execute("SELECT value FROM meta WHERE key='backend'").fetchone()
        except sqlite3.Error:
            return None
        finally:
            conn.close()
        return row[0] if row else None

    def check_backend(self, name: str) -> None:
        """Refuse a query embedded by a different backend than the one that built
        the index: the vectors would not be comparable and the ranking is noise.
        Snapshots from before the backend was recorded (``auto`` or absent) pass.
        """
        if self.backend in ("hash", "ml") and name in ("hash", "ml") and name != self.backend:
            raise ValueError(
                f"index was built with the '{self.backend}' backend but the query was "
                f"embedded with '{name}'; pass --backend {self.backend}"
            )

    def _connect(self) -> sqlite3.Connection:
        conn = sqlite3.connect(self.db_path)
        conn.row_factory = sqlite3.Row
        return conn

    def _candidates(
        self,
        conn: sqlite3.Connection,
        *,
        person_id: str | None,
        min_faces: int,
        include_non_master: bool,
        paths: Sequence[str] | None,
    ) -> list[sqlite3.Row]:
        clauses = ["face_count >= ?"]
        params: list = [min_faces]
        if not include_non_master:
            clauses.append("is_master = 1")
        if person_id:
            clauses.append("person_ids LIKE ?")
            params.append(f'%"{person_id}"%')
        if paths:
            placeholders = ",".join("?" for _ in paths)
            clauses.append(f"path IN ({placeholders})")
            params.extend(paths)
        sql = f"SELECT * FROM units WHERE {' AND '.join(clauses)} ORDER BY vec_row_idx"
        return conn.execute(sql, params).fetchall()

    def search(
        self,
        query_vector: np.ndarray | None = None,
        *,
        text: str | None = None,
        limit: int = 20,
        person_id: str | None = None,
        min_faces: int = 0,
        include_non_master: bool = False,
        paths: Sequence[str] | None = None,
        min_score: float | None = None,
    ) -> list[SearchHit]:
        """Score candidates by cosine similarity plus a text-match bonus."""
        if query_vector is None and not text:
            raise ValueError("search requires a query vector, text, or both")

        conn = self._connect()
        try:
            rows = self._candidates(
                conn,
                person_id=person_id,
                min_faces=min_faces,
                include_non_master=include_non_master,
                paths=paths,
            )
        finally:
            conn.close()

        if not rows:
            return []

        rows_index = np.fromiter((row["vec_row_idx"] for row in rows), dtype=np.int64)
        if query_vector is not None:
            vector = l2_normalize(np.asarray(query_vector, dtype=np.float32).reshape(-1))
            if vector.shape[0] != self.matrix.shape[1]:
                raise ValueError(
                    f"query vector has {vector.shape[0]} dims, index has {self.matrix.shape[1]}"
                )
            similarities = (self.matrix[rows_index] @ vector).astype(np.float32)
        else:
            similarities = np.zeros(len(rows), dtype=np.float32)

        bonus = self.settings.text_bonus
        needle = (text or "").strip().lower()
        bonuses = np.zeros(len(rows), dtype=np.float32)
        if needle:
            # Only rows that can still reach the top k need their text read: a
            # row matches only if its similarity is within one bonus of the k-th
            # best similarity, so the rest are skipped without touching the
            # OCR/ASR columns.
            cutoff = self._similarity_cutoff(similarities, limit, bonus)
            for position in np.flatnonzero(similarities >= cutoff).tolist():
                row = rows[position]
                haystack = f"{row['ocr_text'] or ''} {row['asr_text'] or ''}".lower()
                if needle in haystack:
                    bonuses[position] = bonus

        scores = similarities + bonuses
        if min_score is not None:
            scores = np.where(scores >= min_score, scores, -np.inf)
        if limit <= 0:
            return []
        if len(scores) > limit:
            # argpartition finds the k best in O(n); only those get a SearchHit.
            top = np.argpartition(-scores, limit - 1)[:limit]
            # Ties at the k-th score are broken by path and unit index, exactly
            # as the previous full sort did, so pull every row sharing that score.
            boundary = float(scores[top].min())
            top = np.flatnonzero(scores >= boundary) if np.isfinite(boundary) else top
        else:
            top = np.arange(len(scores))

        chosen = [position for position in top.tolist() if np.isfinite(scores[position])]
        chosen.sort(
            key=lambda position: (
                -scores[position],
                rows[position]["path"],
                rows[position]["unit_index"],
            )
        )

        hits: list[SearchHit] = []
        for position in chosen:
            row = rows[position]
            hits.append(
                SearchHit(
                    unit_id=int(row["unit_id"]),
                    path=row["path"],
                    score=float(scores[position]),
                    similarity=float(similarities[position]),
                    text_bonus=float(bonuses[position]),
                    kind=row["kind"],
                    canonical_time=float(row["canonical_time"]),
                    ocr_text=row["ocr_text"] or "",
                    asr_text=row["asr_text"] or "",
                    person_ids=json.loads(row["person_ids"] or "[]"),
                    face_count=int(row["face_count"]),
                    is_master=bool(row["is_master"]),
                    unit_index=int(row["unit_index"]),
                )
            )
        return hits[:limit]

    @staticmethod
    def _similarity_cutoff(similarities: np.ndarray, limit: int, bonus: float) -> float:
        """Lowest similarity a row needs to reach the top ``limit`` after bonuses."""
        if limit <= 0:
            return np.inf
        if len(similarities) <= limit:
            return -np.inf
        kth = np.partition(similarities, len(similarities) - limit)[len(similarities) - limit]
        return float(kth) - bonus

    def persons(self) -> list[dict]:
        return list(self.catalog.get("persons", []))
