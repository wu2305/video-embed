from __future__ import annotations

import numpy as np

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


class _FakeFaceApp:
    """Stands in for an InsightFace app whose detector size is fixed at build time."""

    def __init__(self, det_size):
        self.det_size = det_size
        self.calls = 0

    def get(self, bgr):
        self.calls += 1
        marker = int(bgr[0, 0, 0])
        # marker 0 = tight crop: only the small grid finds the face.
        # marker 1 = full-size photo: only the large grid finds it.
        found = (marker == 0 and self.det_size == 320) or (marker == 1 and self.det_size == 640)
        if not found:
            return []
        return [type("F", (), {"embedding": np.ones(4), "bbox": [0, 0, 1, 1], "det_score": 0.9})()]


def _face_backend(settings, built):
    from mmindex.backends import MLBackend

    backend = MLBackend(settings)

    def build(det_size):
        app = _FakeFaceApp(det_size)
        built.append(app)
        return app

    backend._build_face_app = build
    return backend


def test_face_fallback_does_not_demote_later_images(settings):
    """Regression: one tight crop must not switch every later image to 320 px."""
    built: list = []
    backend = _face_backend(settings, built)
    crop = np.zeros((8, 8, 3), dtype="uint8")  # found only at 320
    photo = np.ones((8, 8, 3), dtype="uint8")  # found only at 640

    results = backend.detect_faces([crop, photo, photo, crop])

    assert [len(r) for r in results] == [1, 1, 1, 1]
    primary, fallback = built
    assert (primary.det_size, fallback.det_size) == (640, 320)
    # The fallback ran only for the two crops; both photos were served at 640.
    assert fallback.calls == 2
    assert primary.calls == 4


def test_face_detection_is_order_independent(settings):
    crop = np.zeros((8, 8, 3), dtype="uint8")
    photo = np.ones((8, 8, 3), dtype="uint8")
    forward = _face_backend(settings, [])
    backward = _face_backend(settings, [])
    a = forward.detect_faces([crop, photo])
    b = backward.detect_faces([photo, crop])
    assert [len(r) for r in a] == [1, 1]
    assert [len(r) for r in reversed(b)] == [1, 1]


def test_face_fallback_app_is_built_lazily_and_once(settings):
    built: list = []
    backend = _face_backend(settings, built)
    photo = np.ones((8, 8, 3), dtype="uint8")
    backend.detect_faces([photo, photo])
    assert [app.det_size for app in built] == [640]  # no fallback needed, none built
    crop = np.zeros((8, 8, 3), dtype="uint8")
    backend.detect_faces([crop, crop, crop])
    assert [app.det_size for app in built] == [640, 320]


def test_close_releases_the_fallback_app(settings):
    built: list = []
    backend = _face_backend(settings, built)
    backend.detect_faces([np.zeros((8, 8, 3), dtype="uint8")])
    backend.close()
    assert backend._face is None and backend._face_fallback is None
