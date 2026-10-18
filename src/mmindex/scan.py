"""Stage 0 — scan a media tree into a canonical manifest.

Produces ``manifest.jsonl`` (one record per canonical file) and
``deduplicated.json`` (exact-duplicate groups).  The manifest is the single
source of truth for every later stage and for the distributed work queue.
"""

from __future__ import annotations

import json
import os
import re
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable, Iterator

from .config import Layout, media_kind
from .hashing import fast_digest, sha256_digest

_EXIF_PATTERN = re.compile(
    r"(?P<y>(?:19|20)\d{2})[-_.]?(?P<m>0[1-9]|1[0-2])[-_.]?(?P<d>0[1-9]|[12]\d|3[01])"
    r"(?:[-_.T ]?(?P<H>[01]\d|2[0-3])[-_.:]?(?P<M>[0-5]\d)[-_.:]?(?P<S>[0-5]\d))?"
)
_EPOCH = time.mktime((1970, 1, 1, 0, 0, 0, 0, 0, -1))


@dataclass
class ManifestEntry:
    path: str
    rel_path: str
    kind: str
    size: int
    digest: str
    fast_digest: str
    canonical_time: float
    time_source: str
    mtime: float
    is_canonical: bool = True
    duplicate_of: str | None = None

    def to_dict(self) -> dict:
        return {
            "path": self.path,
            "rel_path": self.rel_path,
            "kind": self.kind,
            "size": self.size,
            "digest": self.digest,
            "fast_digest": self.fast_digest,
            "canonical_time": self.canonical_time,
            "time_source": self.time_source,
            "mtime": self.mtime,
            "is_canonical": self.is_canonical,
            "duplicate_of": self.duplicate_of,
        }

    @classmethod
    def from_dict(cls, data: dict) -> "ManifestEntry":
        known = {f for f in cls.__dataclass_fields__}
        return cls(**{k: v for k, v in data.items() if k in known})


def _exif_datetime(path: Path) -> float | None:
    try:
        from PIL import Image
    except ImportError:  # pragma: no cover - pillow is a hard dependency
        return None
    try:
        with Image.open(path) as image:
            exif = image.getexif()
            if not exif:
                return None
            raw = exif.get(36867) or exif.get(306)
    except Exception:
        return None
    if not raw:
        return None
    text = str(raw).strip()
    match = _EXIF_PATTERN.search(text)
    if not match:
        return None
    return _parts_to_epoch(match)


def _parts_to_epoch(match: re.Match) -> float | None:
    groups = match.groupdict()
    try:
        parts = (
            int(groups["y"]),
            int(groups["m"]),
            int(groups["d"]),
            int(groups.get("H") or 0),
            int(groups.get("M") or 0),
            int(groups.get("S") or 0),
            0,
            0,
            -1,
        )
        return time.mktime(parts)
    except (TypeError, ValueError, OverflowError):
        return None


def canonical_time(path: Path) -> tuple[float, str]:
    """EXIF DateTimeOriginal, then a filename date regex, then mtime."""
    exif = _exif_datetime(path)
    if exif is not None:
        return exif, "exif"
    match = _EXIF_PATTERN.search(path.stem)
    if match:
        parsed = _parts_to_epoch(match)
        if parsed is not None:
            return parsed, "filename"
    try:
        return path.stat().st_mtime, "mtime"
    except OSError:
        return _EPOCH, "mtime"


def iter_media(root: str | Path, exclude: Iterable[str] = ()) -> Iterator[Path]:
    """Yield supported media files beneath ``root`` in deterministic order."""
    root = Path(root)
    excluded = {Path(e).resolve() for e in exclude}
    for dirpath, dirnames, filenames in os.walk(root):
        dirnames[:] = sorted(d for d in dirnames if not d.startswith("."))
        if Path(dirpath).resolve() in excluded:
            dirnames[:] = []
            continue
        for name in sorted(filenames):
            if name.startswith("."):
                continue
            path = Path(dirpath) / name
            if media_kind(path):
                yield path


