from __future__ import annotations

import io

import numpy as np
import pytest

from mmindex.config import Settings
from mmindex.media import sharpness


def _photo(seed: int = 0, size: int = 300) -> np.ndarray:
    """A photo-like image: a smooth gradient with a few hard edges.

    The gradient is noise-free on purpose. Added pixel noise is broadband, and
    downscaling destroys most of it, so the original then wins under *any*
    metric and the fixture stops reproducing the bug. Real photographs are
    mostly smooth with sparse detail — the case where a half-size copy upscaled
    by the decoder gains high-frequency energy instead of losing it.
    """
    yy, xx = np.mgrid[0:size, 0:size]
    image = np.stack(
        [(xx * 0.7 + 40), (yy * 0.6 + 60), ((xx + yy) * 0.4 + 50)], axis=-1
    )
    image = np.clip(image, 0, 255).astype(np.uint8)
    box = size // 3
    image[box : 2 * box, box : 2 * box] = (30, 30, 30)
    image[box : box + 6, :] = (245, 245, 245)
    return image


def _lossy(image: np.ndarray) -> np.ndarray:
    """A half-size quality-35 JPEG, the benchmark's ``WECHAT_COMP`` variant."""
    from PIL import Image

    picture = Image.fromarray(image)
    width, height = picture.size
    picture = picture.resize((max(64, width // 2), max(64, height // 2)))
    buffer = io.BytesIO()
    picture.save(buffer, "JPEG", quality=35)
    buffer.seek(0)
    return np.asarray(Image.open(buffer).convert("RGB"), dtype=np.uint8)


def _blur(image: np.ndarray) -> np.ndarray:
    import cv2

    return cv2.GaussianBlur(image[:, :, ::-1], (17, 17), 6)[:, :, ::-1]


def test_raw_sharpness_prefers_the_degraded_copy():
    """Documents the bug the normalised default fixes.

    A half-resolution copy upscaled by the decoder carries more high-frequency
    energy than the original, so raw Laplacian variance ranks it sharper. This
    is why master election used to pick blurred/compressed copies.
    """
    original = _photo()
    assert sharpness(_lossy(original), None) > sharpness(original, None)


def test_normalised_sharpness_ranks_the_original_first():
    original = _photo()
    assert sharpness(original, 256) > sharpness(_lossy(original), 256)
    assert sharpness(original, 256) > sharpness(_blur(original), 256)


def test_sharpness_handles_tiny_and_flat_images():
    flat = np.full((32, 32, 3), 128, dtype=np.uint8)
    assert sharpness(flat, 256) == pytest.approx(0.0, abs=1e-6)
    tiny = np.zeros((2, 2, 3), dtype=np.uint8)
    assert sharpness(tiny, 256) >= 0.0


def test_settings_default_to_the_normalised_scale():
    assert Settings().sharpness_edge == 256


def test_infer_records_the_scale_it_measured_at(media_tree, layout, settings, backend):
    from mmindex.checkpoint import IncrementalCheckpoint
    from mmindex.pipeline import Pipeline
    from mmindex.scan import read_manifest
    from mmindex.stages import infer_entry

    pipeline = Pipeline(layout, settings, log=lambda _m: None)
    try:
        pipeline.run_all(media_tree, stages=("prepare", "extract"))
    finally:
        pipeline.close()

    entry = read_manifest(layout)[0]
    store = IncrementalCheckpoint(layout.checkpoint_db, stage="infer", auto_sync=False)
    try:
        record = infer_entry(entry, layout, settings, store, backend)
    finally:
        store.close(sync=False)
    assert record["sharpness_edge"] == settings.sharpness_edge


def _unit(index: int, edge: int | None, sharp: float = 10.0) -> dict:
    unit = {
        "unit_index": index,
        "path": f"/m/{index}.jpg",
        "digest": f"d{index}",
        "kind": "image",
        "canonical_time": 0.0,
        "clip_embedding": np.eye(4, dtype=np.float32)[index % 4],
        "faces": [],
        "dhash": f"{index * 0x0101010101010101 % (1 << 64):016x}",
        "sharpness": sharp,
    }
    if edge is not None:
        unit["sharpness_edge"] = edge
    return unit


def test_export_refuses_a_mixed_sharpness_scale(layout, settings):
    """Old full-resolution records and new normalised ones cannot be compared."""
    from mmindex.export import ExportError, export_snapshot

    settings.clip_embedding_dim = 4
    with pytest.raises(ExportError, match="sharpness scales"):
        export_snapshot([_unit(0, 256), _unit(1, 0)], layout, settings)
    assert not layout.index_manifest.exists()


def test_export_records_the_scale_in_the_manifest(layout, settings):
    from mmindex.export import export_snapshot

    settings.clip_embedding_dim = 4
    manifest = export_snapshot([_unit(0, 256), _unit(1, 256)], layout, settings)
    assert manifest["settings"]["sharpness_edge"] == 256


def test_legacy_records_without_a_scale_still_export(layout, settings):
    """Records written before the field existed are all raw, so they agree."""
    from mmindex.export import export_snapshot

    settings.clip_embedding_dim = 4
    manifest = export_snapshot([_unit(0, None), _unit(1, None)], layout, settings)
    assert manifest["settings"]["sharpness_edge"] == 0

