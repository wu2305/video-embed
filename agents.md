# agents.md — Handover for the Multimodal Media Indexer Project

*Written 2026-10-17. Intended for any model or agent picking up this work
in a fresh context window.*

---

## Where things stand right now

The Colab T4 run that processed 77,183 media files is **complete through
inference**. The final step — building the searchable index — requires one
manual action in the Colab notebook. No new VMs should be allocated and no
checkpoints should be touched.

**What is done:**
- All 77,183 files ingested (72,749 canonical + 4,434 exact duplicates, 0
  failures).
- 76,754 visual units produced with SigLIP (768-dim) + InsightFace (512-dim
  face) + RapidOCR + Whisper embeddings.
- CUDA HDBSCAN clustering completed: 102,742 face vectors → 404 person
  clusters in 423 s on the T4.
- CUDA MST resume state persisted to Drive at `index_work/2026-10-17-cuda-index-v8`.
- Feature DB SHA256 locked: `062a487522d8ae7708e2d161662a1aa0f842d3475cccb87a648c3c569f4df162`
- Published notebook SHA256: `d72e9477c08886b2b0a7a3db8cb522c584bf7807007ccb158dc93f7667e151d3`

**What is pending (one manual step):**
The user must open the Colab notebook
(`https://colab.research.google.com/drive/18_EWAF22eBwj13jSyeuRPDVwKjVAPQTr`),
do Runtime → Restart session (to release the suspended CPU kernel PID 2076
that used ~5 GiB RAM), then run **cell 2** (paths/settings), **cell 7a**
(CUDA clustering + checkpoint-only finalization), and **cell 8** (run) in
that order. `INDEX_ONLY=True` is the default. This will verify source SHAs,
load the cached CUDA MST state, fit KMeans prototypes, write the SQLite +
FP16 .npy snapshot to local SSD, copy to Drive, and flip `index_manifest.json`
atomically. No media inference will re-run.

---

## Key file locations

| What | Path |
|---|---|
| Published notebook (local copy) | `outputs/Video Process Pipeline.cuda-index-v8.ipynb` |
| CPU stall diagnosis | `outputs/final-indexing-diagnosis-2026-10-17.txt` |
| CUDA rewrite report | `outputs/cuda-index-v8-report-2026-10-17.txt` |
| Raw benchmark JSON | `outputs/cuda-index-v8-benchmark-2026-10-17.json` |
| Batch status snapshot | `outputs/colab-warning-check-2026-10-17.json` |
| Architecture doc | `ARCHITECTURE.md` (this repo) |
| Handoff from production session | `work/fullbatch_handoff.md` |
| SSH key for runtime monitoring | `work/performance-ssh-key` (restricted) |
| Monitor script | `work/monitor_fullbatch.py` |
| Register existing GPU helper | `work/register_existing_gpu.py` |
| All extracted notebook cells | `/tmp/nb/cell{00-14}.{py,md}` |

The Codex project directory with all outputs is at:
`/Users/wuhaocheng/Documents/Codex/2026-10-16/https-github-com-googlecolab-google-colab/`

---

## Pipeline summary (what the notebook does)

See `ARCHITECTURE.md` for the full design. Short version:

1. **Scan** — walk media root, xxhash64 fast-dedup candidates, SHA256 exact
   dedup, extract canonical timestamps.
2. **Prepare (videos)** — SceneDetect `ContentDetector` (threshold 27.0) for
   scene boundaries; faster-whisper `base` int8 for ASR transcript per scene.
3. **Keyframe extract** — one representative BGR frame per scene (midpoint).
4. **AI inference** — SigLIP `google/siglip-base-patch16-224` for 768-dim
   visual embeddings; InsightFace `buffalo_l` for face detection + 512-dim
   embeddings; RapidOCR for on-frame text.
5. **Checkpoint** — `IncrementalCheckpoint`: SQLite local DB + immutable gzip
   delta shards synced to Drive. Resumable: `get(path, digest)` is a no-op if
   already done.
