from __future__ import annotations

from mmindex.config import Settings, media_kind


def test_from_env_reads_typed_values(monkeypatch):
    monkeypatch.setenv("MMINDEX_BACKEND", "hash")
    monkeypatch.setenv("MMINDEX_TEXT_BONUS", "0.25")
    monkeypatch.setenv("MMINDEX_PCA_THRESHOLD", "1000")
    settings = Settings.from_env()
    assert settings.backend == "hash"
    assert settings.text_bonus == 0.25
    assert settings.pca_threshold == 1000


def test_from_env_ignores_unset_variables(monkeypatch):
    for name in ("MMINDEX_BACKEND", "MMINDEX_TEXT_BONUS", "MMINDEX_PCA_THRESHOLD"):
        monkeypatch.delenv(name, raising=False)
    settings = Settings.from_env()
    assert settings.backend == "auto"
    assert settings.text_bonus == 0.15


def test_to_dict_roundtrip():
    settings = Settings()
    settings.backend = "hash"
    restored = Settings.from_dict(settings.to_dict())
    assert restored == settings


def test_from_dict_ignores_unknown_keys():
    settings = Settings.from_dict({"backend": "hash", "not_a_field": 1})
    assert settings.backend == "hash"


def test_cpu_defaults_match_the_documented_port():
    settings = Settings()
    assert settings.device == "cpu"
    assert settings.model_dtype == "float32"
    assert settings.gpu_batch_size == 8
    assert settings.ocr_recognition_batch == 1


def test_media_kind_classification(tmp_path):
    assert media_kind("a.jpg") == "image"
    assert media_kind("a.MP4") == "video"
    assert media_kind("a.txt") is None


def test_layout_refuses_the_production_namespace(tmp_path):
    import pytest

    from mmindex.config import PRODUCTION_NAMESPACE, Layout, ProtectedPathError

    with pytest.raises(ProtectedPathError, match=PRODUCTION_NAMESPACE):
        Layout(tmp_path, namespace=PRODUCTION_NAMESPACE)
    assert Layout(tmp_path, namespace="review").namespace == "review"
