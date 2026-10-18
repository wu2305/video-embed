"""Compact JSON codec for visual unit records.

Embeddings are the bulk of every record, so numpy arrays are stored as
base64-encoded float16 buffers instead of JSON number lists.  Decoding restores
``float32`` arrays so downstream maths runs at full precision.
"""

from __future__ import annotations

import base64
import json
from typing import Any

import numpy as np

_NDARRAY_KEY = "__ndarray__"


def _encode(obj: Any) -> Any:
    if isinstance(obj, np.ndarray):
        array = np.ascontiguousarray(obj, dtype=np.float16)
        return {
            _NDARRAY_KEY: {
                "dtype": "float16",
                "shape": list(array.shape),
                "data": base64.b64encode(array.tobytes()).decode("ascii"),
            }
        }
    if isinstance(obj, np.generic):
        return obj.item()
    if isinstance(obj, (set, tuple)):
        return list(obj)
    raise TypeError(f"cannot encode {type(obj)!r}")


def _decode_hook(obj: dict) -> Any:
    payload = obj.get(_NDARRAY_KEY)
    if payload is None:
        return obj
    raw = base64.b64decode(payload["data"])
    array = np.frombuffer(raw, dtype=np.dtype(payload["dtype"]))
    return array.reshape(payload["shape"]).astype(np.float32)


def dumps(record: dict) -> bytes:
    return json.dumps(record, default=_encode, separators=(",", ":")).encode("utf-8")


def loads(payload: bytes | str) -> dict:
    if isinstance(payload, bytes):
        payload = payload.decode("utf-8")
    return json.loads(payload, object_hook=_decode_hook)
