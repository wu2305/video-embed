"""Benchmark corpus and evaluation for the multimodal media indexer."""

from __future__ import annotations

from .corpus import CorpusReport, CorpusSpec, build_corpus
from .evaluate import ClusterScore, DedupScore, RetrievalScore, score_clusters, score_dedup, score_retrieval
from .run import BenchmarkResult, run_benchmark, write_report

__all__ = [
    "BenchmarkResult",
    "ClusterScore",
    "CorpusReport",
    "CorpusSpec",
    "DedupScore",
    "RetrievalScore",
    "build_corpus",
    "run_benchmark",
    "score_clusters",
    "score_dedup",
    "score_retrieval",
    "write_report",
]
