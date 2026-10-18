from __future__ import annotations

import importlib

import numpy as np
import pytest

from mmindex.config import Layout, Settings
from mmindex.pipeline import Pipeline


def _require(module: str):
    """Import ``module`` or skip, tolerating broken native dependencies.

    pytest's ``importorskip`` only skips on ``ModuleNotFoundError`` in recent
    versions, but OpenCV raises a plain ``ImportError`` when a shared library
    such as libGL is absent — which is the common case in slim containers.
    """
    try:
        return importlib.import_module(module)
    except ImportError as exc:
        pytest.skip(f"{module} unavailable: {exc}")


def _write_video(path, segments=3, seconds=2, fps=10, size=(160, 120)):
    cv2 = _require("cv2")
    writer = cv2.VideoWriter(str(path), cv2.VideoWriter_fourcc(*"mp4v"), fps, size)
    if not writer.isOpened():
        pytest.skip("no mp4 encoder available")
    colors = [(20, 20, 200), (20, 200, 20), (200, 20, 20), (200, 200, 20)]
    for segment in range(segments):
        color = colors[segment % len(colors)]
        for frame_index in range(fps * seconds):
            frame = np.full((size[1], size[0], 3), color, dtype=np.uint8)
            frame[20:60, 20:60] = (255, 255, 255) if frame_index % 2 else (0, 0, 0)
            writer.write(frame)
    writer.release()


def test_video_scene_detection_produces_one_unit_per_scene(tmp_path):
    _require("scenedetect")
    media = tmp_path / "media"
    media.mkdir()
    _write_video(media / "scene.mp4")

    layout = Layout(tmp_path / "work")
    settings = Settings()
    settings.backend = "hash"
    pipeline = Pipeline(layout, settings, log=lambda _m: None)
    try:
        results = pipeline.run_all(media)
    finally:
        pipeline.close()

    assert results["export"]["unit_count"] == 3


def test_scene_fallback_without_detector(tmp_path):
    """An undecodable video still yields spans via the fixed-length fallback."""
    from mmindex import stages

    settings = Settings()
    settings.scene_fallback_seconds = 2.0

    spans = stages.scene_boundaries(tmp_path / "missing.mp4", settings)
    assert spans == [(0.0, 0.0)]
