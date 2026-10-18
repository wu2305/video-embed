"""Content hashing used for exact and fast deduplication (section 2)."""

from __future__ import annotations

import hashlib
from pathlib import Path

import xxhash

SLICE_BYTES = 16 * 1024
_CHUNK = 1024 * 1024


def fast_digest(path: str | Path) -> str:
    """xxhash64 over file size plus head, middle and tail 16 KiB slices.

    Cheap enough to run over an entire library; collisions are resolved by
    :func:`sha256_digest` before two files are treated as duplicates.
    """
    path = Path(path)
    size = path.stat().st_size
    hasher = xxhash.xxh64()
    hasher.update(str(size).encode())
    if size == 0:
        return hasher.hexdigest()
    with path.open("rb") as handle:
        offsets = {0, max(0, size // 2 - SLICE_BYTES // 2), max(0, size - SLICE_BYTES)}
        for offset in sorted(offsets):
            handle.seek(offset)
            hasher.update(handle.read(SLICE_BYTES))
    return hasher.hexdigest()


def sha256_digest(path: str | Path) -> str:
    """Streaming SHA256 of the full file."""
    digest = hashlib.sha256()
    with Path(path).open("rb") as handle:
        for chunk in iter(lambda: handle.read(_CHUNK), b""):
            digest.update(chunk)
    return digest.hexdigest()


def digest_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def shard_for(key: str, n_shards: int) -> int:
    """Deterministic shard index, stable across machines and restarts."""
    if n_shards <= 0:
        raise ValueError("n_shards must be positive")
    return xxhash.xxh64(key.encode()).intdigest() % n_shards
