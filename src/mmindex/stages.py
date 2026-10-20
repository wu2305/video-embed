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
from .media import dhash, iter_scene_frames, load_frame, load_image, save_frame, sharpness
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
        segments: list[dict] = []
        if backend is not None:
            try:
                segments = backend.transcribe_segments(entry.path)
            except Exception as exc:  # ASR failure must not lose the scenes
                record["asr_error"] = str(exc)
        record["schema"] = 2
        record["scenes"] = [
            {"index": i, "start": float(s), "end": float(e), "midpoint": float((s + e) / 2)}
            for i, (s, e) in enumerate(spans)
        ]
        record["asr_segments"] = segments
        record["asr_text"] = " ".join(s["text"] for s in segments).strip()
    else:
        record["schema"] = 2
        record["scenes"] = [
            {"index": 0, "start": 0.0, "end": 0.0, "midpoint": 0.0}
        ]
        record["asr_segments"] = []
        record["asr_text"] = ""

    checkpoint.put(entry.path, entry.digest, record)
    return record


# --------------------------------------------------------------- stage 2


def frame_path(layout: Layout, entry: ManifestEntry, index: int) -> Path:
    digest = entry.digest[:16]
    suffix = ".jpg"
    return layout.frames_dir / f"{digest}-{index:05d}{suffix}"


def extract_entry(
    entry: ManifestEntry,
    layout: Layout,
    settings: Settings,
    checkpoint: IncrementalCheckpoint,
    prepared: dict | None = None,
) -> dict:
    """Stage 2: one representative frame per scene, stored as a bounded JPEG."""
    existing = checkpoint.get(entry.path, entry.digest)
    if existing is not None:
        return existing

    prepared = prepared or checkpoint.get(entry.path, entry.digest, stage="prepare")
    if prepared is None:
        raise RuntimeError(f"stage 1 record missing for {entry.path}")

    scenes = prepared.get("scenes", [])
    frames: list[dict] = []

    def store(index: int, image, timestamp: float) -> None:
        target = frame_path(layout, entry, index)
        size = save_frame(
            target, image, settings.frame_max_edge, settings.frame_jpeg_quality
        )
        frames.append(
            {
                "index": index,
                "file": str(target),
                "timestamp": timestamp,
                **size,
            }
        )

    if entry.kind == "video":
        timestamps = [float(scene["midpoint"]) for scene in scenes]
        for index, image in iter_scene_frames(entry.path, timestamps):
            store(index, image, timestamps[index])
    else:
        store(0, load_image(entry.path), 0.0)

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
    """Text spoken during the scene at ``index``.

    With ``asr_segments`` (schema 2), each Whisper segment contributes to the
    scene it overlaps, which is what the transcript timings are for. Records
    written before schema 2 carry only one transcript, so the words are split
    pro rata across the runtime as a best effort.
    """
    scenes = prepared.get("scenes") or []
    scene = scenes[index] if 0 <= index < len(scenes) else (scenes[-1] if scenes else None)
    segments = prepared.get("asr_segments")
    if segments is not None:
        if scene is None:
            return ""
        start, end = float(scene["start"]), float(scene["end"])
        if end <= start:
            return " ".join(s["text"] for s in segments).strip()
        # Every segment overlapping the scene contributes; a segment inside a gap
        # between scenes is dropped rather than duplicated across neighbours.
        chosen = []
        for segment in segments:
            overlap = min(end, float(segment["end"])) - max(start, float(segment["start"]))
            if overlap > 0:
                chosen.append(segment["text"])
        return " ".join(chosen).strip()

    transcript = (prepared.get("asr_text") or "").strip()
    if not transcript:
        return ""
    if len(scenes) <= 1:
        return transcript
    duration = max(float(s["end"]) for s in scenes)
    if duration <= 0:
        return transcript
    words = transcript.split()
    total = len(words)
    start = int(total * (float(scene["start"]) / duration))
    end = int(total * (float(scene["end"]) / duration))
    start = max(0, min(start, total))
    end = max(start, min(end, total))
    return " ".join(words[start:end])


def infer_entry(
    entry: ManifestEntry,
    layout: Layout,
    settings: Settings,
    checkpoint: IncrementalCheckpoint,
    backend: Backend,
    extracted: dict | None = None,
    prepared: dict | None = None,
    release_frames: bool = True,
) -> dict:
    """Stage 3: embeddings, faces, OCR text and quality signals per unit.

    ``release_frames=False`` leaves the scratch frames in place for a caller that
    only considers the record durable later (a worker whose database is local
    until its shard is synced); that caller then calls :func:`discard_frames`.
    """
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

    images = [load_frame(frame["file"]) for frame in frames]
    embeddings = backend.embed_images(images)
    faces = backend.detect_faces(images)
    ocr_texts = backend.ocr(images)

    scenes = prepared.get("scenes", [])
    units: list[dict] = []
    for position, frame in enumerate(frames):
        # Frames whose scene failed to decode are absent from ``frames``, so the
        # list position is not the scene index; every per-frame array is keyed by
        # the frame's own index instead.
        index = int(frame.get("index", position))
        scene = scenes[index] if 0 <= index < len(scenes) else {"start": 0.0, "end": 0.0}
        image = images[position]
        unit_faces = [
            {"embedding": face.embedding, "bbox": face.bbox, "det_score": face.det_score}
            for face in faces[position]
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
                "clip_embedding": embeddings[position],
                "faces": unit_faces,
                "ocr_text": ocr_texts[position] if position < len(ocr_texts) else "",
                "asr_text": _scene_text(prepared, index),
                "dhash": dhash(image),
                "sharpness": sharpness(image, settings.sharpness_edge or None),
                # The resolution of the media, not of the bounded scratch JPEG.
                # Extract records from before ``source_*`` existed only know the
                # stored size, which is the best remaining answer.
                "width": int(frame.get("source_width", image.shape[1])),
                "height": int(frame.get("source_height", image.shape[0])),
            }
        )

    record = {
        "path": entry.path,
        "digest": entry.digest,
        "kind": entry.kind,
        "backend": backend.name,
        # Which scale the sharpness values were measured at. Master election
        # compares them across files, so a record set that mixes scales cannot
        # be compared; export refuses such a mix.
        "sharpness_edge": int(settings.sharpness_edge),
        "units": units,
        "inferred_at": time.time(),
    }
    checkpoint.put(entry.path, entry.digest, record)
    if release_frames:
        # Frames are scratch data. They are removed only after the infer record
        # is stored, so a crash here costs re-extraction, never the record.
        discard_frames(extracted, settings)
    return record


def discard_frames(extracted: dict, settings: Settings) -> None:
    """Delete the scratch frames an extract record points at, unless kept."""
    if settings.keep_frames:
        return
    for frame in extracted.get("frames", []):
        try:
            Path(frame["file"]).unlink()
        except OSError:
            pass


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
