#!/usr/bin/env python3
"""Run the reference benchmark inside the CNB dev environment.

The reference Colab notebook built its corpus from four public datasets (LFW,
Face-Age-10K, Flickr30k, MSR-VTT) and injected exact copies, lossy re-encodes
and motion-blurred bursts. This script reproduces that corpus at a size a CPU
dev environment can index, then scores the result against the same ground
truth, using the real SigLIP/InsightFace stack rather than the hash backend.

Usage:
    python scripts/benchmark.py                # default subset
    python scripts/benchmark.py --full         # every image each dataset yields
    python scripts/benchmark.py --lfw 800 --flickr 800 --cross-age 800
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path


def main() -> int:
    parser = argparse.ArgumentParser()
    # Keep the corpus and index outside /workspace: the workspace is backed up
    # and restored on every environment restart, and that backup is capped at
    # 100 MB, so multi-GB datasets do not belong there.
    parser.add_argument("--corpus-dir", default="/opt/benchmark_corpus")
    parser.add_argument("--work-dir", default="/opt/benchmark_work")
    parser.add_argument("--report", default="/opt/benchmark_report.json")
    parser.add_argument("--lfw", type=int, default=400)
    parser.add_argument("--cross-age", type=int, default=400)
    parser.add_argument("--flickr", type=int, default=400)
    parser.add_argument("--videos", type=int, default=15)
    parser.add_argument("--max-queries", type=int, default=200)
    parser.add_argument("--dup-ratio", type=float, default=0.08)
    parser.add_argument("--full", action="store_true", help="no per-dataset limit")
    args = parser.parse_args()

    from mmindex.benchmark.corpus import CorpusSpec
    from mmindex.benchmark.run import run_benchmark, write_report
    from mmindex.config import Settings

    limit = None if args.full else args.lfw
    spec = CorpusSpec(
        lfw_limit=limit,
        cross_age_limit=None if args.full else args.cross_age,
        flickr_limit=None if args.full else args.flickr,
        msrvtt_limit=None if args.full else args.videos,
        duplicate_ratio=args.dup_ratio,
    )

    settings = Settings()
    settings.device = "cpu"
    settings.model_dtype = "float32"
    settings.backend = "ml"

    print(f"corpus spec: {spec}", flush=True)
    result = run_benchmark(
        args.corpus_dir,
        args.work_dir,
        spec=spec,
        settings=settings,
        fetch=True,
        max_queries=args.max_queries,
    )
    path = write_report(result, args.report)
    # Also publish a copy into the workspace so it survives the run and can be
    # retrieved without shell access to the container.
    published = Path(__file__).resolve().parent.parent / "benchmark_report.json"
    try:
        published.write_text(path.read_text(encoding="utf-8"), encoding="utf-8")
        print(f"report copied to {published}")
    except OSError as exc:
        print(f"could not publish report copy: {exc}", file=sys.stderr)

    summary = {
        "report": str(path),
        "corpus": result.corpus,
        "environment": result.environment,
        "index": result.index,
        "timing": result.timing,
        "dedup": result.dedup,
        "retrieval": result.retrieval,
        "clusters": result.clusters,
        "errors": result.errors,
    }
    print("\n=== benchmark summary ===")
    print(json.dumps(summary, indent=2))

    if result.errors:
        print("\nbenchmark FAILED", file=sys.stderr)
        return 1
    checks = (result.index or {}).get("checks") or {}
    if not checks.get("ok", False):
        print("\nindex consistency check failed", file=sys.stderr)
        return 1
    print("\nbenchmark passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