6. **Cluster** — HDBSCAN over all face embeddings (CPU reference for small
   datasets; CUDA double-precision CuPy kernels for production scale). KMeans
   prototypes per cluster.
7. **Export** — consistent snapshot: SQLite metadata table +
   `siglip_embeddings_fp16.npy` (rows aligned to `vec_row_idx`) +
   `person_catalog.json`. Atomic manifest swap after consistency checks.
8. **Search** — `hybrid_search()`: cosine similarity over normalized SigLIP
   vectors + 0.15 text bonus for OCR/ASR matches. Supports person-ID filter
   and minimum-face-count filter.

---

## Constraints that must be preserved

- Do **not** allocate a new Colab VM. Use the existing T4
  (`gpu-t4-s-kkb-usw4b0-mfl8ml4ugrj7` was the last known name, may have
  rotated) and its local SSD.
- Do **not** write to or delete any Drive checkpoint shard or legacy SQLite.
  The 560+ shards under namespace `7d928ad0a65d18eab89b` are immutable.
- Do **not** re-run media inference. `INDEX_ONLY=True` enforces this in the
  notebook.
- Do **not** run `register_existing_gpu.py` or `monitor_fullbatch.py`
  automatically — they make SSH connections and should only be used when the
  user asks for a status check.
- The PyAV version guard (`av.__version__ >= 19 → raise`) must stay. It
  protects faster-whisper regardless of device.
- Original legacy checkpoint `checkpoint-38193eda9da83f4d2192.sqlite` is
  read-only; never write to it.

---

## Tooling notes for agents

**Colab CLI** (`colab` binary, installed via uv at
`~/.local/share/uv/tools/google-colab-cli/`): supports `exec`, `new`,
`sessions`, `log`, `whoami`. Auth token at
`~/.config/colab-cli/token.json`. Session history JSONL under
`~/.config/colab-cli/history/`.

The CLI works from the shell; its Python module is not importable from system
Python (it lives in the uv toolchain).

**SSH bridge**: `python3 work/run_gpu_ssh.py <remote-command>` — uses the
restricted key at `work/performance-ssh-key`. One connection at a time.

**Drive API**: the oauth2 token works for Colab APIs but not direct Drive
REST (needs a quota project). Use the Colab CLI or SSH stdin transfers
instead of `curl` against the Drive REST API.

**WebFetch on the Colab URL**: redirects to Google sign-in for unauthenticated
requests — won't work. The notebook is already local at
`outputs/Video Process Pipeline.cuda-index-v8.ipynb`.

---

## CPU local port status

**Implemented** as the `mmindex` package in `src/mmindex/` (2026-10-18).
`ARCHITECTURE.md` section 3 describes the diff; the shipped code applies it:

- `device="cpu"`, `MODEL_DTYPE=torch.float32` (`Settings` defaults).
- `CPUExecutionProvider` for all ONNX sessions; no CUDA validation guards or
  `disable_fallback()` calls.
- One OCR engine, `OCR_RECOGNITION_BATCH=1`.
- `GPU_BATCH_SIZE=8`; InsightFace has no batch API, so face detection runs one
  frame at a time.
- Clustering pre-reduces with PCA to 64 dims above 20 k face vectors.

Verified against real weights on CPU (local macOS and the CNB dev
environment): SigLIP 768-d normalised image and text vectors, InsightFace
`buffalo_l` detection + 512-d recognition, RapidOCR text extraction and
faster-whisper transcription of real speech.

Known deviations from the notebook worth noting:

- `imagehash` is not a dependency; dhash is implemented directly in
  `media.py`.
- faster-whisper raises `IndexError` on containers with no audio stream, so
  `MLBackend.transcribe` checks for an audio stream first and returns `""`.
- transformers 5.x returns a `BaseModelOutputWithPooling` from
  `get_*_features`; `MLBackend._features_to_array` normalises both API
  generations.
- `sentencepiece` is required for the SigLIP tokenizer and is part of the
  `ml` extra.

The `hash` backend exists so the full pipeline, queue and search can run
without model weights (used by CI and the test suite).

