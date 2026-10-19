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


def digests(path: str | Path) -> tuple[str, str]:
    """``(sha256, fast_digest)`` from a single read of the file.

    ``scan`` needs both hashes for every file: SHA256 is the content identity
    used for dedup and as the checkpoint key, the xxhash is the cheap candidate
    hash. Reading the file once for both halves the I/O of the previous two
    separate passes (and removes a third pass that re-hashed for the manifest).
    """
    path = Path(path)
    size = path.stat().st_size
    sha = hashlib.sha256()
    fast = xxhash.xxh64()
    fast.update(str(size).encode())
    # The same three slices ``fast_digest`` hashes: head, middle and tail, each
    # clipped to the file, deduplicated (small files collapse them onto 0) and
    # hashed in ascending order.
    windows = sorted(
        {
            (offset, min(offset + SLICE_BYTES, size))
            for offset in (0, max(0, size // 2 - SLICE_BYTES // 2), max(0, size - SLICE_BYTES))
            if size
        }
    )
    if not windows:
        return sha.hexdigest(), fast.hexdigest()
    base = 0
    with path.open("rb") as handle:
        while True:
            chunk = handle.read(_CHUNK)
            if not chunk:
                break
            sha.update(chunk)
            end = base + len(chunk)
            for start, stop in windows:
                left, right = max(start, base), min(stop, end)
                if left < right:
                    fast.update(chunk[left - base : right - base])
            base = end
    return sha.hexdigest(), fast.hexdigest()


def digest_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def shard_for(key: str, n_shards: int) -> int:
    """Deterministic shard index, stable across machines and restarts."""
    if n_shards <= 0:
        raise ValueError("n_shards must be positive")
    return xxhash.xxh64(key.encode()).intdigest() % n_shards
