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
