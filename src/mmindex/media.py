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


def save_frame(path: str | Path, image: np.ndarray, max_edge: int, quality: int) -> dict:
    """Write ``image`` as a bounded-size JPEG and report what was stored.

    Frames are scratch data for the infer stage, not deliverables, so they are
    kept small enough that a large corpus fits on one disk. The stored size is
    returned so the extract record states what the infer stage will actually
    read, rather than the source resolution.
    """
    from PIL import Image

    picture = Image.fromarray(image)
    width, height = picture.size
    scale = min(1.0, max_edge / max(width, height)) if max(width, height) else 1.0
    if scale < 1.0:
        picture = picture.resize(
            (max(1, round(width * scale)), max(1, round(height * scale))),
            Image.Resampling.LANCZOS,
        )
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    picture.save(target, format="JPEG", quality=quality, optimize=True)
    return {"width": picture.size[0], "height": picture.size[1]}


def load_frame(path: str | Path) -> np.ndarray:
    """Read a frame written by :func:`save_frame` as an RGB ``uint8`` array."""
    return load_image(path)


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


def _to_gray(image: np.ndarray) -> np.ndarray:
    """8-bit grayscale, using OpenCV's weights when it is installed."""
    try:
        import cv2

        bgr = image[:, :, ::-1] if image.ndim == 3 else image
        return cv2.cvtColor(bgr, cv2.COLOR_BGR2GRAY)
    except ImportError:
        pass
    if image.ndim == 3:
        return (image.astype(np.float64) @ np.array([0.299, 0.587, 0.114])).astype(np.uint8)
    return image.astype(np.uint8)


def sharpness(image: np.ndarray, size: int | None = None) -> float:
    """Laplacian variance of the grayscale image; higher means sharper.

    The image is first scaled so its long edge is ``size`` pixels, because raw
    Laplacian variance is resolution-dependent and therefore not comparable
    between two photos of different sizes — which is exactly the comparison
    master election makes. Without the normalisation a half-resolution copy
    upscaled by the decoder scores *higher* than its original: measured on 80
    LFW faces, the original won 0 of 80 times against a quality-35 half-size
    copy. At a fixed 256 px it wins 80 of 80, and 80 of 80 against a Gaussian
    blur.

    ``size=None`` keeps the raw full-resolution variance, which is what the
    reference notebook computes and what older checkpoints stored.

    OpenCV is used when installed; the numpy fallback reproduces the same
    kernel and grayscale weights for the dependency-free path.
    """
    gray = _to_gray(image)
    if size and max(gray.shape[:2]) > 0:
        from PIL import Image

        picture = Image.fromarray(gray)
        width, height = picture.size
        scale = size / max(width, height)
        if abs(scale - 1.0) > 1e-9:
            picture = picture.resize(
                (max(1, round(width * scale)), max(1, round(height * scale))),
                Image.Resampling.LANCZOS,
            )
        gray = np.asarray(picture, dtype=np.uint8)

    try:
        import cv2

        return float(cv2.Laplacian(gray, cv2.CV_64F).var())
    except ImportError:
        pass

    values = gray.astype(np.float64)
    if values.shape[0] < 3 or values.shape[1] < 3:
        return 0.0
    kernel = np.array([[0, 1, 0], [1, -4, 1], [0, 1, 0]], dtype=np.float64)
    windows = np.lib.stride_tricks.sliding_window_view(values, (3, 3))
    return float(np.einsum("ijkl,kl->ij", windows, kernel).var())


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
