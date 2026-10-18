"""Multimodal media indexer — CPU port of the Colab pipeline."""

from __future__ import annotations

__version__ = "0.1.0"

from .checkpoint import CheckpointConflict, GuardedCheckpoint, IncrementalCheckpoint
from .clustering import cluster_units
from .config import IMAGE_EXTENSIONS, STAGES, VIDEO_EXTENSIONS, Layout, Settings, media_kind
from .export import export_snapshot, read_manifest, verify_snapshot
from .pipeline import Pipeline
from .scan import ManifestEntry, read_manifest as read_media_manifest, scan
from .search import Index, SearchHit

__all__ = [
    "IMAGE_EXTENSIONS",
    "STAGES",
    "VIDEO_EXTENSIONS",
    "CheckpointConflict",
    "GuardedCheckpoint",
    "IncrementalCheckpoint",
    "Index",
    "Layout",
    "ManifestEntry",
    "Pipeline",
    "SearchHit",
    "Settings",
    "cluster_units",
    "export_snapshot",
    "media_kind",
    "read_manifest",
    "read_media_manifest",
    "scan",
    "verify_snapshot",
]
