# mmindex — Multimodal Media Indexer

A CPU-first implementation of the multimodal media indexing pipeline described in
[`ARCHITECTURE.md`](./ARCHITECTURE.md). It walks a tree of images and videos,
produces one searchable *visual unit* per image and per video scene, embeds each
unit with SigLIP, detects and embeds faces with InsightFace, reads on-frame text
with RapidOCR, transcribes speech with faster-whisper, clusters faces into
persons, and publishes a consistent SQLite + FP16 vector index that supports
hybrid semantic/text search.

The package is the "local CPU port" from section 3 plus the distributed spot
architecture from section 4 of the architecture document.

## Install

```bash
# core (scan, checkpoint, export, search over pre-computed embeddings)
pip install -e .

# full CPU inference stack (SigLIP, InsightFace, RapidOCR, Whisper, OpenCV)
pip install -e '.[ml]'

# clustering (HDBSCAN + KMeans prototypes)
pip install -e '.[cluster]'

# everything
pip install -e '.[ml,cluster,dev]'
```

The ML stack is optional on purpose: scan, checkpointing, clustering, export and
search all work with the three core dependencies (`numpy`, `pillow`, `xxhash`),
which is what lets the test suite and CI run without model weights.

## Quick start

```bash
# 1. scan a media tree into manifest.jsonl + deduplicated.json
mmindex scan /path/to/media --work-dir ./index_work

# 2. run every stage end to end
mmindex run /path/to/media --work-dir ./index_work

# 3. query the published index
mmindex search "red car on a bridge" --work-dir ./index_work --limit 10

# 4. verify the active snapshot is internally consistent
mmindex verify --work-dir ./index_work
```

`mmindex search` prints raw JSON. `scripts/query.py` is the same query with
readable output, and it explains the mechanics when given `--explain`:

```bash
# in the CNB dev environment, against the benchmark index from scripts/benchmark.py
python scripts/query.py "a man in a suit" --limit 5
python scripts/query.py "crowd of people" --person person-0003 --min-faces 1 --explain
```

A query is one text embedding, one SQL filter and one matrix multiply:
`Index` embeds the text with SigLIP, selects candidate rows from the SQLite
`units` table, then scores `matrix[vec_row_idx] @ query_vector` — cosine
similarity, since both sides are L2-normalised — and adds `text_bonus` when the
query appears in a unit's OCR/ASR text. There is no separate vector database:
metadata is SQLite, vectors are one FP16 `.npy` matrix.

Without the ML extras installed, use `--backend hash`. It produces deterministic
pseudo-embeddings from image content so the whole pipeline — including the work
queue and search — can be exercised on any machine. Records are tagged
`backend="hash"`; never mix them with `ml` records.

## Pipeline

| Stage | What it does | Output |
|---|---|---|
| `scan` | Walk the tree, one read per file for xxhash64 + SHA256 exact dedup, canonical timestamps | `manifest.jsonl`, `deduplicated.json` |
| `prepare` | SceneDetect `ContentDetector` (threshold 27.0) + faster-whisper ASR with segment timings | checkpoint `prepare` records |
| `extract` | One midpoint frame per scene, stored as a bounded JPEG (1024 px, quality 90) | `frames/*.jpg`, checkpoint `extract` records |
| `infer` | SigLIP 768-d, InsightFace 512-d faces, RapidOCR, dhash, sharpness; deletes the frames | checkpoint `infer` records |
| `cluster` | HDBSCAN over face vectors + KMeans prototypes | `person_catalog.json`, `person_labels.json` |
| `export` | SQLite + FP16 `.npy` snapshot, atomic manifest swap | `index_snapshots/<id>/`, `index_manifest.json` |

Frames are scratch data: they are written once at a bounded size and removed as
soon as the infer record is stored, so disk use tracks the corpus rather than
its resolution. `MMINDEX_KEEP_FRAMES=1` keeps them for inspection.

ASR keeps Whisper's own segment timings, so each scene gets the words actually
spoken during it rather than a pro-rata slice of the whole transcript.

Search scores are cosine similarity over L2-normalised SigLIP vectors plus a
`0.15` bonus when the query term appears in the unit's OCR/ASR text.

## Distributed spot workers

Stages 1-3 scale horizontally over a SQLite work queue on shared storage:

```bash
# coordinator: enqueue and wait for each stage, then cluster + export
mmindex coordinator --work-dir /mnt/shared

# each spot machine: drain its shard of the current stage and exit
mmindex worker --stage infer --work-dir /mnt/shared --shard 0
```

The shard count is fixed when a stage is enqueued
(`Coordinator.enqueue_stage(..., n_shards=8)`), because every worker must agree
on the same partition for `xxhash64(file_path) % n_shards` to be stable across
machines and restarts. Omit `--shard` to let a worker take any pending file.

Workers are stateless and preemption-safe. A claim is a single
`BEGIN IMMEDIATE` transaction; a 5-minute lease with heartbeats lets the
coordinator reclaim work from vanished machines. Because
`IncrementalCheckpoint.get()` is a no-op for completed files, reclaimed work
costs at most the files that were mid-flight.

```bash
mmindex queue stats --work-dir /mnt/shared
mmindex queue reclaim --work-dir /mnt/shared
mmindex queue retry --work-dir /mnt/shared --stage infer
```

