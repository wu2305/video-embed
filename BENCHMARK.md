# Benchmark results — reference corpus on CPU

Run in the CNB cloud dev environment (8 vCPU, no GPU) against the corpus the
reference Colab notebook builds, at a subset size a CPU machine can index.

## Environment

| | |
|---|---|
| Platform | Linux x86_64, 8 vCPU |
| Device | CPU, `float32` |
| Backend | `ml` (real SigLIP / InsightFace / RapidOCR / faster-whisper) |
| Python | 3.12.15 |

## Corpus

| Dataset | Count |
|---|---|
| LFW faces | 201 across 28 identities (7.2 per identity) |
| Face-Age-10K faces | 400 |
| Flickr30k images | 400 |
| MSR-VTT clips | 15 |
| Injected exact copies | 80 |
| Injected lossy re-encodes | 80 |
| Injected motion-blurred bursts | 80 |
| **Indexed units** | **1,182** |

## Results

| Metric | Value |
|---|---|
| Index consistency (`verify`) | ok — 1,182 rows, 1,182 vectors, 768 dims |
| Exact-duplicate recall | **1.000** (80/80) |
| Lossy re-encode fold rate | 0.375 (30/80) |
| Motion-blur fold rate | **0.963** (77/80) |
| Master election accuracy | **0.963** (77/80) |
| Caption Recall@1 | **0.830** |
| Caption Recall@5 | **0.965** |
| Caption Recall@10 | **0.990** |
| Caption MRR | **0.892** |
| Person clusters found | 28 |
| Cluster purity | **0.991** |
| Persons recovered | 28 / 28 |

## Timing

| Stage | Time |
|---|---|
| scan (1,176 canonical, 80 duplicates) | 0.26 s |
| prepare | 0.78 s |
| extract | 1.29 s |
| infer (1,176 files, CPU) | 504.7 s |
| cluster (1,286 faces) | 2.22 s |
| export | 0.34 s |

Inference dominates at roughly 0.43 s per file on 8 CPU cores, which is the
expected cost of SigLIP + InsightFace + RapidOCR per unit without a GPU.

## Reproducing

```bash
python scripts/benchmark.py          # same subset as above
python scripts/benchmark.py --full   # every image each dataset yields
```

The report is written to `/opt/benchmark_report.json` and copied to the repo
root as `benchmark_report.json`.

## Notes on the remaining gaps

- **Lossy re-encode fold rate is 0.375.** A half-resolution JPEG at quality 35
  is a large perceptual change, so a dhash threshold of 6 bits does not group
  all of them. Motion blur is far more predictable (0.963) because blur
  preserves the low-frequency structure dhash encodes.
- **Master election is 0.963, not 1.0.** Three blurred frames scored *higher*
  Laplacian variance than their originals. Blur reduces variance in general,
  but a heavily downscaled source can end up with lower variance than a blurred
  copy, so sharpness alone cannot always rank them.
- **Noise fraction is 0.82.** Only LFW contributes repeat identities; the
  Flickr30k and Face-Age samples are single photos of distinct people, so
  HDBSCAN correctly leaves them as noise rather than inventing clusters.

## Re-run after the 2026-10-19 fixes

The numbers above were measured before the review fixes. Re-running on the
`review/2026-10-19` branch in the same CNB environment gives the results below.
Read them as a check that the fixes did not regress the pipeline, not as a new
baseline: the corpus is **not the same one**, because `datasets` 5.x refuses the
`nlphuji/flickr30k` loading script, so that run lost all 400 Flickr30k images
and every count derived from them.

| Metric | Before | After | Note |
|---|---|---|---|
| Indexed units | 1,182 | 718 | Flickr30k absent |
| Exact-duplicate recall | 1.000 | **1.000** | unchanged |
| Motion-blur fold rate | 0.963 (77/80) | 0.917 (44/48) | same failure mode, smaller sample |
| Master election accuracy | 0.963 (77/80) | 0.917 (44/48) | 4 wrong, all blurred copies |
| Caption Recall@1/5/10 | .830/.965/.990 | *not measured* | captions come from Flickr30k |
| Person clusters / purity | 28 / 0.991 | 31 / **1.000** | 224 labelled faces |
| Persons recovered | 28/28 | **28/28** | unchanged |
| Lossy re-encode fold rate | 0.375 | 0.021 | **corpus artifact, see below** |
| Index consistency | ok | **ok** | 718 rows / 718 vectors / 768 dims |

The 0.021 lossy-encode figure is not a regression. Two checks say so:

1. The same six images, run through the old and new `near_duplicates` on
   identical inputs, fold identically (2/6 both ways).
2. On 60 Face-Age images the old and new implementations both fold 2/60.

What changed is which images the variants were drawn from: with Flickr gone the
sampler picked far fewer photographs whose half-resolution copy stays within 6
dhash bits. The 0.375 figure stands until a run has the full corpus again.

Frame storage (finding 10) does not move the dedup numbers: on six reference
photos, dhash distance between an original and its stored 1024 px JPEG is 0-1
bits, and on 120 LFW faces the compressed copies still fold 118/120 (raw:
120/120). `scripts/frame_bound_check.py` checks the bound against the models
themselves: on 3000 px photos the 1024 px copy keeps the same face at the same
detection score (0.910 -> 0.911) and loses no OCR text.

### Still not verified

- **`scripts/benchmark.py` against a full corpus.** Flickr30k needs a
  `datasets` version that still runs loading scripts, or a mirror that ships
  Parquet. Until then the caption metrics cannot be re-measured.
- **PCA-reduced clustering vs full-dimension / CUDA.** Unchanged: no ARI check
  has been run, and the epsilon is applied unchanged in PCA space.
- **A real shared mount.** Multi-machine tests still simulate machines on one
  disk; NFS and FUSE behaviour is untested.
- **Scale.** Nothing has been run near 77 k files; `_all_units` memory and
  search latency at that size remain unmeasured.
