from __future__ import annotations

import json

from mmindex.scan import canonical_time, read_manifest, scan


def test_scan_deduplicates_exact_copies(media_tree, layout):
    result = scan(media_tree, layout)
    assert len(result.canonical) == 3
    assert sum(len(v) - 1 for v in result.duplicates.values()) == 1
    assert result.skipped == []


def test_scan_writes_manifest_and_dedup_report(media_tree, layout):
    scan(media_tree, layout)
    entries = read_manifest(layout)
    assert len(entries) == 3
    assert all(entry.kind == "image" for entry in entries)
    assert all(entry.digest for entry in entries)

    payload = json.loads(layout.deduplicated.read_text())
    assert payload["canonical_count"] == 3
    assert payload["duplicate_count"] == 1


def test_scan_is_deterministic(media_tree, layout):
    scan(media_tree, layout)
    first = [entry.rel_path for entry in read_manifest(layout)]
    scan(media_tree, layout)
    second = [entry.rel_path for entry in read_manifest(layout)]
    assert first == second == sorted(first)


def test_scan_excludes_directory(media_tree, layout):
    skip = media_tree / "nested"
    skip.mkdir()
    (skip / "ignored.png").write_bytes((media_tree / "shot_0.png").read_bytes())
    result = scan(media_tree, layout, exclude=[str(skip)])
    assert all("nested" not in entry.path for entry in result.canonical)


def test_canonical_time_prefers_filename_date(media_tree):
    path = media_tree / "IMG_20240115_103000.png"
    path.write_bytes((media_tree / "shot_0.png").read_bytes())
    stamp, source = canonical_time(path)
    assert source == "filename"
    assert stamp > 0


def test_canonical_time_falls_back_to_mtime(tmp_path):
    path = tmp_path / "plain.png"
    path.write_bytes(b"data")
    _stamp, source = canonical_time(path)
    assert source == "mtime"


def test_scan_skips_an_unreadable_file_instead_of_aborting(media_tree, layout):
    """Regression: only the collision branch caught OSError, so one unreadable
    unique file aborted the whole scan."""
    import importlib

    from mmindex.hashing import digests

    unreadable = media_tree / "locked.png"
    unreadable.write_bytes(b"x")

    def boom(path):
        if str(path).endswith("locked.png"):
            raise PermissionError(13, "Permission denied", str(path))
        return digests(path)

    # ``mmindex.scan`` is the function re-exported by the package, so the module
    # has to be fetched through importlib.
    scan_module = importlib.import_module("mmindex.scan")

    original = scan_module.digests
    scan_module.digests = boom
    try:
        result = scan(media_tree, layout)
    finally:
        scan_module.digests = original

    assert len(result.canonical) == 3
    assert [s["path"].rsplit("/", 1)[-1] for s in result.skipped] == ["locked.png"]


def test_scan_reads_each_file_once(media_tree, layout):
    """Regression: the fast digest was computed twice and SHA256 ran on every
    file, so the xxhash pre-filter saved nothing."""
    import importlib

    calls: list[str] = []
    scan_module = importlib.import_module("mmindex.scan")
    original = scan_module.digests

    def counting(path):
        calls.append(str(path))
        return original(path)

    scan_module.digests = counting
    try:
        scan(media_tree, layout)
    finally:
        scan_module.digests = original
    assert len(calls) == len(set(calls)) == 4