---

## Distributed spot architecture status

**Implemented** in `queue.py`, `worker.py` and `coordinator.py`
(2026-10-18). `ARCHITECTURE.md` section 4 describes the design; the shipped
code implements it:

- `WorkQueue` is a SQLite lease queue. A task is one file in one stage, keyed
  by `task_id = "<stage>:<file_id>"`, so the same file can be queued for
  prepare, extract and infer independently.
- Claims run inside `BEGIN IMMEDIATE`; a 5-minute lease with heartbeats lets
  `reclaim_stale()` recover work from vanished machines.
- Sharding is fixed at enqueue time
  (`enqueue(..., n_shards=N)` → `shard = xxhash64(path) % N`) so every worker
  agrees on the partition across restarts.
- Workers are stateless: a completed file found in the checkpoint is marked
  done and skipped.
- `Coordinator` enqueues each stage, waits for it, and only then runs cluster
  and export. A stage that times out aborts the run, and export refuses to
  publish an index with zero units.

Stages 4-5 still run on a single machine; horizontal clustering remains the
CUDA path from the production notebook and is out of scope for this package.

---

## Code-review fixes (2026-10-19)

A review against this handover found eight defects, now fixed with regression
tests (145 tests). Behaviour you may otherwise be surprised by:

- **Distributed `prepare` runs ASR.** The worker builds a backend lazily on the
  first video task; images never load models.
- **Near-duplicate grouping** (`export.near_duplicates`) cuts the 64-bit dhash
  into `near_dup_hamming + 1` bands over every bit, so no pair within the
  threshold is missed, and confirms candidates with vectorised hamming checks.
  `BENCHMARK.md`'s 0.375 lossy re-encode fold rate predates this fix and has not
  been re-measured.
- **Face detection** keeps two InsightFace apps (640 px, plus a 320 px fallback
  built on first use) instead of re-`prepare`-ing one, which had left every later
  image at 320 px.
- **Leases**: a background heartbeat runs while a task is processed, and
  `heartbeat/mark_done/mark_failed/release(task_id, worker_id)` apply only if that
  worker still owns the claim. `Worker` summaries report `lost` leases.
- **Failed stages**: `Coordinator.wait_for_stage` returns `False` as soon as only
  failed rows remain, and `run` aborts naming the failing files.
- **Person labels** are written with `unit_keys` (path, digest, unit index) and
  joined by key at export; a changed unit set raises `ExportError` ("re-run the
  cluster stage"). Label files from older runs fall back to the positional join.
- **Backend identity**: units carry the backend that produced them; export refuses
  a mix, stores the real name in the snapshot, and `Index.check_backend` (used by
  `mmindex search`) rejects a query embedded by another backend.
- **Multi-machine checkpoints**: shards are named
  `shard-<writer>-<seq>.json.gz` (writer id minted once per database) and
  imported shards are hash-checked. `--local-dir` gives each machine its own
  database, and a durable worker syncs its shard before marking a task done.
  `--queue-journal delete` is for a queue file on a network mount. This is tested
  with simulated machines on one disk, not on a real NFS or FUSE mount.

Still open from the review: per-scene ASR timing, uncompressed full-resolution
frames in stage 2, SHA256 on every file in `scan`, per-query hit construction in
`search`, and a guard against the production checkpoint namespace.
`scripts/query.py` does not call `Index.check_backend` yet.

---

## What to do next

1. **Production index export (unchanged)**: the user still runs notebook cells
   2 + 7a + 8 on the existing T4 to finish the Drive index for the 77 k-file
   corpus. The package in this repo does not replace that run and must not
   write to the existing checkpoint namespace.

2. **After index export**: save the final `index_manifest.json` snapshot
   contents and the Drive export path to `outputs/`. Stop the heartbeat
   monitor cron job (it was attached to the previous session's chat).

3. **Remaining future work**: validate the PCA-reduced clustering path against
   the CUDA result on a held-out subset (ARI), and add a CUDA clustering
   backend if local corpora grow past the CPU threshold.
