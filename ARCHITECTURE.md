# Multimodal Media Indexer — Architecture

*Captured 2026-10-17. Based on `Video Process Pipeline.cuda-index-v8.ipynb`
(SHA `d72e9477...`) and production run data.*

---

## 1. What the pipeline does

The pipeline consumes a flat tree of image and video files and produces a
searchable SQLite + FP16 vector index. For each file it emits one or more
**visual units** — the smallest independently searchable piece of content:

- An image produces exactly one unit.
- A video produces one unit per scene boundary (via `ContentDetector`,
  threshold 27.0). Each unit's representative frame is the midpoint of the
  scene.

Every unit carries:

| Field | Source |
|---|---|
| `clip_embedding` (fp16, 768-dim) | SigLIP `google/siglip-base-patch16-224` |
| `faces[]` (fp16, 512-dim each) | InsightFace `buffalo_l` detection + recognition |
| `ocr_text` | RapidOCR (ONNX) |
| `asr_text` | faster-whisper `base` (video units only) |
| `dhash` | imagehash perceptual hash for near-duplicate detection |
| `sharpness` | Laplacian variance for blur/burst filtering |
| `canonical_time` | EXIF DateTimeOriginal → filename regex → mtime |

After all units are produced, face embeddings across the entire corpus are
clustered with **HDBSCAN** (`min_cluster_size=3, min_samples=3,
metric=euclidean, cluster_selection_epsilon=0.55`) and each cluster gets
KMeans prototype centers (`n_clusters=min(3,len), n_init=10`). The resulting
`person_ids` field on each unit enables person-filtered search.

The final index is a consistent snapshot: a SQLite metadata table, a
`siglip_embeddings_fp16.npy` matrix whose row indices match the SQLite
`vec_row_idx` column, and a `person_catalog.json`. An atomic `index_manifest.json`
switches to the new snapshot only after all consistency checks pass.

Hybrid search scores = cosine similarity + 0.15 bonus when the query term
appears in the unit's OCR/ASR text.

---

## 2. Deduplication and checkpointing

**Exact dedup** uses xxhash64 over file size + three 16 KiB slices as a fast
candidate hash, then SHA256 for byte-exact confirmation.

**Near-dedup** uses dhash (imagehash). The "master" for a near-dup group is the
sharpest frame; compressed/blurry variants set `is_master=False`.

**IncrementalCheckpoint** (`cell09.py`) is a SQLite-backed, gzip-delta-shard
store:
- Each completed file is `put()` atomically under an exclusive `fcntl.flock`.
- A background thread `sync()`s outbox records to numbered immutable gzip shards
  in the output directory (Drive in the Colab setup, any shared path locally).
- On restart `resume=True` skips any file whose path+digest is already in the
  DB. The GuardedCheckpoint variant also refuses to overwrite payloads that
  differ from the snapshot taken at startup.

---

## 3. Local CPU port

The original notebook targets a T4 GPU. The changes needed for a local CPU-only
setup are limited to three areas.

### 3.1 Model loading (`cell07.py`)

```python
device = "cpu"
MODEL_DTYPE = torch.float32

# ONNX providers — CPU only
face_providers = ["CPUExecutionProvider"]
session_options.intra_op_num_threads = os.cpu_count()   # was 1 on GPU
session_options.inter_op_num_threads = 1

face_app = FaceAnalysis(
    name="buffalo_l", allowed_modules=["detection", "recognition"],
    providers=face_providers, sess_options=session_options,
)
face_app.prepare(ctx_id=-1, det_size=(640, 640))   # ctx_id=-1 → CPU

siglip_model = AutoModel.from_pretrained(
    SIGLIP_MODEL_ID, torch_dtype=torch.float32,
).eval()                                            # no .to("cuda")

# faster-whisper: int8 works on CPU unchanged
whisper_model = WhisperModel("base", device="cpu", compute_type="int8")
```

Remove the CUDA provider validation block (`if device == "cuda": raise
RuntimeError(...)`) and the `disable_fallback()` calls — they are guards against
silent GPU→CPU fallback and are irrelevant when CPU is the explicit target.

Remove the OCR worker duplication loop; `OCR_WORKERS=1` on CPU.

The PyAV version check (`av.__version__ >= 19`) stays — it protects faster-whisper
regardless of device.