A running task keeps its lease alive from a background heartbeat, so only a
vanished machine loses its claim, and a worker whose lease was reclaimed cannot
finish, fail or release a row that another worker now owns. A stage whose tasks
have all exhausted their retries makes the coordinator stop with the failing
files instead of waiting forever; fix the cause and run `mmindex queue retry`.

### Several machines, shared storage

When `--work-dir` is a network mount, give every machine its own database:

```bash
mmindex worker --stage infer --work-dir /mnt/shared --shard 0 \
    --local-dir /tmp/mmindex --queue-journal delete
```

`--local-dir` keeps the worker's checkpoint database on the machine and shares
progress only through immutable shards under `<work-dir>/checkpoints/shards`,
named `shard-<writer>-<seq>.json.gz` so two machines can never overwrite each
other. A worker syncs its shard before it marks a task done and imports other
machines' shards before it needs their records. `--queue-journal delete` is for
a queue file on a network mount, where SQLite's default WAL mode does not work;
use Redis or a managed queue instead if the mount cannot provide POSIX locks.

## Index layout

```
index_work/
  checkpoints/
    checkpoint-v2-<namespace>.sqlite
    shards/shard-<writer>-<seq>.json.gz
  work_queue.sqlite
  manifest.jsonl
  deduplicated.json
  frames/                      # bounded JPEGs, removed once infer stores a record
  person_catalog.json
  person_labels.json
  index_snapshots/<timestamp>_<uuid>/
    historical_media_index.sqlite
    siglip_embeddings_fp16.npy
    person_catalog.json
  index_manifest.json          # atomic pointer to the active snapshot
```

`vec_row_idx` in SQLite is the row index into `siglip_embeddings_fp16.npy`.
`verify` re-checks dtype, dimensions, row alignment and manifest validity before
reporting success, and `export` refuses to publish a snapshot that fails those
checks.

The production checkpoint namespace and its legacy SQLite file are refused
outright: `Layout` and `IncrementalCheckpoint` raise `ProtectedPathError` for
`--namespace 7d928ad0a65d18eab89b` and for `checkpoint-38193eda9da83f4d2192.sqlite`,
so the "never write to production" rule is enforced rather than remembered.

## Benchmark against the reference corpus

The pipeline was designed against `Historical_Media_Benchmark`, which the
reference Colab notebook builds from four public datasets and augments with
injected redundancy. `mmindex benchmark` rebuilds that corpus, indexes it and
scores the exported snapshot against the same ground truth:

```bash
pip install -e '.[ml,cluster,benchmark]'

# representative subset (default: 400 LFW + 400 Face-Age + 400 Flickr30k + 15 clips)
mmindex benchmark --corpus-dir ./benchmark_corpus --report ./benchmark_report.json

# everything each dataset yields
mmindex benchmark --full
```

| Dataset | What it exercises |
|---|---|
| `01_LFW_People_Archive` | face detection, HDBSCAN purity, same-person grouping |
| `02_Cross_Age_Faces` | cross-age face recall, multi-prototype clusters |
| `03_Flickr30k_Daily_Albums` | SigLIP natural-language retrieval (Recall@K) |
| `04_MSRVTT_Videos` | scene splitting, ASR, OCR, multimodal alignment |
| `99_Cross_Folder_Exact_Backups` | xxhash64 + SHA256 exact dedup |

The fetch also injects the three redundancy classes the notebook uses — byte
exact copies, lossy `WECHAT_COMP_*` re-encodes, and motion-blurred
`*_burst_motion_blur.jpg` bursts — and writes
`ground_truth_dedup_benchmark.json` plus
`flickr30k_groundtruth_captions.json`.

Scoring is computed from the published index, not pipeline internals:

- **dedup**: exact-copy recall, fold rate for compressed and blurred variants
- **master election**: whether the sharp original, not the degraded variant,
  is the searchable master
- **retrieval**: Recall@1/5/10 and MRR for real Flickr30k captions
- **clusters**: purity against LFW directory identities

Results from a real CPU run are in [`BENCHMARK.md`](./BENCHMARK.md): 1,182
units, exact-duplicate recall 1.000, caption Recall@1 0.830 / Recall@5 0.965,
cluster purity 0.991 with 28/28 persons recovered.

`scripts/benchmark.py` runs the same thing with the real ML stack in the CNB
dev environment. Note that `sharpness` is `cv2.Laplacian(...).var()` and
`dhash` is bit-identical to `imagehash.dhash`, so master election and
near-duplicate grouping match the reference implementation rather than
approximately reproducing it.

## Tests

```bash
pytest
```

145 tests cover hashing and dedup, canonical timestamps, checkpoint resume and
guarded overwrite, shard round-trips, queue leasing and lease recovery,
stage-scoped task ids, stage idempotency, video scene detection, export
consistency checks, near-duplicate master selection, hybrid search ranking and
the benchmark scoring logic — all without model downloads.

`scripts/ml_check.py` additionally exercises the real model stack (SigLIP,
InsightFace, RapidOCR, faster-whisper) and is what the cloud dev environment
runs; `scripts/smoke.sh` drives the whole pipeline with the hash backend.
