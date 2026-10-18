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
            similarities = self.matrix[rows_index] @ vector
        else:
            similarities = np.zeros(len(rows), dtype=np.float32)

        needle = (text or "").strip().lower()
        hits: list[SearchHit] = []
        for row, similarity in zip(rows, similarities):
            bonus = 0.0
            if needle:
                haystack = f"{row['ocr_text'] or ''} {row['asr_text'] or ''}".lower()
                if needle in haystack:
                    bonus = self.settings.text_bonus
            score = float(similarity) + bonus
            if min_score is not None and score < min_score:
                continue
            hits.append(
                SearchHit(
                    unit_id=int(row["unit_id"]),
                    path=row["path"],
                    score=score,
                    similarity=float(similarity),
                    text_bonus=bonus,
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

        hits.sort(key=lambda hit: (-hit.score, hit.path, hit.unit_index))
        return hits[:limit]

    def persons(self) -> list[dict]:
        return list(self.catalog.get("persons", []))
