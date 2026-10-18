#!/usr/bin/env bash
# Smoke test: drive the whole pipeline with the dependency-free hash backend.
#
# Runs in CI and inside the cloud dev environment. It proves scan, prepare,
# extract, infer, cluster, export, verify and search all work together without
# downloading any model weights.
set -euo pipefail

workdir="$(mktemp -d)"
trap 'rm -rf "$workdir"' EXIT

media="$workdir/media"
mkdir -p "$media"

python - "$media" <<'PY'
import sys
from pathlib import Path

import numpy as np
from PIL import Image

target = Path(sys.argv[1])
rng = np.random.default_rng(20261018)
for index in range(6):
    array = (rng.random((96, 128, 3)) * 255).astype("uint8")
    Image.fromarray(array).save(target / f"frame_{index}.png")

# One exact duplicate and one near-duplicate to exercise both dedup paths.
(target / "copy_frame_0.png").write_bytes((target / "frame_0.png").read_bytes())
base = np.asarray(Image.open(target / "frame_1.png"))
Image.fromarray((base * 0.9).astype("uint8")).save(target / "near_frame_1.png")
PY

echo "== scan =="
mmindex scan "$media" --work-dir "$workdir/work"

echo "== full pipeline =="
mmindex run "$media" --work-dir "$workdir/work" --backend hash --skip-scan

echo "== verify =="
mmindex verify --work-dir "$workdir/work"

echo "== search =="
mmindex search "frame" --work-dir "$workdir/work" --backend hash --limit 3

echo "== idempotent rerun =="
mmindex run "$media" --work-dir "$workdir/work" --backend hash --skip-scan

echo "smoke test passed"
