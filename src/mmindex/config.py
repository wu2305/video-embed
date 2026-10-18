"""Configuration and on-disk layout for the multimodal media indexer.

The values here encode the CPU port described in ``ARCHITECTURE.md`` section 3:
float32 weights, CPU execution providers, single OCR worker and reduced batch
sizes.  ``Settings`` is a plain dataclass so it can be serialised into build
metadata and reproduced across worker machines.
"""

from __future__ import annotations

import os
from dataclasses import asdict, dataclass, fields
from pathlib import Path

IMAGE_EXTENSIONS = frozenset(
    {".jpg", ".jpeg", ".png", ".webp", ".bmp", ".tif", ".tiff", ".gif", ".heic", ".heif"}
)
VIDEO_EXTENSIONS = frozenset(
    {".mp4", ".mov", ".avi", ".mkv", ".webm", ".m4v", ".wmv", ".flv", ".mpg", ".mpeg", ".ts"}
)

STAGES = ("prepare", "extract", "infer")
FINAL_STAGES = ("cluster", "export")
ALL_STAGES = STAGES + FINAL_STAGES


@dataclass
class Settings:
    """Runtime knobs for every pipeline stage."""

    device: str = "cpu"
    model_dtype: str = "float32"

    siglip_model_id: str = "google/siglip-base-patch16-224"
    clip_embedding_dim: int = 768

    face_model_name: str = "buffalo_l"
    face_embedding_dim: int = 512
    face_det_size: int = 640

    whisper_model: str = "base"
    whisper_compute_type: str = "int8"

    ocr_recognition_batch: int = 1

    scene_threshold: float = 27.0
    scene_fallback_seconds: float = 30.0

    gpu_batch_size: int = 8

    hdbscan_min_cluster_size: int = 3
    hdbscan_min_samples: int = 3
    hdbscan_cluster_selection_epsilon: float = 0.55
    pca_threshold: int = 20_000
    pca_components: int = 64
    kmeans_prototypes: int = 3
    kmeans_n_init: int = 10

    text_bonus: float = 0.15
    near_dup_hamming: int = 6
    near_dup_sharpness_ratio: float = 0.9

    backend: str = "auto"

    @classmethod
    def from_env(cls) -> "Settings":
        """Build settings from ``MMINDEX_*`` environment variables."""
        values: dict = {}
        for spec in fields(cls):
            raw = os.environ.get(f"MMINDEX_{spec.name.upper()}")
            if raw is None:
                continue
            if isinstance(spec.default, bool):
                values[spec.name] = raw.strip().lower() in {"1", "true", "yes"}
            elif isinstance(spec.default, int):
                values[spec.name] = int(raw)
            elif isinstance(spec.default, float):
                values[spec.name] = float(raw)
            else:
                values[spec.name] = raw
        return cls(**values)

    def to_dict(self) -> dict:
        return asdict(self)

    @classmethod
    def from_dict(cls, data: dict) -> "Settings":
        known = {f.name for f in fields(cls)}
        return cls(**{k: v for k, v in data.items() if k in known})


@dataclass
class Layout:
    """Directory layout shared by workers and the coordinator (section 4.7)."""

    root: Path
    namespace: str = "default"

    def __post_init__(self) -> None:
        self.root = Path(self.root)

    @property
    def checkpoint_dir(self) -> Path:
        return self.root / "checkpoints"

    @property
    def checkpoint_db(self) -> Path:
        return self.checkpoint_dir / f"checkpoint-v2-{self.namespace}.sqlite"

    @property
    def shard_dir(self) -> Path:
        return self.checkpoint_dir / "shards"

    @property
    def queue_db(self) -> Path:
        return self.root / "work_queue.sqlite"

    @property
    def manifest(self) -> Path:
        return self.root / "manifest.jsonl"

    @property
    def deduplicated(self) -> Path:
        return self.root / "deduplicated.json"

    @property
    def frames_dir(self) -> Path:
        return self.root / "frames"

    @property
    def prepare_dir(self) -> Path:
        return self.root / "prepare"

    @property
    def snapshots_dir(self) -> Path:
        return self.root / "index_snapshots"

    @property
    def index_manifest(self) -> Path:
        return self.root / "index_manifest.json"

    @property
    def persons(self) -> Path:
        return self.root / "person_catalog.json"

    @property
    def person_labels(self) -> Path:
        return self.root / "person_labels.json"

    def ensure(self) -> "Layout":
        for path in (
            self.root,
            self.checkpoint_dir,
            self.shard_dir,
            self.frames_dir,
            self.prepare_dir,
            self.snapshots_dir,
        ):
            path.mkdir(parents=True, exist_ok=True)
        return self


def media_kind(path: str | Path) -> str | None:
    """Return ``"image"``, ``"video"`` or ``None`` for an unsupported path."""
    suffix = Path(path).suffix.lower()
    if suffix in IMAGE_EXTENSIONS:
        return "image"
    if suffix in VIDEO_EXTENSIONS:
        return "video"
    return None
