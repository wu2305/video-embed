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

# The production corpus lives in a checkpoint namespace of immutable Drive shards
# and a legacy SQLite file that is read-only. Nothing in this package may write
# to either, so both names are refused outright rather than guarded by convention.
PRODUCTION_NAMESPACE = "7d928ad0a65d18eab89b"
LEGACY_CHECKPOINT_NAME = "checkpoint-38193eda9da83f4d2192.sqlite"


class ProtectedPathError(ValueError):
    """Raised when a layout or checkpoint would touch production state."""


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
    # Retry size for tightly-cropped portraits, where the 640 px anchor grid
    # misses faces that the 320 px grid finds.
    face_det_fallback_size: int = 320

    whisper_model: str = "base"
    whisper_compute_type: str = "int8"

    ocr_recognition_batch: int = 1

    scene_threshold: float = 27.0
    scene_fallback_seconds: float = 30.0

    # Extracted frames are stored as bounded JPEGs, not full-resolution raw
    # arrays: a 12 MP photo is 36 MB as ``.npy`` but ~150 KB as a JPEG at this
    # size, which is what keeps a 77 k-file corpus on one disk. 1024 px leaves
    # the 640 px face grid and OCR enough detail.
    frame_max_edge: int = 1024
    frame_jpeg_quality: int = 90
    # Frames are deleted once their infer record exists; set this to keep them
    # for inspection, at the cost of the full frame footprint.
    keep_frames: bool = False
    # Long edge that sharpness is measured at, so the value is comparable across
    # images of different sizes (master election depends on that). 0 keeps the
    # raw full-resolution Laplacian variance, which is not comparable.
    sharpness_edge: int = 256

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
    # Per-machine scratch directory for a worker's own checkpoint database. Set it
    # when ``root`` is on shared storage that several machines mount: SQLite over
    # NFS or a FUSE bucket is unreliable, so each machine keeps its database local
    # and exchanges progress only through the immutable shards under ``root``.
    local_dir: Path | None = None
    # ``DELETE`` instead of ``WAL`` when the queue file sits on a network mount:
    # WAL needs shared memory and so only works for processes on one host.
    queue_journal_mode: str = "WAL"

    def __post_init__(self) -> None:
        self.root = Path(self.root)
        if self.local_dir is not None:
            self.local_dir = Path(self.local_dir)
        self.queue_journal_mode = self.queue_journal_mode.upper()
        if self.namespace == PRODUCTION_NAMESPACE:
            raise ProtectedPathError(
                f"namespace {PRODUCTION_NAMESPACE!r} holds the production checkpoint "
                "shards and is immutable; use another --namespace"
            )

    @property
    def checkpoint_dir(self) -> Path:
        return self.root / "checkpoints"

    @property
    def checkpoint_db(self) -> Path:
        return self.checkpoint_dir / f"checkpoint-v2-{self.namespace}.sqlite"

    @property
    def worker_checkpoint_db(self) -> Path:
        """The checkpoint database a worker on this machine writes to."""
        if self.local_dir is None:
            return self.checkpoint_db
        return self.local_dir / f"checkpoint-v2-{self.namespace}.sqlite"

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
            *([self.local_dir] if self.local_dir is not None else []),
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
