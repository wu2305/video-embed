"""Regression tests for the real ML backend's text encoder.

These are skipped unless torch and transformers are installed. They assert the
properties that the benchmark depends on, not just that the code runs:

- text and image embeddings live in the same space (a matching caption scores
  higher than a mismatched one)
- SigLIP's fixed-length padding is used, because dynamic padding produces
  off-distribution text embeddings and destroys cross-modal ranking
"""

from __future__ import annotations

import numpy as np
import pytest

torch = pytest.importorskip("torch", reason="torch not installed")
pytest.importorskip("transformers", reason="transformers not installed")


@pytest.fixture(scope="module")
def backend():
    from mmindex.backends import MLBackend
    from mmindex.config import Settings

    settings = Settings()
    settings.device = "cpu"
    settings.model_dtype = "float32"
    settings.gpu_batch_size = 4
    instance = MLBackend(settings)
    try:
        yield instance
    finally:
        instance.close()


def _shape_image(color, shape: str):
    from PIL import Image, ImageDraw

    image = Image.new("RGB", (224, 224), (250, 250, 250))
    draw = ImageDraw.Draw(image)
    box = [40, 40, 184, 184]
    if shape == "circle":
        draw.ellipse(box, fill=color)
    else:
        draw.rectangle(box, fill=color)
    return np.asarray(image, dtype=np.uint8)


def test_text_embedding_is_normalised(backend):
    vector = backend.embed_text("a photo of a red circle")
    assert vector.shape == (backend.settings.clip_embedding_dim,)
    assert np.isclose(np.linalg.norm(vector), 1.0, atol=1e-4)


def test_matching_caption_scores_above_mismatched(backend):
    """The core property retrieval relies on."""
    images = [
        _shape_image((220, 20, 20), "circle"),
        _shape_image((20, 20, 220), "rectangle"),
    ]
    image_vectors = backend.embed_images(images)
    matching = backend.embed_text("a red circle")
    mismatched = backend.embed_text("a blue rectangle")
    assert float(image_vectors[0] @ matching) > float(image_vectors[0] @ mismatched)


def test_text_padding_is_fixed_length(backend):
    """SigLIP needs max_length padding; dynamic padding scrambles the space.

    Measured before the fix: 1/4 correct top-1 on a controlled four-image set
    with padding=True, versus 4/4 with padding="max_length".
    """
    specs = [
        ((220, 20, 20), "circle", "a red circle"),
        ((20, 20, 220), "rectangle", "a blue square"),
        ((20, 180, 20), "circle", "a green circle"),
        ((240, 240, 20), "rectangle", "a yellow rectangle"),
    ]
    images = [_shape_image(color, shape) for color, shape, _ in specs]
    captions = [caption for _, _, caption in specs]
    image_vectors = backend.embed_images(images)
    correct = 0
    for index, caption in enumerate(captions):
        text_vector = backend.embed_text(caption)
        scores = image_vectors @ text_vector
        if int(np.argmax(scores)) == index:
            correct += 1
    assert correct == len(specs), f"only {correct}/{len(specs)} captions ranked correctly"


def test_identical_captions_give_identical_vectors(backend):
    first = backend.embed_text("a busy street")
    second = backend.embed_text("a busy street")
    assert np.allclose(first, second, atol=1e-6)