### 3.2 Batch sizes

| Constant | GPU value | CPU recommendation |
|---|---|---|
| `GPU_BATCH_SIZE` | 64 | 4–8 |
| `FACE_BATCH_SIZE` | 32 | 8 |
| `OCR_RECOGNITION_BATCH` | (default) | 1 |
| `DECODE_WORKERS` | 2 | `max(1, cpu_count//4)` |

SigLIP on CPU with batch 8 at 224 px runs ~0.8 s/batch on a modern laptop
(~10 images/s). InsightFace detection on 640 px is the bottleneck at ~0.3 s/frame.
Set `CHECKPOINT_EVERY = 10` to reduce re-work on interruption.

### 3.3 Clustering (`_cluster_people`)

The CPU HDBSCAN path stalls on datasets above ~50 k face vectors because
`scikit-learn-contrib/hdbscan` converts to float64 and runs a single-threaded
KD-tree query in high dimensions (512-dim). Two practical options:

**Option A — exact, for corpora under ~20 k faces:**
Use the reference `hdbscan.HDBSCAN` as written. On 20 k × 512 this completes
in under a minute.

**Option B — approximate, for larger corpora:**
Pre-reduce with PCA to 64 dims before HDBSCAN, then assign cluster labels back.
This is an approximation — validate ARI on a held-out subset before production use.

```python
from sklearn.decomposition import PCA
import hdbscan

def _cluster_people_cpu(face_vecs_fp32):
    if len(face_vecs_fp32) > 20_000:
        pca = PCA(n_components=64, random_state=42)
        reduced = pca.fit_transform(face_vecs_fp32)
    else:
        reduced = face_vecs_fp32
    labels = hdbscan.HDBSCAN(
        min_cluster_size=3, min_samples=3,
        metric="euclidean", cluster_selection_epsilon=0.55,
        core_dist_n_jobs=-1,           # parallelize where supported
    ).fit_predict(reduced)
    return labels
```

For the production-scale 102 k face problem the CUDA path (cell 11, CuPy
double-precision MST) is the validated answer. The CPU port is appropriate for
new ingestion pipelines on smaller local libraries.

---

## 4. Distributed spot architecture

### 4.1 Design constraints

- Machines are preemptible: they can vanish without notice mid-file.
- Each stage must be **idempotent**: re-running a file already in the checkpoint
  DB must be a no-op.
- Stages are processed **one type at a time** across all machines to saturate
  every node fully (no machine sits idle waiting on a predecessor stage).
- The work unit is a single media file. A batch is an even partition of the
  pending file list.

### 4.2 Stage decomposition

```
Stage 0  scan          Build the canonical file manifest (path, size, xxhash64).
                       Output: manifest.jsonl, deduplicated.json

Stage 1  prepare       scene detect + ASR per video.
                       Output: per-file preparation records in checkpoint DB.

Stage 2  extract       Keyframe extraction per scene.
                       Output: thumbnail files + frame metadata in checkpoint DB.

Stage 3  infer         SigLIP + InsightFace + OCR per frame batch.
                       Output: visual unit records (embeddings + metadata) in checkpoint DB.

Stage 4  cluster       HDBSCAN over all face embeddings, KMeans prototypes.
                       Output: person_labels.json, person_catalog.json.
                       Single machine, runs after Stage 3 is 100% complete.

Stage 5  export        Build SQLite + FP16 .npy index snapshot, write manifest.
                       Single machine, runs after Stage 4 is complete.
```

Stages 1–3 parallelize horizontally. Stages 4–5 run on one coordinator after
all workers report complete.

### 4.3 Work queue

Use a **SQLite work queue on shared storage** (NFS, GCS FUSE, or S3 with
conditional writes). Each row is one file:

```sql
CREATE TABLE work_queue (
    file_id     TEXT PRIMARY KEY,   -- SHA256 of canonical path
    file_path   TEXT NOT NULL,
    stage       TEXT NOT NULL,      -- 'prepare' | 'extract' | 'infer'
    status      TEXT NOT NULL DEFAULT 'pending',
                                    -- pending | claimed | done | failed
    worker_id   TEXT,
    claimed_at  REAL,               -- unix timestamp
    heartbeat   REAL,
    retries     INTEGER DEFAULT 0,
    error_msg   TEXT
);
```

