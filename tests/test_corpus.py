from __future__ import annotations

import sys
import types

import numpy as np

from mmindex.benchmark.corpus import CorpusSpec, fetch_lfw


class _FakeLFW:
    """Stand-in for sklearn's fetch_lfw_people result, ordered by identity."""

    def __init__(self, per_person=10, people=20):
        self.target_names = [f"Person {i}" for i in range(people)]
        targets = np.repeat(np.arange(people), per_person)
        self.target = targets
        rng = np.random.default_rng(0)
        self.images = rng.random((len(targets), 62, 47, 3)).astype(np.float32)


def _patch_sklearn(monkeypatch, fake):
    module = types.ModuleType("sklearn.datasets")
    module.fetch_lfw_people = lambda **_kwargs: fake
    package = types.ModuleType("sklearn")
    package.datasets = module
    monkeypatch.setitem(sys.modules, "sklearn", package)
    monkeypatch.setitem(sys.modules, "sklearn.datasets", module)


def test_lfw_limit_strides_across_identities(tmp_path, monkeypatch):
    """A head slice would cover one identity; striding must cover many."""
    _patch_sklearn(monkeypatch, _FakeLFW(per_person=10, people=20))
    spec = CorpusSpec(lfw_limit=40, enable_cross_age=False, enable_flickr=False, enable_msrvtt=False)
    saved = fetch_lfw(tmp_path, spec, log=lambda _m: None)
    assert len(saved) == 40
    identities = {path.parent.name for path in saved}
    # 200 images over 20 identities: 40 strided samples must hit most of them.
    assert len(identities) >= 15


def test_lfw_writes_expected_directory_layout(tmp_path, monkeypatch):
    _patch_sklearn(monkeypatch, _FakeLFW(per_person=4, people=3))
    spec = CorpusSpec(lfw_limit=None, enable_cross_age=False, enable_flickr=False, enable_msrvtt=False)
    saved = fetch_lfw(tmp_path, spec, log=lambda _m: None)
    assert len(saved) == 12
    for path in saved:
        assert path.parent.parent.name == "01_LFW_People_Archive"
        assert path.name.startswith("LFW_")
        assert path.suffix == ".jpg"
        folder = path.parent.name
        assert folder.split("_", 1)[0] in {"2016", "2018", "2020", "2022", "2024"}


def test_lfw_limit_none_exports_everything(tmp_path, monkeypatch):
    _patch_sklearn(monkeypatch, _FakeLFW(per_person=2, people=5))
    spec = CorpusSpec(lfw_limit=None, enable_cross_age=False, enable_flickr=False, enable_msrvtt=False)
    saved = fetch_lfw(tmp_path, spec, log=lambda _m: None)
    assert len(saved) == 10
