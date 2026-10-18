from __future__ import annotations

import numpy as np
import pytest

from mmindex.backends import HashBackend, _thumbnail, l2_normalize


class _Tensor:
    """Minimal stand-in for a torch tensor."""

    def __init__(self, array):
        self._array = np.asarray(array, dtype=np.float32)

    def detach(self):
        return self

    def cpu(self):
        return self

    def numpy(self):
        return self._array

    def __getitem__(self, item):
        return _Tensor(self._array[item])


class _Output:
    """Minimal stand-in for transformers' BaseModelOutputWithPooling."""

    def __init__(self, pooled=None, hidden=None):
        if pooled is not None:
            self.pooler_output = _Tensor(pooled)
        if hidden is not None:
            self.last_hidden_state = _Tensor(hidden)


def test_features_to_array_accepts_bare_tensor():
    from mmindex.backends import MLBackend

    result = MLBackend._features_to_array(_Tensor([[1.0, 2.0]]))
    assert result.dtype == np.float32
    assert result.tolist() == [[1.0, 2.0]]


def test_features_to_array_prefers_pooler_output():
    from mmindex.backends import MLBackend

    output = _Output(pooled=[[1.0, 2.0]], hidden=np.zeros((1, 3, 2)))
    assert MLBackend._features_to_array(output).tolist() == [[1.0, 2.0]]


def test_features_to_array_falls_back_to_cls_token():
    from mmindex.backends import MLBackend

    hidden = np.array([[[9.0, 9.0], [1.0, 2.0]]], dtype=np.float32)
    result = MLBackend._features_to_array(_Output(hidden=hidden))
    assert result.tolist() == [[9.0, 9.0]]


def test_l2_normalize_rows():
    array = np.array([[3.0, 4.0], [0.0, 0.0]], dtype=np.float32)
    result = l2_normalize(array)
    assert np.allclose(result[0], [0.6, 0.8])
    assert np.allclose(result[1], [0.0, 0.0])


def test_l2_normalize_single_vector():
    result = l2_normalize(np.array([3.0, 4.0], dtype=np.float32))
    assert np.allclose(result, [0.6, 0.8])


def test_hash_backend_embeddings_are_deterministic(settings):
    backend = HashBackend(settings)
    rng = np.random.default_rng(5)
    image = (rng.random((64, 64, 3)) * 255).astype("uint8")
    first = backend.embed_images([image])
    second = backend.embed_images([image])
    assert np.allclose(first, second)
    assert first.shape == (1, settings.clip_embedding_dim)
    assert np.allclose(np.linalg.norm(first, axis=1), 1.0, atol=1e-5)


def test_hash_backend_embed_text_dimension(settings):
    backend = HashBackend(settings)
    vector = backend.embed_text("a bridge")
    assert vector.shape == (settings.clip_embedding_dim,)
    assert np.isclose(np.linalg.norm(vector), 1.0, atol=1e-5)


def test_hash_backend_detects_contrast_not_flat_frames(settings):
    backend = HashBackend(settings)
    rng = np.random.default_rng(9)
    noisy = (rng.random((96, 96, 3)) * 255).astype("uint8")
    flat = np.full((96, 96, 3), 128, dtype="uint8")
    assert len(backend.detect_faces([noisy])[0]) == 1
    assert len(backend.detect_faces([flat])[0]) == 0


def test_thumbnail_shape():
    image = np.zeros((100, 50, 3), dtype="uint8")
    assert _thumbnail(image, 16).shape == (16, 16)
