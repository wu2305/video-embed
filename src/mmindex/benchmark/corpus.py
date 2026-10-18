"""Fetch the benchmark corpus the reference Colab notebook used.

The notebook's cell 1.5 builds ``Historical_Media_Benchmark`` from four public
datasets and then injects three kinds of realistic redundancy:

``01_LFW_People_Archive``
    LFW faces laid out as ``<year>_<person>/LFW_<year>0512_<idx>.jpg``.
``02_Cross_Age_Faces``
    Face-Age-10K grouped into ``AgeGroup_<label>`` folders.
``03_Flickr30k_Daily_Albums``
    Flickr30k images bucketed into dated album folders, plus
    ``flickr30k_groundtruth_captions.json``.
``04_MSRVTT_Videos``
    MSR-VTT clips.
``99_Cross_Folder_Exact_Backups``
    Byte-identical copies of sampled images.
``ground_truth_dedup_benchmark.json``
    Master/duplicate pairs for the exact, compressed and blurred variants.

This module reproduces that layout so the index built here can be scored
against the same ground truth the notebook generates. It is deliberately
size-parameterised: the production run used every file, while a verification
run on a CPU dev environment needs a representative subset.
"""

from __future__ import annotations

import hashlib
import json
import random
import shutil
from dataclasses import dataclass, field
from pathlib import Path

import numpy as np

MONTHS = (
    "2019-04_Spring_Outing",
    "2020-08_Summer_Camp",
    "2021-10_Autumn_Gathering",
    "2023-01_Winter_Annual_Meet",
)
YEARS = ("2016", "2018", "2020", "2022", "2024")


@dataclass
class CorpusSpec:
    """How much of each dataset to materialise."""

    lfw_min_faces_per_person: int = 0
    lfw_limit: int | None = None
    # HDBSCAN needs min_cluster_size photos of the same person to form a
    # cluster, so each sampled identity must contribute at least this many.
    lfw_min_per_identity: int = 5
    cross_age_limit: int | None = 400
    flickr_limit: int | None = 400
    msrvtt_limit: int | None = 20
    duplicate_ratio: float = 0.08
    seed: int = 42
    enable_lfw: bool = True
    enable_cross_age: bool = True
    enable_flickr: bool = True
    enable_msrvtt: bool = True

    @property
    def image_budget(self) -> int:
        return (
            (self.lfw_limit or 0)
            + (self.cross_age_limit or 0)
            + (self.flickr_limit or 0)
        )


@dataclass
class CorpusReport:
    root: str
    counts: dict = field(default_factory=dict)
    ground_truth: dict = field(default_factory=dict)
    captions: str | None = None
    skipped: list = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "root": self.root,
            "counts": self.counts,
            "ground_truth": {
                "exact_duplicates": len(self.ground_truth.get("exact_duplicates", [])),
                "compressed_variants": len(self.ground_truth.get("compressed_variants", [])),
                "blurry_bursts": len(self.ground_truth.get("blurry_bursts", [])),
            },
            "captions": self.captions,
            "skipped": self.skipped,
        }


# --------------------------------------------------------------------- LFW


