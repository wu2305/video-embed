"""Inference backends: embeddings, face detection/recognition and OCR.

Two implementations are provided:

``ml``
    The production stack — SigLIP for visual embeddings, InsightFace
    ``buffalo_l`` for faces and RapidOCR for on-frame text, all pinned to CPU
    execution providers per ``ARCHITECTURE.md`` section 3.1.

``hash``
    A deterministic, dependency-free backend that derives stable pseudo
    embeddings from image content.  It exists so the whole pipeline, the work
    queue and the search API can be exercised in CI and on machines without
    model weights.  Results from this backend are never comparable with the
    ``ml`` backend and are marked ``backend="hash"`` in every record.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass
from typing import Protocol, Sequence

import numpy as np

from .config import Settings


def l2_normalize(array: np.ndarray) -> np.ndarray:
    """Row-wise L2 normalisation; zero rows stay zero."""
    array = np.asarray(array, dtype=np.float32)
    if array.ndim == 1:
        norm = float(np.linalg.norm(array))
        return array / norm if norm > 0 else array
    norms = np.linalg.norm(array, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    return array / norms


@dataclass
class Face:
    embedding: np.ndarray
    bbox: list[float]
    det_score: float


class Backend(Protocol):
    name: str

    def embed_images(self, images: Sequence[np.ndarray]) -> np.ndarray: ...

    def embed_text(self, text: str) -> np.ndarray: ...

    def detect_faces(self, images: Sequence[np.ndarray]) -> list[list[Face]]: ...

    def ocr(self, images: Sequence[np.ndarray]) -> list[str]: ...

    def transcribe(self, path: str, language: str | None = None) -> str: ...

    def close(self) -> None: ...


class HashBackend:
    """Deterministic pseudo-inference for tests and dry runs."""

    name = "hash"

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or Settings()
        self._clip_dim = self.settings.clip_embedding_dim
        self._face_dim = self.settings.face_embedding_dim

    def _seeded_vector(self, seed: bytes, dim: int) -> np.ndarray:
        raw = hashlib.blake2b(seed, digest_size=64).digest()
        base = np.frombuffer(raw, dtype=np.uint8).astype(np.float32) / 255.0
        tiled = np.resize(base, dim)
        return l2_normalize(tiled - tiled.mean())

    def embed_images(self, images: Sequence[np.ndarray]) -> np.ndarray:
        rows = []
        for image in images:
            thumb = _thumbnail(image, 8)
            rows.append(self._seeded_vector(thumb.tobytes(), self._clip_dim))
        if not rows:
            return np.zeros((0, self._clip_dim), dtype=np.float32)
        return np.vstack(rows).astype(np.float32)

    def embed_text(self, text: str) -> np.ndarray:
        return self._seeded_vector(text.strip().lower().encode(), self._clip_dim)

    def detect_faces(self, images: Sequence[np.ndarray]) -> list[list[Face]]:
        detected: list[list[Face]] = []
        for image in images:
            thumb = _thumbnail(image, 64).astype(np.float32)
            h, w = thumb.shape[:2]
            centre = thumb[h // 3 : 2 * h // 3, w // 3 : 2 * w // 3]
            overall = float(thumb.std())
            local = float(centre.std()) if centre.size else 0.0
            # Treat a centre region that carries at least a third of the frame's
            # contrast as a face-like subject; flat frames yield no faces.
            faces: list[Face] = []
            if local > max(12.0, 0.35 * overall):
                faces.append(
                    Face(
                        embedding=self._seeded_vector(centre.tobytes(), self._face_dim),
                        bbox=[w / 3.0, h / 3.0, 2 * w / 3.0, 2 * h / 3.0],
                        det_score=float(min(0.99, local / max(overall, 1.0))),
                    )
                )
            detected.append(faces)
        return detected

    def ocr(self, images: Sequence[np.ndarray]) -> list[str]:
        return ["" for _ in images]

    def transcribe(self, path: str, language: str | None = None) -> str:
        return ""

    def close(self) -> None:
        return None


def _thumbnail(image: np.ndarray, size: int) -> np.ndarray:
    from PIL import Image

    gray = Image.fromarray(image).convert("L").resize((size, size), Image.Resampling.BILINEAR)
    return np.asarray(gray, dtype=np.uint8)


class MLBackend:
    """SigLIP + InsightFace + RapidOCR, CPU execution providers."""

    name = "ml"

    def __init__(self, settings: Settings | None = None) -> None:
        self.settings = settings or Settings()
        self._clip = None
        self._processor = None
        self._face = None
        self._face_fallback = None
        self._ocr = None
        self._whisper = None
        self._torch = None

    # ---------------------------------------------------------------- lazy

    def _ensure_clip(self):
        if self._clip is not None:
            return
        import torch
        from transformers import AutoModel, AutoProcessor

        self._torch = torch
        dtype = getattr(torch, self.settings.model_dtype)
        self._processor = AutoProcessor.from_pretrained(self.settings.siglip_model_id)
        # transformers renamed the kwarg from torch_dtype to dtype in v5.
        try:
            model = AutoModel.from_pretrained(
                self.settings.siglip_model_id, dtype=dtype
            )
        except TypeError:
            model = AutoModel.from_pretrained(
                self.settings.siglip_model_id, torch_dtype=dtype
            )
        self._clip = model.eval()

    def _build_face_app(self, det_size: int):
        """One InsightFace app whose detector runs at a fixed ``det_size``."""
        import onnxruntime
        from insightface.app import FaceAnalysis

        options = onnxruntime.SessionOptions()
        options.intra_op_num_threads = 1 if self.settings.device != "cpu" else _cpu_count()
        options.inter_op_num_threads = 1
        app = FaceAnalysis(
            name=self.settings.face_model_name,
            allowed_modules=["detection", "recognition"],
            providers=["CPUExecutionProvider"],
            sess_options=options,
        )
        app.prepare(ctx_id=-1, det_size=(det_size,) * 2)
        return app

    def _ensure_face(self):
        if self._face is not None:
            return
        self._face = self._build_face_app(self.settings.face_det_size)

    def _ensure_ocr(self):
        if self._ocr is not None:
            return
        from rapidocr_onnxruntime import RapidOCR

        kwargs = {}
        if self.settings.ocr_recognition_batch > 1:
            kwargs["rec_batch_num"] = self.settings.ocr_recognition_batch
        self._ocr = RapidOCR(**kwargs)

    def _ensure_whisper(self):
        if self._whisper is not None:
            return
        import av

        major = int(str(av.__version__).split(".")[0])
        if major >= 19:
            raise RuntimeError(
                f"PyAV {av.__version__} is incompatible with faster-whisper; pin av<19"
            )
        from faster_whisper import WhisperModel

        self._whisper = WhisperModel(
            self.settings.whisper_model,
            device=self.settings.device,
            compute_type=self.settings.whisper_compute_type,
        )

    # ---------------------------------------------------------------- clip

    @staticmethod
    def _features_to_array(output) -> np.ndarray:
        """Normalise a CLIP tower output to a float32 matrix.

        transformers 4.x returns a tensor from ``get_*_features``; 5.x returns a
        ``BaseModelOutputWithPooling`` whose ``pooler_output`` is the embedding.
        """
        if hasattr(output, "pooler_output"):
            tensor = output.pooler_output
        elif hasattr(output, "last_hidden_state"):
            tensor = output.last_hidden_state[:, 0]
        else:
            tensor = output
        return tensor.detach().cpu().numpy().astype(np.float32)

    def embed_images(self, images: Sequence[np.ndarray]) -> np.ndarray:
        if not images:
            return np.zeros((0, self.settings.clip_embedding_dim), dtype=np.float32)
        self._ensure_clip()
        from PIL import Image

        outputs = []
        batch_size = max(1, self.settings.gpu_batch_size)
        for start in range(0, len(images), batch_size):
            batch = [Image.fromarray(image) for image in images[start : start + batch_size]]
            inputs = self._processor(images=batch, return_tensors="pt")
            with self._torch.no_grad():
                features = self._clip.get_image_features(**inputs)
            outputs.append(self._features_to_array(features))
        return l2_normalize(np.vstack(outputs))

    def embed_text(self, text: str) -> np.ndarray:
        self._ensure_clip()
        # SigLIP was trained on fixed-length padded sequences. With dynamic
        # padding the text embedding is off-distribution and cross-modal
        # similarity becomes noise: measured 1/4 correct top-1 on a controlled
        # four-image set with padding="max_length", versus 4/4 with max_length.
        inputs = self._processor(text=[text], return_tensors="pt", padding="max_length")
        with self._torch.no_grad():
            features = self._clip.get_text_features(**inputs)
        return l2_normalize(self._features_to_array(features))[0]

    # ---------------------------------------------------------------- face

    def _detect_one(self, bgr: np.ndarray):
        """Detect faces, retrying at a smaller detector size when nothing is found.

        ``det_size`` is the size the detector resizes its input to, so it sets
        the scale of the anchor grid. On tightly-cropped portraits (LFW-style
        face crops) a 640 px grid misses faces that a 320 px grid finds: on a
        real LFW image, 640 returned 0 detections and 320 returned 1. Full-size
        photographs are the opposite case, so try the configured size first and
        fall back rather than picking one size for every input.

        The fallback is a second app, built on first use, rather than a second
        ``prepare`` of the first one: ``prepare`` changes the detector's size for
        every later call, which would silently demote all subsequent images to
        the fallback size and make results depend on file order.
        """
        found = self._face.get(bgr)
        if found:
            return found
        if self._face_fallback is None:
            self._face_fallback = self._build_face_app(self.settings.face_det_fallback_size)
        return self._face_fallback.get(bgr)

    def detect_faces(self, images: Sequence[np.ndarray]) -> list[list[Face]]:
        if not images:
            return []
        self._ensure_face()
        results: list[list[Face]] = []
        for image in images:
            bgr = image[:, :, ::-1].copy()
            found = []
            for item in self._detect_one(bgr):
                found.append(
                    Face(
                        embedding=np.asarray(item.embedding, dtype=np.float32),
                        bbox=[float(v) for v in item.bbox],
                        det_score=float(item.det_score),
                    )
                )
            results.append(found)
        return results

    # ----------------------------------------------------------------- ocr

    def ocr(self, images: Sequence[np.ndarray]) -> list[str]:
        if not images:
            return []
        self._ensure_ocr()
        texts: list[str] = []
        for image in images:
            result, _elapsed = self._ocr(image[:, :, ::-1].copy())
            if not result:
                texts.append("")
                continue
            texts.append(" ".join(str(line[1]).strip() for line in result if len(line) > 1))
        return texts

    # ----------------------------------------------------------- whisper

    @staticmethod
    def _has_audio(path: str) -> bool:
        """Whether the container carries at least one audio stream.

        faster-whisper decodes through PyAV and raises ``IndexError`` on a
        video-only file, which is common in screen recordings and GIF-style
        clips. Checking first keeps the stage from failing on them.
        """
        try:
            import av

            with av.open(str(path)) as container:
                return any(s.type == "audio" for s in container.streams)
        except Exception:
            return False

    def transcribe(self, path: str, language: str | None = None) -> str:
        if not self._has_audio(path):
            return ""
        self._ensure_whisper()
        segments, _info = self._whisper.transcribe(str(path), language=language, vad_filter=True)
        return " ".join(segment.text.strip() for segment in segments).strip()

    def close(self) -> None:
        self._clip = None
        self._processor = None
        self._face = None
        self._face_fallback = None
        self._ocr = None
        self._whisper = None


def _cpu_count() -> int:
    import os

    return os.cpu_count() or 4


def build_backend(settings: Settings) -> Backend:
    """Resolve ``settings.backend`` into a concrete backend instance."""
    choice = (settings.backend or "auto").lower()
    if choice == "hash":
        return HashBackend(settings)
    if choice in ("ml", "auto"):
        try:
            return MLBackend(settings)
        except Exception:
            if choice == "ml":
                raise
            return HashBackend(settings)
    raise ValueError(f"unknown backend: {settings.backend!r}")
