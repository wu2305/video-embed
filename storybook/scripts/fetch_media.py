#!/usr/bin/env python3
"""Real keyframes for the Storybook mocks, from the Flickr30k test split.

The gallery's stand-in frames are drawn SVGs. This swaps them for photos from
the same Hugging Face test set the benchmark uses (``lmms-lab-encoder/flickr30k``).
It reads the dataset's Parquet shards with range requests: captions alone to
choose, then one row group (100 photos, about 13 MB) per photo it keeps.

    python scripts/fetch_media.py                         # fetch the photos named in the lock file
    python scripts/fetch_media.py --select                # pick new photos, detect faces, rewrite the lock
    python scripts/fetch_media.py --select --only office  # re-pick one scene, keep the rest
    python scripts/fetch_media.py --select --only kitchen --pin kitchen=342092288.jpg  # a chosen photo

The photos land in ``src/mock/media/`` (gitignored: Flickr30k is licensed for
non-commercial research, so the repo does not redistribute it). The lock file,
``src/mock/media.lock.json``, is committed. It names each photo by shard, row
and Flickr file name, carries the face boxes, and says which face is which
mock person (edit ``crops`` to reassign), so every checkout gets the same set
and the stories line up whether or not the photos are present.

Needs ``huggingface_hub``, ``pyarrow`` and Pillow. ``--select`` also needs
opencv-python(-headless) >= 4.8; it downloads OpenCV's YuNet face model.
"""

from __future__ import annotations

import argparse
import io
import json
import re
import sys
import time
import urllib.request
from pathlib import Path

DATASET = "lmms-lab-encoder/flickr30k"
SHARDS = f"datasets/{DATASET}/data"
YUNET_URL = "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx"

HERE = Path(__file__).resolve().parent.parent
MEDIA = HERE / "src" / "mock" / "media"
LOCK = HERE / "src" / "mock" / "media.lock.json"
MAX_WIDTH = 960
CROP_SIZE = 320

# One photo per scene the mocks use. `want` (and `need`, if set) must match the
# captions; `faces` bounds the detected face count; `min_face` is the smallest
# face width as a share of the image width, so boxes stay readable on a card.
SLOTS = {
    "kitchen": {
        "want": r"\bkitchen\b.*\b(cook|cooking|prepar|food|meal)|\b(cook|cooking)\b.*\bkitchen\b",
        "faces": (3, 4), "min_face": 0.045,
    },
    "office": {
        "want": r"\bgiving a (presentation|speech|lecture|talk)\b|\b(at|behind) a (podium|lectern)\b|\bpresentation (to|for)\b",
        "faces": (1, 3), "min_face": 0.05,
    },
    "park": {
        "want": r"\b(picnic|park)\b.*\b(group|family|friends|people)\b|\b(group|family|friends)\b.*\b(picnic|park)\b",
        "faces": (3, 6), "min_face": 0.035,
    },
    "night": {"want": r"\bnight\b.*\b(street|city|downtown)\b|\b(street|city)\b.*\bat night\b", "faces": (0, 6), "min_face": 0.0},
}
# Skip photos whose captions mention children or teenagers.
AVOID = re.compile(r"\b(child|children|kid|kids|boy|boys|girl|girls|baby|toddler|infant|teen|teens|teenager|teenagers|youth|student|students)\b", re.I)
# Default person samples: crops of faces by size order. --select writes these
# into the lock file; edit the lock to reassign a face, then rerun the fetch.
CROPS = [("person-0003", "kitchen", 0), ("person-0007", "kitchen", 1), ("person-0011", "kitchen", 2), ("person-0019", "office", 0)]


def get_bytes(url: str, tries: int = 5) -> bytes:
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(url, timeout=60) as r:
                return r.read()
        except Exception:
            if attempt == tries - 1:
                raise
            time.sleep(2 ** (attempt + 1))
    raise AssertionError


class Shards:
    """The test split's Parquet shards, read lazily over HTTP range requests."""

    def __init__(self) -> None:
        from huggingface_hub import HfFileSystem

        self.fs = HfFileSystem()
        self.paths = sorted(self.fs.ls(SHARDS, detail=False))
        self._files: dict[str, object] = {}

    def file(self, path: str):
        import pyarrow.parquet as pq

        if path not in self._files:
            self._files[path] = pq.ParquetFile(self.fs.open(path, block_size=2**20))
        return self._files[path]

    def captions(self):
        """Yield (shard, row group, row, filename, captions) for every photo."""
        for path in self.paths:
            pf = self.file(path)
            for group in range(pf.num_row_groups):
                table = pf.read_row_group(group, columns=["filename", "caption"]).to_pylist()
                for row, item in enumerate(table):
                    yield path, group, row, item["filename"], item["caption"]

    def image(self, path: str, group: int, row: int) -> bytes:
        cell = self.file(path).read_row_group(group, columns=["image"]).column("image")[row].as_py()
        return cell["bytes"]


def save_photo(data: bytes, path: Path) -> tuple[int, int]:
    from PIL import Image

    img = Image.open(io.BytesIO(data)).convert("RGB")
    if img.width > MAX_WIDTH:
        img = img.resize((MAX_WIDTH, round(img.height * MAX_WIDTH / img.width)), Image.LANCZOS)
    path.parent.mkdir(parents=True, exist_ok=True)
    img.save(path, "JPEG", quality=82, optimize=True, progressive=True)
    return img.width, img.height