def fetch_lfw(root: Path, spec: CorpusSpec, log=print) -> list[Path]:
    """Write LFW faces as ``<year>_<person>/LFW_<year>0512_<idx>.jpg``.

    LFW is ordered by identity. Sampling individual images across the whole set
    would leave about one photo per person, which makes HDBSCAN clustering
    meaningless (``min_cluster_size`` can never be satisfied). Instead pick
    whole identity blocks spread across the set, so each sampled person
    contributes several photos — the property cluster purity is meant to test.
    """
    from sklearn.datasets import fetch_lfw_people

    target = root / "01_LFW_People_Archive"
    target.mkdir(parents=True, exist_ok=True)
    log(f"LFW: downloading (min_faces_per_person={spec.lfw_min_faces_per_person})")
    dataset = fetch_lfw_people(
        min_faces_per_person=spec.lfw_min_faces_per_person, color=True, resize=1.0
    )
    names = dataset.target_names
    targets = dataset.target
    total = len(targets)

    by_identity: dict[int, list[int]] = {}
    for index in range(total):
        by_identity.setdefault(int(targets[index]), []).append(index)
    identities = sorted(by_identity)

    # Only identities with enough photos can form an HDBSCAN cluster. LFW's
    # default average is ~2.3 photos per person, so sampling identities without
    # this filter yields a corpus where clustering can never find a person.
    eligible = [i for i in identities if len(by_identity[i]) >= spec.lfw_min_per_identity]
    if not eligible:
        eligible = identities

    if spec.lfw_limit is None or spec.lfw_limit >= total:
        chosen_identities = eligible
        per_identity = None
    else:
        average = sum(len(by_identity[i]) for i in eligible) / max(1, len(eligible))
        keep = max(1, int(spec.lfw_limit / max(average, spec.lfw_min_per_identity)))
        keep = min(keep, len(eligible))
        stride = len(eligible) / keep
        chosen_identities = [
            eligible[min(len(eligible) - 1, int(i * stride))] for i in range(keep)
        ]
        chosen_identities = sorted(set(chosen_identities))
        per_identity = max(
            spec.lfw_min_per_identity, spec.lfw_limit // max(1, len(chosen_identities))
        )

    from PIL import Image

    saved: list[Path] = []
    for identity in chosen_identities:
        indices = by_identity[identity]
        if per_identity is not None and len(indices) > per_identity:
            indices = indices[:per_identity]
        person = names[identity].replace(" ", "_")
        year = YEARS[len(saved) % len(YEARS)]
        folder = target / f"{year}_{person}"
        folder.mkdir(parents=True, exist_ok=True)
        for index in indices:
            image = dataset.images[index]
            array = (
                (image * 255).astype(np.uint8) if image.max() <= 1.0 else image.astype(np.uint8)
            )
            out = folder / f"LFW_{year}0512_{index:05d}.jpg"
            Image.fromarray(array).save(out, "JPEG", quality=95)
            saved.append(out)
    log(
        f"LFW: {len(saved)} faces across {len({p.parent.name for p in saved})} identities "
        f"({len(saved) / max(1, len({p.parent.name for p in saved})):.1f} per identity)"
    )
    return saved


# --------------------------------------------------------------- Face-Age


def fetch_cross_age(root: Path, spec: CorpusSpec, log=print) -> list[Path]:
    from datasets import load_dataset

    target = root / "02_Cross_Age_Faces"
    target.mkdir(parents=True, exist_ok=True)
    log(f"Face-Age-10K: downloading (limit={spec.cross_age_limit})")
    split = f"train[:{spec.cross_age_limit}]" if spec.cross_age_limit else "train"
    dataset = load_dataset("prithivMLmods/Face-Age-10K", split=split)
    saved: list[Path] = []
    for index, item in enumerate(dataset):
        image = item.get("image")
        if image is None:
            continue
        if image.mode != "RGB":
            image = image.convert("RGB")
        label = item.get("label", "unknown_age")
        folder = target / f"AgeGroup_{label}"
        folder.mkdir(parents=True, exist_ok=True)
        out = folder / f"AGE_{index:05d}.jpg"
        image.save(out, "JPEG", quality=92)
        saved.append(out)
    log(f"Face-Age-10K: {len(saved)} faces")
    return saved


# --------------------------------------------------------------- Flickr30k


