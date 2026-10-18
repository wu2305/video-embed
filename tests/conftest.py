from __future__ import annotations

import numpy as np
import pytest
from PIL import Image


@pytest.fixture
def media_tree(tmp_path):
    """A small deterministic media tree with one exact duplicate."""
    root = tmp_path / "media"
    root.mkdir()
    rng = np.random.default_rng(1234)
    for index in range(3):
        array = (rng.random((64, 80, 3)) * 255).astype("uint8")
        Image.fromarray(array).save(root / f"shot_{index}.png")
    (root / "dup_shot_0.png").write_bytes((root / "shot_0.png").read_bytes())
    return root


@pytest.fixture
def layout(tmp_path):
    from mmindex.config import Layout

    return Layout(tmp_path / "index_work")


@pytest.fixture
def settings():
    from mmindex.config import Settings

    settings = Settings()
    settings.backend = "hash"
    return settings


@pytest.fixture
def backend(settings):
    from mmindex.backends import HashBackend

    return HashBackend(settings)
