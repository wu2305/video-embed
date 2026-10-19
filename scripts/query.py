#!/usr/bin/env python3
"""Readable example: query the exported vector index.

Run this in the CNB dev environment, where `scripts/benchmark.py` left the
index at `/opt/benchmark_work`:

    python scripts/query.py "a man in a suit"
    python scripts/query.py "crowd of people" --limit 5
    python scripts/query.py "protest sign" --person person-0003 --min-faces 1
    python scripts/query.py "wedding" --min-score 0.2 --explain

What the index actually is
--------------------------
`Index` reads one published snapshot: `historical_media_index.sqlite` (one row
per visual unit) plus `siglip_embeddings_fp16.npy` (one 768-dim row per unit,
L2-normalised). A query is three steps:

    1. embed the text      -> 768-dim unit vector, SigLIP text tower
    2. filter the rows     -> SELECT * FROM units WHERE face_count >= ? AND ...
    3. rank                -> cosine = matrix[row_indices] @ query_vector

`Index.search()` does steps 2 and 3, then adds `text_bonus` (0.15) when the
query string appears verbatim in a unit's OCR/ASR text. That is the whole
"vector database": SQLite for metadata, a numpy matrix for the vectors.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("query", help="natural-language query")
    # The benchmark index lives outside /workspace so a restart does not wipe it.
    parser.add_argument("--work-dir", default="/opt/benchmark_work")
    parser.add_argument("--limit", type=int, default=10)
    parser.add_argument("--person", default=None, help='e.g. "person-0003"')
    parser.add_argument("--min-faces", type=int, default=0)
    parser.add_argument("--min-score", type=float, default=None)
    parser.add_argument(
        "--include-non-master",
        action="store_true",
        help="also rank near-duplicate copies instead of only the sharp master",
    )
    parser.add_argument(
        "--backend",
        default="auto",
        choices=["auto", "ml", "hash"],
        help="must match the backend the index was built with",
    )
    parser.add_argument("--explain", action="store_true", help="print the raw SQL and shapes")
    args = parser.parse_args()

    from mmindex.backends import build_backend
    from mmindex.config import Layout, Settings
    from mmindex.search import Index

    settings = Settings.from_env()
    settings.backend = args.backend

    try:
        index = Index.open(Layout(Path(args.work_dir)), settings)
    except FileNotFoundError as exc:
        # /opt is container-local: a restarted environment starts without an
        # index. Rebuild it with `python scripts/benchmark.py` or point
        # --work-dir at a directory that holds an exported snapshot.
        print(f"no index to query: {exc}", file=sys.stderr)
        print(f"hint: build one first, or pass --work-dir (got {args.work_dir})", file=sys.stderr)
        return 2

    if args.explain:
        clauses = ["face_count >= ?"]
        if not args.include_non_master:
            clauses.append("is_master = 1")
        if args.person:
            clauses.append('person_ids LIKE \'%"' + args.person + '"%\'')
        print("FILTER: SELECT * FROM units WHERE " + " AND ".join(clauses))
        print(f"MATRIX: {index.matrix.shape} {index.matrix.dtype} (L2-normalised)")
        print("RANK  : matrix[vec_row_idx] @ query_vector, plus text bonus")
        print()

    backend = build_backend(settings)
    try:
        query_vector = backend.embed_text(args.query)
    finally:
        backend.close()

    hits = index.search(
        query_vector,
        text=args.query,
        limit=args.limit,
        person_id=args.person,
        min_faces=args.min_faces,
        min_score=args.min_score,
        include_non_master=args.include_non_master,
    )

    if not hits:
        print(f"no hits for {args.query!r} in {index.snapshot_dir}")
        return 1

    print(f"{len(hits)} hits for {args.query!r} in {index.snapshot_dir.name}")
    for rank, hit in enumerate(hits, start=1):
        name = Path(hit.path).name
        print(f"\n{rank:2d}. score {hit.score:.4f}  (similarity {hit.similarity:.4f}, text +{hit.text_bonus:.2f})")
        print(f"    {name}  [{hit.kind}]")
        if hit.kind == "video":
            print(f"    scene {hit.unit_index} at {hit.canonical_time:.1f}s")
        detail = []
        if hit.face_count:
            detail.append(f"faces {hit.face_count}")
        if hit.person_ids:
            detail.append("persons " + ", ".join(hit.person_ids))
        if detail:
            print("    " + "  |  ".join(detail))
        snippet = (hit.ocr_text or hit.asr_text or "").strip()
        if snippet:
            print(f"    text: {snippet[:100]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