def fetch_flickr(root: Path, spec: CorpusSpec, log=print) -> tuple[list[Path], Path | None]:
    from datasets import load_dataset

    target = root / "03_Flickr30k_Daily_Albums"
    target.mkdir(parents=True, exist_ok=True)
    log(f"Flickr30k: downloading (limit={spec.flickr_limit})")
    split = f"test[:{spec.flickr_limit}]" if spec.flickr_limit else "test"
    try:
        dataset = load_dataset("lmms-lab-encoder/flickr30k", split=split)
    except Exception:
        dataset = load_dataset("nlphuji/flickr30k", split=split)

    captions: dict[str, list[str]] = {}
    saved: list[Path] = []
    for index, item in enumerate(dataset):
        image = item.get("image")
        if image is None:
            continue
        if image.mode != "RGB":
            image = image.convert("RGB")
        folder = target / MONTHS[index % len(MONTHS)]
        folder.mkdir(parents=True, exist_ok=True)
        out = folder / f"ALBUM_{index:05d}.jpg"
        image.save(out, "JPEG", quality=92)
        saved.append(out)
        raw = item.get("caption") or item.get("sentences") or []
        captions[str(out.relative_to(root))] = raw if isinstance(raw, list) else [str(raw)]

    gt_path = root / "flickr30k_groundtruth_captions.json"
    gt_path.write_text(json.dumps(captions, ensure_ascii=False, indent=2), encoding="utf-8")
    log(f"Flickr30k: {len(saved)} images, captions -> {gt_path.name}")
    return saved, gt_path


# ---------------------------------------------------------------- MSR-VTT


def fetch_msrvtt(root: Path, spec: CorpusSpec, log=print) -> list[Path]:
    """Copy up to ``msrvtt_limit`` clips out of the MSR-VTT snapshot.

    The repository only ships videos inside ``MSRVTT_Videos.zip`` (about 2.2 GB),
    so members are streamed out of the archive rather than extracted wholesale.
    """
    from huggingface_hub import snapshot_download

    target = root / "04_MSRVTT_Videos"
    target.mkdir(parents=True, exist_ok=True)
    limit = spec.msrvtt_limit
    if limit == 0:
        log("MSR-VTT: disabled")
        return []

    log(f"MSR-VTT: resolving snapshot (limit={limit})")
    try:
        snapshot = Path(
            snapshot_download(
                repo_id="friedrichor/MSR-VTT",
                repo_type="dataset",
                allow_patterns=["*.mp4", "*.zip", "*.tar.gz", "*.tgz"],
            )
        )
    except Exception as exc:
        log(f"MSR-VTT: download failed ({type(exc).__name__}: {exc}); continuing without videos")
        return []

    saved: list[Path] = []

    def copy_out(stream, name: str) -> bool:
        out = target / Path(name).name
        tmp = out.with_name(out.name + ".part")
        try:
            with tmp.open("wb") as handle:
                shutil.copyfileobj(stream, handle)
            tmp.replace(out)
        finally:
            tmp.unlink(missing_ok=True)
        saved.append(out)
        return limit is not None and len(saved) >= limit

    for source in sorted(snapshot.rglob("*.mp4")):
        if limit is not None and len(saved) >= limit:
            break
        shutil.copyfile(source, target / source.name)
        saved.append(target / source.name)

    import zipfile

    for archive in sorted(snapshot.rglob("*.zip")):
        if limit is not None and len(saved) >= limit:
            break
        log(f"MSR-VTT: streaming members from {archive.name}")
        with zipfile.ZipFile(archive) as zf:
            members = sorted(
                (m for m in zf.infolist() if m.filename.lower().endswith(".mp4")),
                key=lambda m: m.filename,
            )
            for member in members:
                if limit is not None and len(saved) >= limit:
                    break
                with zf.open(member) as stream:
                    copy_out(stream, member.filename)

    log(f"MSR-VTT: {len(saved)} clips")
    return saved


# ----------------------------------------------------- injected redundancy