@dataclass
class ScanResult:
    canonical: list[ManifestEntry] = field(default_factory=list)
    duplicates: dict[str, list[str]] = field(default_factory=dict)
    skipped: list[dict] = field(default_factory=list)

    @property
    def total_files(self) -> int:
        return len(self.canonical) + sum(len(v) - 1 for v in self.duplicates.values())


def scan(
    root: str | Path,
    layout: Layout,
    *,
    exclude: Iterable[str] = (),
    progress: object | None = None,
) -> ScanResult:
    """Walk ``root``, hash every file and write the manifest + dedup report."""
    root = Path(root)
    layout.ensure()
    result = ScanResult()

    fast_groups: dict[str, list[Path]] = {}
    total = 0
    for path in iter_media(root, exclude):
        total += 1
        try:
            fast = fast_digest(path)
        except OSError as exc:
            result.skipped.append({"path": str(path), "error": str(exc)})
            continue
        fast_groups.setdefault(fast, []).append(path)
        if progress is not None and hasattr(progress, "update"):
            progress.update(1)

    by_digest: dict[str, ManifestEntry] = {}
    for _fast, paths in sorted(fast_groups.items()):
        if len(paths) == 1:
            path = paths[0]
            entry = _entry(root, path, sha256_digest(path))
            by_digest[entry.digest] = entry
            result.canonical.append(entry)
            continue
        # Fast-hash collision: confirm byte equality with SHA256.
        for path in sorted(paths):
            try:
                digest = sha256_digest(path)
            except OSError as exc:
                result.skipped.append({"path": str(path), "error": str(exc)})
                continue
            existing = by_digest.get(digest)
            if existing is None:
                entry = _entry(root, path, digest)
                by_digest[digest] = entry
                result.canonical.append(entry)
            else:
                dup = _entry(root, path, digest)
                dup.is_canonical = False
                dup.duplicate_of = existing.path
                result.duplicates.setdefault(existing.path, [existing.path]).append(dup.path)

    result.canonical.sort(key=lambda e: e.rel_path)
    _write_manifest(layout, result)
    return result


def _entry(root: Path, path: Path, digest: str) -> ManifestEntry:
    stat = path.stat()
    stamp, source = canonical_time(path)
    return ManifestEntry(
        path=str(path),
        rel_path=str(path.relative_to(root)),
        kind=media_kind(path) or "unknown",
        size=stat.st_size,
        digest=digest,
        fast_digest=fast_digest(path),
        canonical_time=stamp,
        time_source=source,
        mtime=stat.st_mtime,
    )


def _write_manifest(layout: Layout, result: ScanResult) -> None:
    tmp = layout.manifest.with_suffix(".jsonl.tmp")
    with tmp.open("w", encoding="utf-8") as handle:
        for entry in result.canonical:
            handle.write(json.dumps(entry.to_dict(), ensure_ascii=False))
            handle.write("\n")
    os.replace(tmp, layout.manifest)

    dup_tmp = layout.deduplicated.with_suffix(".json.tmp")
    payload = {
        "generated_at": time.time(),
        "canonical_count": len(result.canonical),
        "duplicate_count": sum(len(v) - 1 for v in result.duplicates.values()),
        "groups": result.duplicates,
        "skipped": result.skipped,
    }
    with dup_tmp.open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, indent=2, ensure_ascii=False)
    os.replace(dup_tmp, layout.deduplicated)


def read_manifest(layout: Layout) -> list[ManifestEntry]:
    if not layout.manifest.exists():
        return []
    entries: list[ManifestEntry] = []
    with layout.manifest.open("r", encoding="utf-8") as handle:
        for line in handle:
            line = line.strip()
            if line:
                entries.append(ManifestEntry.from_dict(json.loads(line)))
    return entries
