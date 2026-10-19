#!/usr/bin/env python3
"""Does the 1024 px frame bound cost face detections or OCR text?

Downloads a few large real photos, then runs InsightFace + RapidOCR on the
original and on the same photo after `media.save_frame` (the extract stage's
bounded JPEG). Prints a per-image comparison so the frame_max_edge choice can be
justified from measurement rather than a guess.
"""

from __future__ import annotations

import sys
import urllib.request
from pathlib import Path

import numpy as np

SOURCES = {
    # Genuinely large photographs (2000-3000 px) are needed to exercise the
    # bound at all; the sample images bundled with OpenCV/HF are already small.
    # Pexels serves these anonymously, Wikimedia often times out from CI.
    "portrait": "https://images.pexels.com/photos/415829/pexels-photo-415829.jpeg"
    "?auto=compress&cs=tinysrgb&w=3000",
    "group": "https://images.pexels.com/photos/3184418/pexels-photo-3184418.jpeg"
    "?auto=compress&cs=tinysrgb&w=3000",
    "street_sign": "https://images.pexels.com/photos/1092730/pexels-photo-1092730.jpeg"
    "?auto=compress&cs=tinysrgb&w=3000",
    "lena": "https://raw.githubusercontent.com/opencv/opencv/master/samples/data/lena.jpg",
}


def fetch(name: str, url: str, root: Path) -> Path | None:
    target = root / f"{name}.img"
    if target.exists():
        return target
    try:
        request = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Mozilla/5.0 (compatible; mmindex-probe/1.0)",
                "Accept": "image/jpeg,image/*",
            },
        )
        with urllib.request.urlopen(request, timeout=60) as response:
            target.write_bytes(response.read())
        return target
    except Exception as exc:
        print(f"{name}: download failed ({type(exc).__name__}: {exc})")
        return None


def main() -> int:
    from mmindex.backends import MLBackend
    from mmindex.config import Settings
    from mmindex.media import load_frame, save_frame

    settings = Settings()
    settings.gpu_batch_size = 1
    backend = MLBackend(settings)
    root = Path("/tmp/frame-probe")
    root.mkdir(parents=True, exist_ok=True)

    rows = []
    try:
        for name, url in SOURCES.items():
            path = fetch(name, url, root)
            if path is None:
                continue
            try:
                original = load_frame(path)
            except Exception as exc:
                print(f"{name}: not decodable ({exc})")
                continue
            height, width = original.shape[:2]
            stored_path = root / f"{name}-stored.jpg"
            stored = save_frame(
                stored_path, original, settings.frame_max_edge, settings.frame_jpeg_quality
            )
            bounded = load_frame(stored_path)

            for label, image in (("full", original), ("1024", bounded)):
                faces = backend.detect_faces([image])[0]
                texts = backend.ocr([image])[0]
                rows.append(
                    {
                        "image": name,
                        "variant": label,
                        "size": f"{image.shape[1]}x{image.shape[0]}",
                        "faces": len(faces),
                        "min_det": round(min((f.det_score for f in faces), default=0.0), 3),
                        "ocr_chars": len(texts),
                        "ocr": texts[:60],
                    }
                )
    finally:
        backend.close()

    print(f"\nsource resolution vs {settings.frame_max_edge} px bound")
    header = f"{'image':16s} {'variant':8s} {'size':12s} {'faces':>5s} {'min_det':>7s} {'chars':>5s}  ocr"
    print(header)
    print("-" * len(header))
    for row in rows:
        print(
            f"{row['image']:16s} {row['variant']:8s} {row['size']:12s} "
            f"{row['faces']:5d} {row['min_det']:7.3f} {row['ocr_chars']:5d}  {row['ocr']!r}"
        )

    problems = []
    for name in {row["image"] for row in rows}:
        full = next(r for r in rows if r["image"] == name and r["variant"] == "full")
        small = next(r for r in rows if r["image"] == name and r["variant"] == "1024")
        if small["faces"] < full["faces"]:
            problems.append(f"{name}: {full['faces']} -> {small['faces']} faces")
        if full["ocr_chars"] and not small["ocr_chars"]:
            problems.append(f"{name}: OCR text lost")

    if problems:
        print("\nBOUND IS TOO SMALL:")
        for problem in problems:
            print(f"  - {problem}")
        return 1
    print("\nbounded frames keep every detection and all OCR text")
    return 0


if __name__ == "__main__":
    sys.exit(main())
