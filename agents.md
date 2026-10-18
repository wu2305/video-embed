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

`ARCHITECTURE.md` section 3 has the full CPU port diff. The short version:
- Set `device="cpu"`, `MODEL_DTYPE=torch.float32`.
- Use `CPUExecutionProvider` for all ONNX sessions; remove CUDA validation
  guards and `disable_fallback()` calls.
- Drop OCR worker duplication (one engine only on CPU).
- Reduce batch sizes: `GPU_BATCH_SIZE=8`, `FACE_BATCH_SIZE=8`.
- For clustering on corpora with more than ~20 k face vectors, pre-reduce
  with PCA to 64 dims before HDBSCAN (approximate; validate ARI on a subset
  before using in production).

---

## Distributed spot architecture status

`ARCHITECTURE.md` section 4 has the full design. It has not been implemented
yet — it is a design document. The stages are: scan → prepare → extract →
infer → cluster → export. The cluster and export stages run on a single
coordinator after all workers report complete. Work queue is a SQLite table
(or Redis for cloud deployments) with lease-timeout recovery. Workers are
stateless and safe to preempt at any point; `IncrementalCheckpoint.get()`
makes re-processing a completed file a no-op.

---

## What to do next

1. **Immediate**: user runs notebook cells 2 + 7a + 8 to complete the index
   export. Once `index_manifest.json` is written with `"complete": true`, the
   project's primary goal is achieved.

2. **After index export**: save the final `index_manifest.json` snapshot
   contents and the Drive export path to `outputs/`. Stop the heartbeat
   monitor cron job (it was attached to the previous session's chat).

3. **Future work (not started)**: implement the local CPU port as a standalone
   Python package; implement the distributed spot architecture using the
   design in `ARCHITECTURE.md`.
