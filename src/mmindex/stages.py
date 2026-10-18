"""Stages 1-3: prepare, extract and infer.

Every function here is idempotent: it takes a manifest entry plus a checkpoint
and returns the stored record when the work is already done.  That property is
what allows spot machines to be preempted at any point (section 4.1).
"""

from __future__ import annotations

import time
from pathlib import Path
from typing import Sequence

import numpy as np

from .backends import Backend
from .checkpoint import IncrementalCheckpoint
from .config import Layout, Settings
from .media import dhash, iter_scene_frames, load_image, sharpness
from .scan import ManifestEntry


# --------------------------------------------------------------- stage 1


def _seconds(frame_time) -> float:
    """SceneDetect frame time as float seconds, across API versions."""
    value = getattr(frame_time, "seconds", None)
    if value is not None:
        return float(value)
    return float(frame_time.get_seconds())


def scene_boundaries(path: str | Path, settings: Settings) -> list[tuple[float, float]]:
    """Return ``(start, end)`` scene spans in seconds.

    Uses PySceneDetect ``ContentDetector``; falls back to fixed-length windows
    when the detector is unavailable or finds nothing, so a video always yields
    at least one unit.
    """
    try:
        from scenedetect import ContentDetector, detect

        scenes = detect(str(path), ContentDetector(threshold=settings.scene_threshold))
        spans = [(_seconds(start), _seconds(end)) for start, end in scenes]
        if spans:
            return spans
    except Exception:
        spans = []
    try:
        from .media import probe_video

        duration = probe_video(path)["duration"]
    except Exception:
        duration = 0.0
    if duration <= 0:
        return [(0.0, 0.0)]
    step = max(1.0, settings.scene_fallback_seconds)
    return [(t, min(duration, t + step)) for t in np.arange(0.0, duration, step).tolist()]


def prepare_entry(
    entry: ManifestEntry,
    layout: Layout,
    settings: Settings,
    checkpoint: IncrementalCheckpoint,
    backend: Backend | None = None,
) -> dict:
    """Stage 1: scene spans and ASR transcript for one file."""
    existing = checkpoint.get(entry.path, entry.digest)
    if existing is not None:
        return existing

    record: dict = {
        "path": entry.path,
        "digest": entry.digest,
        "kind": entry.kind,
        "canonical_time": entry.canonical_time,
        "prepared_at": time.time(),
    }
    if entry.kind == "video":
        spans = scene_boundaries(entry.path, settings)
        transcript = ""
        if backend is not None:
            try:
                transcript = backend.transcribe(entry.path)
            except Exception as exc:  # ASR failure must not lose the scenes
                record["asr_error"] = str(exc)
        record["scenes"] = [
            {"index": i, "start": float(s), "end": float(e), "midpoint": float((s + e) / 2)}
            for i, (s, e) in enumerate(spans)
        ]
        record["asr_text"] = transcript
    else:
        record["scenes"] = [
            {"index": 0, "start": 0.0, "end": 0.0, "midpoint": 0.0}
        ]
        record["asr_text"] = ""

    checkpoint.put(entry.path, entry.digest, record)
    return record


# --------------------------------------------------------------- stage 2


def frame_path(layout: Layout, entry: ManifestEntry, index: int) -> Path:
    digest = entry.digest[:16]
    suffix = ".npy"
    return layout.frames_dir / f"{digest}-{index:05d}{suffix}"


def extract_entry(
    entry: ManifestEntry,
    layout: Layout,
    settings: Settings,
    checkpoint: IncrementalCheckpoint,
    prepared: dict | None = None,
) -> dict:
    """Stage 2: one representative frame per scene, persisted as ``.npy``."""
    existing = checkpoint.get(entry.path, entry.digest)
    if existing is not None:
        return existing

    prepared = prepared or checkpoint.get(entry.path, entry.digest, stage="prepare")
    if prepared is None:
        raise RuntimeError(f"stage 1 record missing for {entry.path}")

    scenes = prepared.get("scenes", [])
    frames: list[dict] = []

    if entry.kind == "video":
        timestamps = [float(scene["midpoint"]) for scene in scenes]
        for index, image in iter_scene_frames(entry.path, timestamps):
            target = frame_path(layout, entry, index)
            np.save(target, image)
            frames.append(
                {
                    "index": index,
                    "file": str(target),
                    "timestamp": timestamps[index],
                    "width": int(image.shape[1]),
                    "height": int(image.shape[0]),
                }
            )
    else:
        image = load_image(entry.path)
        target = frame_path(layout, entry, 0)
        np.save(target, image)
        frames.append(
            {
                "index": 0,
                "file": str(target),
                "timestamp": 0.0,
                "width": int(image.shape[1]),
                "height": int(image.shape[0]),
            }
        )

    record = {
        "path": entry.path,
        "digest": entry.digest,
        "kind": entry.kind,
        "canonical_time": entry.canonical_time,
        "frames": frames,
        "extracted_at": time.time(),
    }
    checkpoint.put(entry.path, entry.digest, record)
    return record


