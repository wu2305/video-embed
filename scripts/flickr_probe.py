#!/usr/bin/env python3
"""Which Flickr30k source still loads under the installed `datasets`?"""

from __future__ import annotations

import traceback


def try_load(name: str, split: str) -> None:
    from datasets import load_dataset

    try:
        ds = load_dataset(name, split=split)
    except Exception:
        print(f"FAIL {name}")
        print(traceback.format_exc()[-1200:])
        return
    item = ds[0]
    print(f"OK {name} rows={len(ds)} keys={sorted(item.keys())}")
    image = item.get("image")
    print(f"   image={type(image).__name__} size={getattr(image, 'size', None)}")
    caption = item.get("caption") or item.get("sentences") or item.get("captions")
    print(f"   caption={str(caption)[:120]!r}")


def main() -> int:
    import datasets

    print(f"datasets {datasets.__version__}")
    try_load("lmms-lab-encoder/flickr30k", "test[:5]")
    try_load("nlphuji/flickr30k", "test[:5]")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
