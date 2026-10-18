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


def test_lfw_limit_keeps_whole_identity_blocks(tmp_path, monkeypatch):
    """Each sampled person needs several photos for clustering to work."""
    _patch_sklearn(monkeypatch, _FakeLFW(per_person=10, people=20))
    spec = CorpusSpec(lfw_limit=40, enable_cross_age=False, enable_flickr=False, enable_msrvtt=False)
    saved = fetch_lfw(tmp_path, spec, log=lambda _m: None)
    identities = {path.parent.name for path in saved}
    # 40 images over identities with >=5 photos each means at most 8 people,
    # and every one of them must have enough photos to form a cluster.
    assert len(identities) <= 8
    per_identity = {}
    for path in saved:
        per_identity[path.parent.name] = per_identity.get(path.parent.name, 0) + 1
    assert min(per_identity.values()) >= spec.lfw_min_per_identity
    assert sum(per_identity.values()) == len(saved)


def test_lfw_identities_are_spread_across_the_dataset(tmp_path, monkeypatch):
    _patch_sklearn(monkeypatch, _FakeLFW(per_person=6, people=30))
    spec = CorpusSpec(lfw_limit=60, enable_cross_age=False, enable_flickr=False, enable_msrvtt=False)
    saved = fetch_lfw(tmp_path, spec, log=lambda _m: None)
    people = sorted({int(p.parent.name.split("_", 1)[1].split("_")[-1]) for p in saved})
    # Sampling is strided over identities, so the sample must not be just the
    # first few people in the file.
    assert people[-1] > 10


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
