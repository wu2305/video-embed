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

Measured on `review/2026-10-19` in the same CNB environment (8 vCPU, CPU
`float32`, backend `ml`), against the same corpus: 1,001 images, 15 clips, 80
exact copies, 80 lossy re-encodes, 80 blurred bursts, 1,182 units.

| Metric | Before | After | Δ |
|---|---|---|---|
| Index consistency | ok | **ok** (1,182 rows / 1,182 vectors / 768 dims) | — |
| Exact-duplicate recall | 1.000 (80/80) | **1.000** (80/80) | — |
| Lossy re-encode fold rate | 0.375 (30/80) | **0.438** (35/80) | +5 |
| Motion-blur fold rate | 0.963 (77/80) | **0.963** (77/80) | — |
| Master election accuracy | 0.963 (77/80) | **0.963** (77/80) | — |
| Caption Recall@1 | 0.830 | **0.845** | +0.015 |
| Caption Recall@5 | 0.965 | **0.965** | — |
| Caption Recall@10 | 0.990 | **0.990** | — |
| Caption MRR | 0.892 | **0.903** | +0.011 |
| Person clusters | 28 | **28** | — |
| Cluster purity | 0.991 | **0.990** | -0.001 |
| Persons recovered | 28/28 | **28/28** | — |

Timing, same machine class (this runner was slower than the original run, so
compare the ratio, not the absolute seconds):

| Stage | Before | After |
|---|---|---|
| scan (1,176 canonical, 80 duplicates) | 0.26 s | 0.37 s |
| prepare | 0.78 s | 1.80 s |
| extract | 1.29 s | 3.98 s |
| infer (1,176 files, CPU) | 504.7 s | 1,386.6 s |
| cluster (1,649 faces) | 2.22 s | 3.17 s |
| export | 0.34 s | 0.29 s |

The lossy re-encode fold rate moved 0.375 -> 0.438 (30 -> 35 of 80). This is
**not** attributed to the grouping fix: the old and new `near_duplicates` return
identical masters on 200 Face-Age images with their lossy copies (10 folds
each, zero differing units), and the old banding only missed ~0.5% of pairs at
hamming distance 6 in a direct check. The most likely cause is corpus drift —
the sampler is seeded, but the Flickr30k mirror's contents and ordering are not
pinned — so the two runs may not share the exact same 80 re-encoded images.
Do not read the +5 as a measured improvement.

Inference timing is **not comparable** between these two runs: 1.39 s/file here
versus 0.43 s/file in the original, with no added per-file work beyond encoding
and decoding a bounded JPEG. An intermediate run of the same code measured
1.41 s/file, so the spread looks like runner speed rather than the fixes — but
it was not isolated, so treat the absolute numbers as machine-dependent.
`extract` did get genuinely slower (1.29 -> 3.98 s) because it now JPEG-encodes
each frame; that is still a small fraction of inference.

### Sharpness normalisation (same day, later)

| Metric | Raw variance | Normalised at 256 px |
|---|---|---|
| Lossy re-encode fold rate | 0.4375 (35/80) | **1.000 (80/80)** |
| Motion-blur fold rate | 0.9625 (77/80) | 0.9625 (77/80) |
| Master election accuracy | 0.9625 (77/80) | 0.9625 (77/80) |
| Exact-duplicate recall | 1.000 | **1.000** |
| Caption Recall@1 / MRR | 0.845 / 0.9025 | 0.845 / 0.9023 |
| Cluster purity / persons | 0.9903 / 28 of 28 | 0.9903 / 28 of 28 |

The compressed variants now fold every time, because a half-size copy no longer
scores *higher* than its original and steals master election. Measured in
isolation on 80 LFW faces, raw variance picked the original 0 of 80 times
against a quality-35 copy; at 256 px it picks it 80 of 80, and 80 of 80 against
a Gaussian blur.

The three remaining master-election misses are all motion blur, and they are a
different problem: a 17x17 Gaussian blur at this strength leaves the normalised
Laplacian ordering unchanged for those three pairs, so sharpness — at any scale
— is not the signal that separates them. Fixing those needs a metric that is
actually sensitive to blur, not a rescaling.

Inference took 2,509 s this run against 1,386 s before. The only added work is
one extra grayscale resize per unit; the earlier note that runner speed varies
by ~2-3x between builds still applies, and this was not isolated.

A first attempt at this re-run lost Flickr30k (`datasets` 5.x refuses the
`nlphuji/flickr30k` loading script, and the fallback hid the real error). That
run reported a lossy fold rate of 0.021 — a corpus artifact, since the sampler
had no Flickr images to draw variants from. `fetch_flickr` now logs the first
mirror's error, and the table above is the full-corpus run.

### Still not verified

- **PCA-reduced clustering vs full-dimension / CUDA.** Unchanged: no ARI check
  has been run, and the epsilon is applied unchanged in PCA space.
- **A real shared mount.** Multi-machine tests still simulate machines on one
  disk; NFS and FUSE behaviour is untested.
- **Scale.** Nothing has been run near 77 k files; `_all_units` memory and
  search latency at that size remain unmeasured.
- **Master election's remaining 3 misses.** All are blurred copies outscoring
  their sharp originals. Rescaling did not fix them, so the next attempt needs a
  blur-sensitive metric rather than a sharper Laplacian.