def inject_redundancy(
    images: list[Path], root: Path, ratio: float, seed: int, log=print
) -> dict:
    """Add exact copies, lossy re-encodes and motion-blurred bursts.

    Mirrors the notebook: exact copies land in ``99_Cross_Folder_Exact_Backups``,
    compressed variants sit beside their master as ``WECHAT_COMP_*``, and
    blurred bursts as ``*_burst_motion_blur.jpg``.
    """
    if not images:
        return {"exact_duplicates": [], "compressed_variants": [], "blurry_bursts": []}

    from PIL import Image

    rng = random.Random(seed)
    sample_count = max(1, int(len(images) * ratio))
    chosen = rng.sample(images, min(sample_count * 3, len(images)))
    exact = chosen[:sample_count]
    compressed = chosen[sample_count : sample_count * 2]
    blurs = chosen[sample_count * 2 : sample_count * 3]

    backup_dir = root / "99_Cross_Folder_Exact_Backups"
    backup_dir.mkdir(parents=True, exist_ok=True)
    gt = {"exact_duplicates": [], "compressed_variants": [], "blurry_bursts": []}

    for path in exact:
        key = hashlib.sha256(str(path.relative_to(root)).encode()).hexdigest()[:10]
        dst = backup_dir / f"BACKUP_COPY_{key}_{path.name}"
        shutil.copy2(path, dst)
        gt["exact_duplicates"].append(
            {
                "master": str(path.relative_to(root)),
                "duplicate": str(dst.relative_to(root)),
            }
        )

    for path in compressed:
        with Image.open(path) as image:
            width, height = image.size
            dst = path.parent / f"WECHAT_COMP_{path.stem}.jpg"
            image.resize((max(64, width // 2), max(64, height // 2))).save(
                dst, "JPEG", quality=35
            )
        gt["compressed_variants"].append(
            {
                "master": str(path.relative_to(root)),
                "compressed": str(dst.relative_to(root)),
            }
        )

    try:
        import cv2

        for path in blurs:
            bgr = cv2.imread(str(path))
            if bgr is None:
                continue
            dst = path.parent / f"{path.stem}_burst_motion_blur.jpg"
            cv2.imwrite(str(dst), cv2.GaussianBlur(bgr, (17, 17), 6))
            gt["blurry_bursts"].append(
                {
                    "sharp_cover": str(path.relative_to(root)),
                    "blurry_frame": str(dst.relative_to(root)),
                }
            )
    except ImportError:
        log("motion blur skipped: OpenCV not installed")

    (root / "ground_truth_dedup_benchmark.json").write_text(
        json.dumps(gt, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    log(
        f"injected: {len(gt['exact_duplicates'])} exact, "
        f"{len(gt['compressed_variants'])} compressed, "
        f"{len(gt['blurry_bursts'])} blurred"
    )
    return gt


# ------------------------------------------------------------------ driver


def build_corpus(root: str | Path, spec: CorpusSpec | None = None, log=print) -> CorpusReport:
    """Materialise the benchmark corpus at ``root``."""
    spec = spec or CorpusSpec()
    root = Path(root)
    root.mkdir(parents=True, exist_ok=True)
    report = CorpusReport(root=str(root))
    images: list[Path] = []

    if spec.enable_lfw:
        images.extend(_guard(report, "lfw", lambda: fetch_lfw(root, spec, log), log))
    if spec.enable_cross_age:
        images.extend(_guard(report, "cross_age", lambda: fetch_cross_age(root, spec, log), log))
    if spec.enable_flickr:
        flickr, captions = _guard(
            report, "flickr", lambda: fetch_flickr(root, spec, log), log, default=([], None)
        )
        images.extend(flickr)
        report.captions = str(captions) if captions else None
    if spec.enable_msrvtt:
        _guard(report, "msrvtt", lambda: fetch_msrvtt(root, spec, log), log, default=[])

    report.ground_truth = inject_redundancy(
        images, root, spec.duplicate_ratio, spec.seed, log
    )
    report.counts = {
        "images": len(images),
        "exact_duplicates": len(report.ground_truth["exact_duplicates"]),
        "compressed_variants": len(report.ground_truth["compressed_variants"]),
        "blurry_bursts": len(report.ground_truth["blurry_bursts"]),
        "videos": len(list((root / "04_MSRVTT_Videos").rglob("*.mp4")))
        if (root / "04_MSRVTT_Videos").exists()
        else 0,
    }
    (root / "corpus_report.json").write_text(
        json.dumps(report.to_dict(), indent=2), encoding="utf-8"
    )
    return report


def _guard(report: CorpusReport, name: str, fn, log, default=None):
    try:
        return fn()
    except Exception as exc:
        log(f"{name}: failed ({type(exc).__name__}: {exc})")
        report.skipped.append({"dataset": name, "error": f"{type(exc).__name__}: {exc}"})
        return default if default is not None else []
