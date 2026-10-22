from __future__ import annotations

from mmindex.hashing import digests, fast_digest, sha256_digest, shard_for


def test_sha256_matches_hashlib(tmp_path):
    import hashlib

    path = tmp_path / "a.bin"
    path.write_bytes(b"hello world")
    assert sha256_digest(path) == hashlib.sha256(b"hello world").hexdigest()


def test_fast_digest_is_stable_and_content_sensitive(tmp_path):
    a = tmp_path / "a.bin"
    b = tmp_path / "b.bin"
    a.write_bytes(b"x" * 100_000)
    b.write_bytes(b"x" * 100_000 + b"y")
    assert fast_digest(a) == fast_digest(a)
    assert fast_digest(a) != fast_digest(b)


def test_fast_digest_handles_empty_file(tmp_path):
    path = tmp_path / "empty.bin"
    path.write_bytes(b"")
    assert len(fast_digest(path)) == 16


def test_shard_for_is_deterministic():
    assert shard_for("some/path.jpg", 8) == shard_for("some/path.jpg", 8)
    assert 0 <= shard_for("some/path.jpg", 8) < 8
    spread = {shard_for(f"file-{i}", 8) for i in range(200)}
    assert len(spread) == 8


def test_combined_digests_match_the_standalone_hashes(tmp_path):
    """The single-read helper must reproduce both hashes byte for byte, or the
    manifest's fast digest would drift from ``fast_digest``."""
    for size in (0, 1, 100, 16 * 1024, 16 * 1024 + 1, 3 * 1024 * 1024 + 7):
        path = tmp_path / f"f{size}.bin"
        path.write_bytes(bytes(range(256)) * (size // 256) + b"z" * (size % 256))
        sha, fast = digests(path)
        assert sha == sha256_digest(path)
        assert fast == fast_digest(path)
