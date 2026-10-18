#!/usr/bin/env python3
"""Verify the real ML backend loads and runs on CPU.

Exercises SigLIP embeddings, InsightFace detection/recognition, RapidOCR and
faster-whisper against synthetic input. Intended for the cloud dev environment,
where the `ml` extra is installed; it downloads model weights on first run.

Usage:
    python scripts/ml_check.py [--skip-whisper]
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import time
from pathlib import Path

import numpy as np


def _synthetic_face(size: int = 320) -> np.ndarray:
    """A crude face-like image: skin-tone oval with darker eyes and a mouth."""
    image = np.full((size, size, 3), 210, dtype=np.uint8)
    yy, xx = np.mgrid[0:size, 0:size]
    cy, cx = size // 2, size // 2
    oval = ((yy - cy) / (size * 0.38)) ** 2 + ((xx - cx) / (size * 0.30)) ** 2 <= 1
    image[oval] = (200, 170, 150)
    for eye_x in (cx - size // 8, cx + size // 8):
        eye = (yy - cy + size // 10) ** 2 + (xx - eye_x) ** 2 <= (size // 22) ** 2
        image[eye] = (40, 40, 40)
    mouth = (
        (yy - cy - size // 7) ** 2 / (size // 30) ** 2
        + (xx - cx) ** 2 / (size // 6) ** 2
        <= 1
    )
    image[mouth] = (120, 60, 60)
    return image


def _synthetic_text_image(size: int = 320) -> np.ndarray:
    """White canvas with black text, drawn with PIL's default font."""
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (size, size), (255, 255, 255))
    draw = ImageDraw.Draw(image)
    draw.text((20, size // 2 - 10), "HELLO 2026", fill=(0, 0, 0))
    draw.rectangle([20, 40, size - 20, 90], outline=(0, 0, 0), width=3)
    return np.asarray(image, dtype=np.uint8)


def _synthetic_video(path: Path, seconds: float = 1.5, fps: int = 10) -> bool:
    try:
        import cv2
    except ImportError:
        return False
    writer = cv2.VideoWriter(
        str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, (160, 120)
    )
    if not writer.isOpened():
        return False
    for _ in range(int(seconds * fps)):
        writer.write(np.full((120, 160, 3), 90, dtype=np.uint8))
    writer.release()
    return True


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--skip-whisper", action="store_true")
    args = parser.parse_args()

    from mmindex.backends import MLBackend
    from mmindex.config import Settings

    settings = Settings()
    settings.device = "cpu"
    settings.model_dtype = "float32"
    settings.gpu_batch_size = 2
    print(f"device={settings.device} dtype={settings.model_dtype}")

    backend = MLBackend(settings)
    failures: list[str] = []

    try:
        print("== SigLIP ==")
        started = time.time()
        images = [_synthetic_face(), _synthetic_text_image()]
        vectors = backend.embed_images(images)
        norms = np.linalg.norm(vectors, axis=1)
        print(
            f"shape={vectors.shape} dtype={vectors.dtype} "
            f"norm={norms.round(4).tolist()} elapsed={time.time() - started:.1f}s"
        )
        if vectors.shape != (2, settings.clip_embedding_dim):
            failures.append(f"SigLIP returned {vectors.shape}")
        if not np.allclose(norms, 1.0, atol=1e-3):
            failures.append("SigLIP embeddings are not L2-normalised")

        text_vector = backend.embed_text("a person")
        if text_vector.shape != (settings.clip_embedding_dim,):
            failures.append(f"text tower returned {text_vector.shape}")
        print(f"text vector norm={float(np.linalg.norm(text_vector)):.4f}")

        print("== InsightFace ==")
        started = time.time()
        faces = backend.detect_faces(images)
        counts = [len(group) for group in faces]
        print(f"faces per image={counts} elapsed={time.time() - started:.1f}s")
        for group in faces:
            for face in group:
                if face.embedding.shape != (settings.face_embedding_dim,):
                    failures.append(f"face embedding shape {face.embedding.shape}")

        print("== RapidOCR ==")
        started = time.time()
        texts = backend.ocr([_synthetic_text_image()])
        print(f"ocr={texts!r} elapsed={time.time() - started:.1f}s")
        if not texts or not texts[0]:
            failures.append("RapidOCR returned no text for a rendered label")

        if not args.skip_whisper:
            print("== faster-whisper ==")
            started = time.time()
            with tempfile.TemporaryDirectory() as tmp:
                video = Path(tmp) / "silence.mp4"
                if _synthetic_video(video):
                    try:
                        transcript = backend.transcribe(str(video))
                        print(f"transcript={transcript!r} elapsed={time.time() - started:.1f}s")
                    except Exception as exc:
                        failures.append(f"whisper: {type(exc).__name__}: {exc}")
                else:
                    print("skipped: no mp4 encoder available")
    finally:
        backend.close()

    if failures:
        print("\nFAILED:")
        for failure in failures:
            print(f"  - {failure}")
        return 1
    print("\nml backend check passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
