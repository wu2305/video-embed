"""Run the benchmark: build the corpus, index it, score the result.

Produces ``benchmark_report.json`` containing the corpus recipe, index timing,
dedup/master-election accuracy, Recall@K and cluster purity — the numbers that
show whether the CPU port reproduces the reference pipeline's behaviour.
"""

from __future__ import annotations

import json
import os
import platform
import resource
import sys
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path

from ..backends import build_backend
from ..config import Layout, Settings
from ..pipeline import Pipeline
from ..scan import read_manifest
from ..search import Index
from .corpus import CorpusSpec, build_corpus
from .evaluate import score_clusters, score_dedup, score_retrieval


@dataclass
class BenchmarkResult:
    corpus: dict = field(default_factory=dict)
    environment: dict = field(default_factory=dict)
    timing: dict = field(default_factory=dict)
    index: dict = field(default_factory=dict)
    dedup: dict = field(default_factory=dict)
    retrieval: dict = field(default_factory=dict)
    clusters: dict = field(default_factory=dict)
    errors: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return asdict(self)


def _peak_rss_mib() -> float:
    usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
    # macOS reports bytes, Linux reports KiB.
    return usage / (1024 * 1024) if sys.platform == "darwin" else usage / 1024


def run_benchmark(
    corpus_root: str | Path,
    work_dir: str | Path,
    *,
    spec: CorpusSpec | None = None,
    settings: Settings | None = None,
    fetch: bool = True,
    max_queries: int = 200,
    log=print,
) -> BenchmarkResult:
    """Fetch (optionally), index and score the benchmark corpus."""
    corpus_root = Path(corpus_root)
    work_dir = Path(work_dir)
    settings = settings or Settings()
    result = BenchmarkResult()

    if fetch:
        log(f"building corpus at {corpus_root}")
        started = time.time()
        report = build_corpus(corpus_root, spec, log=log)
        result.corpus = report.to_dict()
        result.corpus["fetch_seconds"] = round(time.time() - started, 2)
    else:
        result.corpus = {"root": str(corpus_root), "fetched": False}

    ground_truth_path = corpus_root / "ground_truth_dedup_benchmark.json"
    ground_truth = (
        json.loads(ground_truth_path.read_text(encoding="utf-8"))
        if ground_truth_path.exists()
        else {}
    )
    captions_path = corpus_root / "flickr30k_groundtruth_captions.json"
    captions = (
        json.loads(captions_path.read_text(encoding="utf-8"))
        if captions_path.exists()
        else {}
    )

    result.environment = {
        "platform": platform.platform(),
        "python": platform.python_version(),
        "cpu_count": os.cpu_count(),
        "device": settings.device,
        "model_dtype": settings.model_dtype,
        "backend": settings.backend,
        "peak_rss_mib_start": round(_peak_rss_mib(), 1),
    }

    layout = Layout(work_dir).ensure()
    pipeline = Pipeline(layout, settings, log=log)
    timings: dict = {}
    try:
        started = time.time()
        timings["scan"] = pipeline.run_scan(corpus_root)
        for stage in ("prepare", "extract", "infer"):
            stage_started = time.time()
            summary = pipeline.run_stage(stage)
            timings[stage] = {
                "done": summary["done"],
                "skipped": summary["skipped"],
                "failed": len(summary["failed"]),
                "seconds": round(time.time() - stage_started, 2),
            }
        timings["cluster"] = {"seconds": None}
        cluster_started = time.time()
        catalog = pipeline.run_cluster()
        timings["cluster"] = {
            "persons": catalog.get("person_count", 0),
            "noise_faces": catalog.get("noise_faces", 0),
            "diagnostics": catalog.get("diagnostics", {}),
            "seconds": round(time.time() - cluster_started, 2),
        }
        export_started = time.time()
        manifest = pipeline.run_export()
        timings["export"] = {
            "units": manifest["unit_count"],
            "seconds": round(time.time() - export_started, 2),
        }
    except Exception as exc:
        result.errors.append(f"{type(exc).__name__}: {exc}")
        log(f"pipeline failed: {type(exc).__name__}: {exc}")
        manifest = None
    finally:
        pipeline.close()

    result.timing = timings
    result.environment["peak_rss_mib_end"] = round(_peak_rss_mib(), 1)
    if manifest is None:
        return result

    result.index = {
        "snapshot": manifest["snapshot"],
        "units": manifest["unit_count"],
        "persons": manifest["person_count"],
        "checks": manifest["checks"],
    }

    entries = [entry.to_dict() for entry in read_manifest(layout)]
    dedup_report = {}
    if layout.deduplicated.exists():
        dedup_report = json.loads(layout.deduplicated.read_text(encoding="utf-8"))
    # Pass the corpus root, not the work dir: the dedup report's paths are
    # absolute paths inside the corpus, and scoring rebases them onto it. The
    # snapshot for master election lives in the work dir, hence index_root.
    result.dedup = score_dedup(
        entries, ground_truth, corpus_root, dedup_report, index_root=work_dir
    ).to_dict()

    index = Index.open(layout, settings)
    backend = build_backend(settings)
    try:
        if captions:
            log(f"scoring retrieval over {len(captions)} captioned images")
            result.retrieval = score_retrieval(
                index, captions, backend, max_queries=max_queries, log=log
            ).to_dict()
        result.clusters = score_clusters(index, corpus_root).to_dict()
    finally:
        backend.close()

    return result


def write_report(result: BenchmarkResult, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(result.to_dict(), indent=2), encoding="utf-8")
    return path
