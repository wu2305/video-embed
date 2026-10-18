from __future__ import annotations

import numpy as np
import pytest

from mmindex.backends import MLBackend


def _ml_available() -> bool:
    for module in ("av", "faster_whisper"):
        try:
            __import__(module)
        except Exception:
            return False
    return True


def _silent_video(path) -> bool:
    try:
        import cv2
    except ImportError:
        return False
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), 10, (64, 64))
    if not writer.isOpened():
        return False
    for _ in range(10):
        writer.write(np.zeros((64, 64, 3), dtype=np.uint8))
    writer.release()
    return True


def test_has_audio_detects_video_without_audio(tmp_path):
    if not _ml_available():
        pytest.skip("PyAV not installed")
    video = tmp_path / "silent.mp4"
    if not _silent_video(video):
        pytest.skip("no mp4 encoder available")
    assert MLBackend._has_audio(str(video)) is False


def test_has_audio_is_false_for_missing_file(tmp_path):
    if not _ml_available():
        pytest.skip("PyAV not installed")
    assert MLBackend._has_audio(str(tmp_path / "nope.mp4")) is False


def test_transcribe_returns_empty_for_video_without_audio(tmp_path):
    if not _ml_available():
        pytest.skip("PyAV not installed")
    video = tmp_path / "silent.mp4"
    if not _silent_video(video):
        pytest.skip("no mp4 encoder available")
    backend = MLBackend()
    try:
        assert backend.transcribe(str(video)) == ""
    finally:
        backend.close()