# --------------------------------------------------------------- stage 3


def _scene_text(prepared: dict, index: int) -> str:
    """Slice the ASR transcript down to the scene's time window."""
    transcript = (prepared.get("asr_text") or "").strip()
    if not transcript:
        return ""
    scenes = prepared.get("scenes") or []
    if len(scenes) <= 1:
        return transcript
    scene = scenes[index] if index < len(scenes) else scenes[-1]
    words = transcript.split()
    total = max(1, len(words))
    start = int(total * (scene["start"] / max(scene["end"], 1e-6)))
    end = int(total * (scene["end"] / max(scene["end"], 1e-6)))
    if end <= start:
        end = min(total, start + 1)
    return " ".join(words[start:end])


def infer_entry(
    entry: ManifestEntry,
    layout: Layout,
    settings: Settings,
    checkpoint: IncrementalCheckpoint,
    backend: Backend,
    extracted: dict | None = None,
    prepared: dict | None = None,
) -> dict:
    """Stage 3: embeddings, faces, OCR text and quality signals per unit."""
    existing = checkpoint.get(entry.path, entry.digest)
    if existing is not None:
        return existing

    extracted = extracted or checkpoint.get(entry.path, entry.digest, stage="extract")
    if extracted is None:
        raise RuntimeError(f"stage 2 record missing for {entry.path}")
    prepared = prepared or _load_prepare_record(entry, layout, checkpoint)

    frames = extracted.get("frames", [])
    if not frames:
        raise RuntimeError(f"no frames extracted for {entry.path}")

    images = [np.load(frame["file"]) for frame in frames]
    embeddings = backend.embed_images(images)
    faces = backend.detect_faces(images)
    ocr_texts = backend.ocr(images)

    units: list[dict] = []
    for index, (frame, image) in enumerate(zip(frames, images)):
        scene = (
            prepared.get("scenes", [])[index]
            if index < len(prepared.get("scenes", []))
            else {"start": 0.0, "end": 0.0}
        )
        unit_faces = [
            {"embedding": face.embedding, "bbox": face.bbox, "det_score": face.det_score}
            for face in faces[index]
        ]
        units.append(
            {
                "unit_index": index,
                "path": entry.path,
                "digest": entry.digest,
                "kind": entry.kind,
                "canonical_time": entry.canonical_time,
                "scene_start": float(scene.get("start", 0.0)),
                "scene_end": float(scene.get("end", 0.0)),
                "clip_embedding": embeddings[index],
                "faces": unit_faces,
                "ocr_text": ocr_texts[index] if index < len(ocr_texts) else "",
                "asr_text": _scene_text(prepared, index),
                "dhash": dhash(image),
                "sharpness": sharpness(image),
                "width": int(image.shape[1]),
                "height": int(image.shape[0]),
            }
        )

    record = {
        "path": entry.path,
        "digest": entry.digest,
        "kind": entry.kind,
        "backend": backend.name,
        "units": units,
        "inferred_at": time.time(),
    }
    checkpoint.put(entry.path, entry.digest, record)
    return record


def _load_prepare_record(
    entry: ManifestEntry, layout: Layout, checkpoint: IncrementalCheckpoint
) -> dict:
    record = checkpoint.get(entry.path, entry.digest, stage="prepare")
    if record is None:
        raise RuntimeError(f"stage 1 record missing for {entry.path}")
    return record


def run_stage(
    stage: str,
    entries: Sequence[ManifestEntry],
    layout: Layout,
    settings: Settings,
    checkpoint: IncrementalCheckpoint,
    backend: Backend | None = None,
    progress: object | None = None,
) -> dict:
    """Run one stage over a list of entries, skipping completed work."""
    done = 0
    skipped = 0
    failed: list[dict] = []
    for entry in entries:
        if checkpoint.has(entry.path, entry.digest, stage=stage):
            skipped += 1
            if progress is not None and hasattr(progress, "update"):
                progress.update(1)
            continue
        try:
            if stage == "prepare":
                prepare_entry(entry, layout, settings, checkpoint, backend)
            elif stage == "extract":
                extract_entry(entry, layout, settings, checkpoint)
            elif stage == "infer":
                if backend is None:
                    raise ValueError("infer stage requires a backend")
                infer_entry(entry, layout, settings, checkpoint, backend)
            else:
                raise ValueError(f"unknown stage: {stage}")
            done += 1
        except Exception as exc:
            failed.append({"path": entry.path, "error": str(exc)})
        if progress is not None and hasattr(progress, "update"):
            progress.update(1)
    return {"stage": stage, "done": done, "skipped": skipped, "failed": failed}