A worker claims a row with a single `UPDATE … WHERE status='pending' LIMIT 1`
wrapped in a transaction. Lease timeout: 5 minutes. A watchdog process
(coordinator) resets `claimed → pending` for rows whose `heartbeat` is stale.
This is safe because `IncrementalCheckpoint.get()` will find the record already
done and the worker will emit a no-op.

For GCS/S3 use a lightweight Redis list or a managed task queue (Cloud Tasks,
SQS) as the leasing layer instead of SQLite-on-shared-mount.

### 4.4 Machine startup sequence

Each spot machine runs the same bootstrap:

```bash
# 1. Mount shared storage (GCS FUSE / NFS)
# 2. Clone the repo + install deps (or pull a pre-baked container image)
# 3. Run the worker loop for the active stage
python worker.py --stage infer --checkpoint-dir /mnt/shared/checkpoints
```

The worker loop:

```python
while True:
    task = queue.claim(stage, worker_id, lease_seconds=300)
    if task is None:
        break                     # no more work; machine can exit
    if checkpoint.get(task.file_path, task.digest):
        queue.mark_done(task.file_id)
        continue                  # already done by a previous run
    try:
        result = process(task)
        checkpoint.put(task.file_path, task.digest, result)
        queue.mark_done(task.file_id)
    except Exception as e:
        queue.mark_failed(task.file_id, str(e))
    queue.heartbeat(task.file_id)
```

### 4.5 Stage coordination

A coordinator script (`coordinator.py`) runs on a stable (non-spot) machine or
Cloud Run job:

1. After `scan` completes, populate `work_queue` with all files for `prepare`.
2. Poll until all `prepare` rows are `done`. Then bulk-insert the `extract` rows.
3. Poll until all `extract` rows are `done`. Then bulk-insert `infer` rows.
4. Poll until all `infer` rows are `done`. Run `cluster` locally or on a single
   large-memory machine.
5. Run `export` to produce the final index.

Spot machines for stages 1–3 can be launched in bulk at step start and will
self-terminate when `claim()` returns None.

### 4.6 Even decomposition

Partition the file list by assigning each file a shard index:
`shard = xxhash64(file_path) % N_SHARDS`. Each worker claims files from a
specific shard range. This distributes evenly without coordination and is
deterministic across restarts.

For video files (much heavier than images), weight the partition by estimated
duration or file size so no machine gets all the long videos.

### 4.7 Checkpoint storage layout

```
/mnt/shared/
  checkpoints/
    checkpoint-v2-<namespace>.sqlite      # local copy on each worker (rsync'd up)
    shards/
      shard-000001.json.gz
      shard-000002.json.gz
      ...
  work_queue.sqlite                       # or Redis
  manifest.jsonl                          # written by Stage 0
  deduplicated.json
  index_snapshots/
    <timestamp>_<uuid>/
      historical_media_index.sqlite
      siglip_embeddings_fp16.npy
      person_catalog.json
  index_manifest.json                     # atomic pointer to active snapshot
```

Each worker maintains a local SQLite checkpoint and periodically rsync/copies
new shards to shared storage. On restart the worker pulls the latest shards from
shared storage to rebuild its local DB before claiming new tasks.

---

## 5. Production state (as of 2026-10-17)

The Colab T4 run completed inference over all 77,183 files:

- 72,749 canonical completed records, 4,434 exact duplicates, 0 failures
- 76,754 visual units with embeddings
- 102,742 face vectors → CUDA clustering → 404 person clusters (7 min, 95% GPU)
- Feature DB SHA256 stable: `062a487522d8ae7708e2d161662a1aa0f842d3475cccb87a648c3c569f4df162`
- Drive checkpoint namespace: `7d928ad0a65d18eab89b`, 560+ immutable shards

**Pending:** manual notebook execution of cells 2 + 7a + 8 on the T4 to run the
index-only finalization (source SHA verify → prototype KMeans → SQLite/npy export
→ Drive snapshot). The CUDA MST state is already persisted at
`index_work/2026-10-17-cuda-index-v8` on Drive; re-running will reuse it.

See `outputs/cuda-index-v8-report-2026-10-17.txt` for the full CUDA rewrite
rationale and `outputs/final-indexing-diagnosis-2026-10-17.txt` for the
original CPU stall diagnosis.