def save_crop(photo: Path, box: list[float], path: Path) -> None:
    """A square around one face, with room for hair and shoulders."""
    from PIL import Image

    img = Image.open(photo)
    x, y, w, h = box[0] * img.width, box[1] * img.height, box[2] * img.width, box[3] * img.height
    side = min(max(w, h) * 2.4, img.width, img.height)
    cx, cy = x + w / 2, y + h / 2 + h * 0.15
    left = min(max(cx - side / 2, 0), img.width - side)
    top = min(max(cy - side / 2, 0), img.height - side)
    crop = img.crop((round(left), round(top), round(left + side), round(top + side)))
    crop.resize((CROP_SIZE, CROP_SIZE), Image.LANCZOS).save(path, "JPEG", quality=85)


def write_crops(lock: dict) -> None:
    for person, crop in lock["crops"].items():
        faces = lock["scenes"][crop["scene"]]["faces"]
        if crop["face"] < len(faces):
            save_crop(MEDIA / f"{crop['scene']}.jpg", faces[crop["face"]], MEDIA / f"{person}.jpg")


# ------------------------------------------------------------------ fetch

def fetch() -> int:
    if not LOCK.exists():
        print(f"no lock file at {LOCK}; run with --select first", file=sys.stderr)
        return 1
    lock = json.loads(LOCK.read_text())
    shards = Shards()
    for slot, scene in lock["scenes"].items():
        target = MEDIA / f"{slot}.jpg"
        if target.exists():
            print(f"{slot}: present")
            continue
        name = shards.file(scene["shard"]).read_row_group(scene["row_group"], columns=["filename"]).column(0)[scene["row"]].as_py()
        if name != scene["filename"]:
            print(f"{slot}: {scene['shard']} row {scene['row']} is now {name}, expected {scene['filename']}; run --select", file=sys.stderr)
            return 1
        save_photo(shards.image(scene["shard"], scene["row_group"], scene["row"]), target)
        print(f"{slot}: {scene['filename']} -> {target.relative_to(HERE)}")
    write_crops(lock)
    print(f"crops: {', '.join(lock['crops'])}")
    return 0


# ----------------------------------------------------------------- select

def detector(model: Path):
    import cv2

    if not model.exists():
        model.parent.mkdir(parents=True, exist_ok=True)
        model.write_bytes(get_bytes(YUNET_URL))
    return cv2.FaceDetectorYN.create(str(model), "", (320, 320), score_threshold=0.85)


def detect(det, data: bytes) -> list[list[float]]:
    """Faces as [x, y, w, h] normalised to 0..1, largest first."""
    import cv2
    import numpy as np

    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    h, w = img.shape[:2]
    det.setInputSize((w, h))
    _, found = det.detect(img)
    boxes = [] if found is None else [[float(f[0]), float(f[1]), float(f[2]), float(f[3])] for f in found]
    boxes.sort(key=lambda b: -b[2] * b[3])
    return [[round(max(x, 0) / w, 4), round(max(y, 0) / h, 4), round(bw / w, 4), round(bh / h, 4)] for x, y, bw, bh in boxes]


def select(model: Path, only: list[str] | None, pins: dict[str, str]) -> int:
    det = detector(model)
    old = json.loads(LOCK.read_text()) if LOCK.exists() else {}
    scenes = {k: v for k, v in old.get("scenes", {}).items() if only and k not in only}
    todo = {k: v for k, v in SLOTS.items() if k not in scenes}
    picked = set(todo)
    shards = Shards()
    for path, group, row, filename, captions in shards.captions():
        if not todo:
            break
        text = " ".join(captions).lower()
        if AVOID.search(text) and filename not in pins.values():
            continue
        for slot, rule in list(todo.items()):
            if slot in pins:
                if filename != pins[slot]:
                    continue
            elif not re.search(rule["want"], text) or ("need" in rule and not re.search(rule["need"], text)):
                continue
            data = shards.image(path, group, row)
            faces = [f for f in detect(det, data) if f[2] >= rule["min_face"]]
            lo, hi = rule["faces"]
            if not lo <= len(faces) <= hi:
                continue
            width, height = save_photo(data, MEDIA / f"{slot}.jpg")
            scenes[slot] = {
                "shard": path, "row_group": group, "row": row, "filename": filename,
                "caption": captions[0].strip().rstrip(" ."), "width": width, "height": height, "faces": faces,
            }
            print(f"{slot}: {filename} · {len(faces)} faces · {captions[0][:70]}")
            del todo[slot]
            break
    if todo:
        print(f"no match in the test split for: {', '.join(todo)}", file=sys.stderr)
        return 1
    crops = {}
    for person, slot, index in CROPS:
        kept = old.get("crops", {}).get(person)
        crops[person] = kept if kept and slot not in picked else {"scene": slot, "face": index}
    lock = {
        "source": {
            "dataset": DATASET, "split": "test",
            "license": "Flickr30k: images remain the copyright of their Flickr owners; the dataset is for non-commercial research and education.",
        },
        "scenes": {k: scenes[k] for k in SLOTS},
        "crops": crops,
    }
    LOCK.write_text(json.dumps(lock, indent=2, ensure_ascii=False) + "\n")
    write_crops(lock)
    print(f"wrote {LOCK.relative_to(HERE)}")
    return 0


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--select", action="store_true", help="pick new photos and rewrite the lock file")
    ap.add_argument("--only", help="with --select: re-pick only these slots (comma-separated), keep the rest")
    ap.add_argument("--pin", action="append", default=[], metavar="SLOT=FILE", help="with --select: use this Flickr file for a slot")
    ap.add_argument("--model", type=Path, default=HERE / ".cache" / "face_detection_yunet_2023mar.onnx")
    args = ap.parse_args()
    pins = dict(p.split("=", 1) for p in args.pin)
    return select(args.model, args.only.split(",") if args.only else None, pins) if args.select else fetch()


if __name__ == "__main__":
    raise SystemExit(main())
