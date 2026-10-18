"""Frame decoding and per-unit quality signals (dhash, sharpness)."""

from __future__ import annotations

from pathlib import Path
from typing import Iterator

import numpy as np

_DHASH_SIZE = 8


def load_image(path: str | Path) -> np.ndarray:
    """Load an image as an RGB ``uint8`` array."""
    from PIL import Image, ImageOps

    with Image.open(path) as image:
        image = ImageOps.exif_transpose(image)
        return np.asarray(image.convert("RGB"), dtype=np.uint8)


def dhash(image: np.ndarray, size: int = _DHASH_SIZE) -> str:
    """Perceptual difference hash as a hex string."""
    from PIL import Image

    gray = Image.fromarray(image).convert("L").resize((size + 1, size), Image.Resampling.LANCZOS)
    pixels = np.asarray(gray, dtype=np.int16)
    diff = pixels[:, 1:] > pixels[:, :-1]
    bits = np.packbits(diff.reshape(-1))
    return bits.tobytes().hex()


def hamming(a: str, b: str) -> int:
    """Bit distance between two hex dhashes."""
    if not a or not b:
        return 64
    left = int(a, 16)
    right = int(b, 16)
    return bin(left ^ right).count("1")


def sharpness(image: np.ndarray) -> float:
    """Laplacian variance: higher means sharper."""
    gray = image.astype(np.float32).mean(axis=2) if image.ndim == 3 else image.astype(np.float32)
    if gray.shape[0] < 3 or gray.shape[1] < 3:
        return 0.0
    kernel = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float32)
    h, w = gray.shape
    windows = np.lib.stride_tricks.sliding_window_view(gray, (3, 3))
    laplacian = np.einsum("ijkl,kl->ij", windows, kernel)
    del h, w
    return float(laplacian.var())


def probe_video(path: str | Path) -> dict:
    """Return duration, fps and frame count for a video file."""
    import cv2

    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise OSError(f"cannot open video: {path}")
    try:
        fps = float(capture.get(cv2.CAP_PROP_FPS) or 0.0)
        frames = float(capture.get(cv2.CAP_PROP_FRAME_COUNT) or 0.0)
        duration = frames / fps if fps > 0 else 0.0
        return {"fps": fps, "frames": int(frames), "duration": duration}
    finally:
        capture.release()


def iter_scene_frames(
    path: str | Path, timestamps: list[float]
) -> Iterator[tuple[int, np.ndarray]]:
    """Yield ``(index, rgb_frame)`` for ascending timestamps in a single pass."""
    import cv2

    capture = cv2.VideoCapture(str(path))
    if not capture.isOpened():
        raise OSError(f"cannot open video: {path}")
    try:
        for index, stamp in enumerate(timestamps):
            capture.set(cv2.CAP_PROP_POS_MSEC, max(0.0, stamp) * 1000.0)
            ok, frame = capture.read()
            if not ok:
                continue
            yield index, frame[:, :, ::-1].copy()
    finally:
        capture.release()
