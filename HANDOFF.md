# HANDOFF — code review and fixes, 2026-10-19

For the next agent or person picking this up. Read `agents.md` first for the
production constraints; this file covers only the 2026-10-19 review session. It
says what was done, what is **not** solved, what is **not verified**, and what
to do next, in that order.

> **Update (later the same day): findings 9-13 are now fixed too.** The work
> lives on branch `review/2026-10-19` (pushed to CNB), not on `main`. See
> section 6 for what changed, what was measured, and what is still open. The
> sections below describe the state when only findings 1-8 were done and are
> kept for the reasoning and the still-valid gaps.

---

## 0. State of the working tree

- **Nothing is committed.** 18 files modified, 2 new (`tests/test_worker.py`,
  and the user's own untracked `scripts/query.py`, which I did not touch).
  `README.md` already carried the user's uncommitted edits before this session;
  my README edits sit on top of them. Review `git diff` and let the user decide
  how to commit.
- No stash is left behind (`git stash list` is empty).
- Test suite: `.venv/bin/python -m pytest -q` → **145 passed** (was 112).
  `PATH=$PWD/.venv/bin:$PATH bash scripts/smoke.sh` → passed.
- The review write-up lives in a Claude doc, not in the repo:
  https://claude.ai/code/artifact/3dafdb6c-8c62-4850-aa9f-94660f2da43b
  It has English sections, a Haiku-translated Chinese section, the 13-row
  findings table and one open comment to the user. **It still describes
  findings 1–8 as open**; update both language sections if you keep using it.

## 1. What was fixed (findings 1–8)

Each has regression tests. Details are also in `agents.md` ("Code-review fixes").

| # | Fix | Main files | Tests |
|---|---|---|---|
| 1 | Distributed `prepare` builds a backend lazily on the first video, so ASR runs; the worker closes a backend it built | `worker.py` | `test_worker.py` |
| 2 | Near-duplicate banding covers all 64 bits with `near_dup_hamming + 1` bands, vectorised confirmation and union-find | `export.py` | `test_near_duplicates.py` |
| 3 | Face detector: two apps (640 px, plus a 320 px fallback built on first use) instead of re-`prepare`-ing one | `backends.py` | `test_backends.py` |
| 4 | Background lease heartbeat; `heartbeat/mark_done/mark_failed/release` take `worker_id` and apply only to the owner | `queue.py`, `worker.py` | `test_worker.py`, `test_queue.py` |
| 5 | Shards named `shard-<writer>-<seq>.json.gz`; hash-checked, atomic-per-shard import; `Layout.local_dir` / `--local-dir`; durable sync before mark-done; `--queue-journal delete` | `checkpoint.py`, `config.py`, `worker.py`, `cli.py` | `test_checkpoint.py`, `test_distributed.py` |
| 6 | `wait_for_stage` returns `False` when only failed rows remain; `run` aborts naming the files | `coordinator.py` | `test_distributed.py` |
| 7 | Person labels carry `unit_keys` and are joined by key; a changed unit set raises `ExportError` | `clustering.py`, `export.py` | `test_export_search.py` |
| 8 | Units carry their backend; export refuses a mix and records the real name; `Index.check_backend` guards `mmindex search` | `export.py`, `search.py`, `cli.py` | `test_export_search.py` |

Side effects worth knowing: `sync()` now streams the outbox with a join instead
of loading every record payload each time; the worker's fallback `ManifestEntry`
uses `media_kind()` instead of always `"image"`; `Worker.run()` summaries gain a
`lost` key; `import_shards` applies one transaction per shard.

---

## 2. Issues NOT solved

Findings 9–13 from the review table are untouched, plus items I noticed while
fixing. Priority order within each group.

### 2.1 Review findings still open

| # | Sev | Where | Issue | Suggested fix |
|---|---|---|---|---|
| 9 | Medium | `stages.py` `_scene_text` (≈L175), `infer_entry` (≈L230), `backends.py` `transcribe`, `media.py` `iter_scene_frames` | ASR is one transcript per video, split across scenes by word count; the aim (`agents.md`) is per-scene ASR. If a frame fails to decode, `infer_entry` indexes scenes by list position, so unit and scene indexes drift. | Return Whisper segments with start/end times from `transcribe`, store them in the prepare record, assign text to a scene by overlap. Use `frame["index"]`, not `enumerate`, to pick the scene. Keep `asr_text` for compatibility. |
| 10 | Medium | `stages.py` `extract_entry` (≈L136, L149) | Every frame is saved at full resolution as uncompressed `.npy` and never deleted. A 12 MP photo is about 36 MB; 77 k files could need terabytes. | Store a bounded-size JPEG (see 3.2 for the size question) and delete frames after `infer`, or make cleanup an explicit `mmindex clean` step. |
| 11 | Low | `scan.py` ≈L173–L217 | SHA256 runs on every file, so the xxhash pre-filter saves nothing; `fast_digest` is computed twice per file; an unreadable unique file raises and aborts the whole scan (only the collision branch catches `OSError`). | Group by size and fast digest first, SHA256 only inside collision groups (check how the notebook defines the checkpoint `digest` first, see 3.4). Give the singleton branch the same `OSError` handling. |
| 12 | Low | `search.py` `Index.search` (≈L143–L184) | Builds a `SearchHit`, parses `person_ids` JSON and lowercases OCR/ASR text for every candidate row before taking the top k. | Rank with numpy (`argpartition`), build hits only for the top k; compute the text bonus only for rows that can still make the top k. |
| 13 | Low | `config.py` `Layout`, `cli.py` `--namespace`, `checkpoint.py` `delete()` | Nothing refuses `--namespace 7d928ad0a65d18eab89b` or the legacy `checkpoint-38193eda9da83f4d2192.sqlite`; the "never write" rule rests on convention. | Refuse those names in `Layout` (and in `IncrementalCheckpoint`), with a test. Decide whether `delete()` should exist at all. |

### 2.2 Other known gaps (not in the review table)

- `scripts/query.py` (the user's untracked file) does not call
  `Index.check_backend`, so it can still query a hash index with an ml
  embedding. I left it alone because it is the user's in-progress file. It also
  hand-copies the SQL filter for `--explain`, which will drift from
  `Index._candidates`.
- `IncrementalCheckpoint.put` still does `INSERT OR REPLACE` and its conflict
  check uses a baseline captured at startup. If two workers ever process the
  same file (now much rarer), the later write can overwrite the earlier one with
  a payload that differs only by timestamps. Make `put` first-writer-wins.
- Durable workers write one shard **per task**. For 77 k files that is tens of
  thousands of small shard files (the production run has ~560 batched shards).
  Correct but heavy on a shared mount; batch completions (sync once per N tasks,
  mark those N done after the sync) if the file count hurts.
- `mmindex coordinator` has no `--n-shards`; `enqueue_stage(n_shards=…)` is
  reachable only from Python, so `--shard N>0` on the CLI finds nothing.
- `Worker.run(max_idle_polls=1)` exits at once if started before the
  coordinator has enqueued the stage. Fine for the documented "launch after
  enqueue" flow, but undocumented.
- ASR failures are recorded as `asr_error` in the prepare record and the stage
  still reports success. A worker with Whisper missing silently produces empty
  transcripts. Surface this in the stage summary.
- `build_backend("auto")` can never fall back to the hash backend:
  `MLBackend.__init__` imports nothing, so the `except` branch is dead code.
  Missing ML dependencies fail per file at inference time instead.
- `export_snapshot` stores an absolute `snapshot_dir` in `index_manifest.json`,
  so a work directory copied elsewhere (for example to Drive) points at the old
  path. Store it relative to the manifest.
- `Coordinator._all_units` loads every infer record into memory at once. Not
  measured at 77 k files.
- Sharpness is computed at each frame's own resolution, so a downscaled original
  can score lower than its blurred copy; this is the cause of the 3 master
  election misses in `BENCHMARK.md`. Normalise to a fixed size before the
  Laplacian.

---

## 3. Issues NOT verified

Things I believe but did not prove, or could not check in this environment.
Do not treat any of them as settled.

### 3.1 Not run at all

- **`scripts/ml_check.py` and `scripts/benchmark.py` were not re-run** after the
  fixes. All 145 tests use the `hash` backend or fakes. The real SigLIP /
  InsightFace / RapidOCR / Whisper path is unexercised since my changes,
  including the new two-app face detector (`_build_face_app` is only tested with
  a fake). The `.venv` has an `insightface` 2.1 whose `FaceAnalysis.prepare`
  persistently overwrites the detector size; I did not run it on real images.
- **`BENCHMARK.md` numbers are stale.** The lossy re-encode fold rate (0.375)
  and master-election accuracy were measured with the buggy banding. Whether
  they rise after fix 2 is unknown; do not claim a number until it is re-run in
  the CNB environment.
- **No real shared mount.** The multi-machine tests simulate machines with
  separate local databases on one disk. NFS, GCS FUSE and Filestore behaviour
  (rename atomicity, `flock`, SQLite in `DELETE` journal mode) is untested.
  The queue itself is still a SQLite file on that mount; SQLite over a network
  filesystem remains a risk even in `DELETE` mode.
- **Scale.** Nothing was run near 77 k files. Near-duplicate grouping was timed
  on 30 k random hashes and 6 k identical hashes only; a realistic corpus with
  many near-identical frames could behave differently (cost is quadratic inside
  one band bucket). Search latency and `_all_units` memory at 77 k are unmeasured.
- **Regression tests were not confirmed to fail on the old code.** I reproduced
  the original bugs with probe scripts before fixing them (near-dup recall and
  quadratic growth, failed-row hang, stale `mark_failed`, mixed-backend export),
  but my attempt to run the new tests against the old source (via `git stash`)
  only produced an import error, so the "test fails before, passes after" check
  was not completed. Do it with a throwaway worktree.

### 3.2 Assumptions that need a decision or a check

- **Face embedding scale vs `cluster_selection_epsilon=0.55`.** The package
  clusters raw InsightFace `embedding` vectors (not `normed_embedding`) with
  euclidean HDBSCAN. 0.55 is a sensible epsilon for unit-length vectors, not
  for raw ones. The benchmark (28/28 persons, purity 0.991) passed, but it has
  only 28 identities. The production notebook's choice is unknown because the
  notebook is not in this checkout. Check which vector the notebook clusters.
- **PCA-reduced clustering (above 20 k faces) has never been compared with the
  full-dimension or CUDA result.** `agents.md` lists the ARI check as open work.
  The epsilon is also applied unchanged in PCA space.
- **Text bonus semantics.** `Index.search` adds 0.15 when the *whole query
  string* is a substring of OCR+ASR text. The production `hybrid_search()` may
  match per term or per token. Unverified because the notebook is absent.
- **Size to store frames at (finding 10).** Face detection runs at 640 px and
  OCR may need more; decide the stored size from the models' needs, not a guess.
- **Which digest the checkpoint keys use (finding 11).** If the production
  notebook keys checkpoints by full SHA256 of every file, scan cannot skip it.
- **Review scope.** The review compared the code with `agents.md` and
  `ARCHITECTURE.md`. The reference notebook, `outputs/` and `work/` are not in
  this repo, so fidelity to the notebook itself is unchecked.

### 3.3 Production state, unchanged and unverified here

- The Colab index export (cells 2 + 7a + 8) is the user's manual step. I did
  not touch it and cannot see whether it has run.
- The statements in `agents.md` about the T4 run, SHAs and Drive state were not
  re-verified.

---

## 4. Next-step work plan

Ordered. Each step lists what "done" means. Stop and ask the user before steps
marked **[user]**.

### Step 1 — Lock in the current work (small)

1. Review `git diff` (about 1,100 added lines). **[user]** Ask how to commit:
   one commit per finding is the cleanest history (findings 1–8 touch mostly
   disjoint code, except `export.py`, `worker.py` and `queue.py`).
2. In a throwaway worktree, check out the old source and run only the new tests
   to confirm each fails there (closes 3.1, last bullet).
3. Done when: committed (or the user says otherwise), and every new regression
   test is shown to fail on the old code.

### Step 2 — Verify on the real stack (needs the CNB dev environment)

1. `python scripts/ml_check.py` — real models still load and produce 768-d / 512-d
   vectors after the backend changes.
2. `python scripts/benchmark.py` — compare against `BENCHMARK.md`. Record the new
   lossy re-encode fold rate, master-election accuracy, Recall@K and purity.
3. Add a real-image test or script for the two-app detector: one tight crop and
   one full-size photo, in both orders, expecting identical faces.
4. Update `BENCHMARK.md` with the new numbers and what changed.
5. Done when: the benchmark runs clean and `BENCHMARK.md` says which numbers moved.

### Step 3 — Finish the review (findings 9–13)

Do in this order; each with regression tests.

1. **Finding 9** (per-scene ASR, frame/scene alignment). It changes record
   contents, so bump a record `schema` field and keep reading old records.
2. **Finding 13** (production-namespace guard). Small, and it protects the
   `agents.md` hard constraint.
3. **Finding 10** (frame storage). Decide the stored size first (3.2).
4. **Finding 11** (scan hashing) after checking the digest question (3.2).
5. **Finding 12** (search top-k). Add a benchmark at synthetic 77 k units.
6. Done when: findings 9–13 are fixed or explicitly deferred by the user, and
   the review doc's table is updated.

### Step 4 — Close the verification gaps

1. **Clustering**: obtain the notebook's clustering cell (ask the user for the
   local copy `outputs/Video Process Pipeline.cuda-index-v8.ipynb`, which this
   checkout lacks), settle raw vs normalised vectors and the epsilon, then run
   the PCA-vs-full ARI check on a held-out subset. Done when ARI is recorded in
   `BENCHMARK.md` and the epsilon choice is justified in `ARCHITECTURE.md`.
2. **Text bonus**: compare with the notebook's `hybrid_search()`; align or
   document the difference.
3. **Real shared storage**: run the three-stage worker test against an actual
   NFS or GCS FUSE mount with two machines, including a killed worker. Done when
   a killed worker's file is re-done by another machine and the final index
   matches a single-machine run.
4. **Scale**: run the pipeline on a few thousand files and extrapolate time and
   memory; measure `_all_units` memory and search latency at 77 k units.

### Step 5 — Hardening backlog (2.2), by value

1. Make `put` first-writer-wins; reconsider `delete()` (pairs with finding 13).
2. Add `--n-shards` to `mmindex coordinator`; document `Worker.run`'s idle exit.
3. Surface `asr_error` counts in stage summaries and the coordinator log.
4. Store `snapshot_dir` relative in `index_manifest.json`.
5. Normalise sharpness to a fixed frame size; re-measure master election.
6. Batch durable shard writes if the shard count is a problem on the real mount.
7. Make `scripts/query.py` call `Index.check_backend` and reuse
   `Index._candidates` for `--explain` — **[user]**, it is their file.
8. Remove or fix the dead hash fallback in `build_backend("auto")`.

### Step 6 — Production hand-back **[user]**

1. The user runs notebook cells 2, 7a and 8 on the existing T4 (no new VM, no
   inference re-run, no writes to Drive checkpoint shards or the legacy SQLite).
2. Afterwards: save the final `index_manifest.json` contents and the Drive
   export path under `outputs/`, and stop the heartbeat cron job (see
   `agents.md`, "What to do next").
3. Do **not** run `register_existing_gpu.py` or `monitor_fullbatch.py` unless
   the user asks for a status check; they open SSH connections.

---

## 5. Rules that still apply (from `agents.md`)

- Do not allocate a new Colab VM; use the existing T4.
- Do not write to or delete any Drive checkpoint shard or legacy SQLite; the
  560+ shards under namespace `7d928ad0a65d18eab89b` are immutable.
- Do not re-run media inference on the production corpus (`INDEX_ONLY=True`).
- Keep the PyAV guard (`av.__version__ >= 19` raises) in `MLBackend`.
- The `mmindex` package must not write to the production checkpoint namespace.
  Finding 13 now enforces this: `Layout` and `IncrementalCheckpoint` raise
  `ProtectedPathError` for that namespace and for the legacy SQLite filename.

---

## 6. Second session: findings 9-13, verified on CNB

### Where the work is

- Branch **`review/2026-10-19`**, pushed to `origin` (CNB). `main` is untouched
  and still at `30613c6`.
- Seven commits: the eight-finding fix, findings 9-13, two test fixes, the
  search top-k perf fix with docs, and two frame-bound probe commits.
- `scripts/query.py` is still untracked — it is the user's file and was left
  alone. It still does not call `Index.check_backend`.

### How to run anything remotely

CNB dev workspaces have **no exec endpoint** — only `start`, `list`, `stop`,
`delete`, `detail` (webide/jump URL). The working path is an API-triggered
build with an inline config, which is how every measurement below was taken:

```bash
cnb build start-build --repo wu2305/video-embed --branch review/2026-10-19 \
  --event api_trigger --config "$(cat scratch/cnb-test.yml)" --title "suite"
cnb build get-build-status --repo wu2305/video-embed --sn <sn>
cnb build get-build-stage --repo wu2305/video-embed --sn <sn> \
  --pipelineId <sn>-001 --stageId stage-1
```

Stage logs come back as a JSON `content` array; strip the ANSI codes and the
download progress bars before reading. A build checks out a git ref, so
**nothing can be tested until it is committed and pushed.**

### What each finding now does

| # | Change | Regression test |
|---|---|---|
| 9 | `prepare` writes `schema: 2` + `asr_segments` (Whisper start/end/text); `_scene_text` gives a scene every segment overlapping it; `infer` keys per-frame arrays by `frame["index"]` | `test_scene_text.py` (5 new), `test_infer_aligns_units_to_frame_index_after_a_dropped_scene` |
| 10 | `extract` writes a bounded JPEG (`frame_max_edge` 1024, q90); `infer` unlinks frames after the record is stored; `keep_frames` retains them | `test_stored_frame_is_bounded_and_much_smaller_than_raw`, `test_infer_deletes_frames_after_the_record_is_stored`, `test_keep_frames_leaves_them_on_disk` |
| 11 | `hashing.digests` returns SHA256 + xxhash from one read; `scan` groups by SHA256 and records unreadable files in `skipped` | `test_combined_digests_match_the_standalone_hashes`, `test_scan_reads_each_file_once`, `test_scan_skips_an_unreadable_file_instead_of_aborting` |
| 12 | `Index.search` ranks with numpy, pulls the k-th tie group for exact ordering, builds hits only for returned rows | `test_search_ranks_without_building_a_hit_per_row`, `test_search_still_honours_min_score_and_ties` |
| 13 | `ProtectedPathError` for the production namespace and legacy filename; `delete()` removed | `test_production_namespace_is_refused`, `test_legacy_checkpoint_file_is_refused`, `test_layout_refuses_the_production_namespace` |

### Verification actually performed

- **Full suite + smoke on CNB: 157 passed, 3 skipped** (`smoke.sh` clean).
- **New tests fail on the old source.** Built a throwaway branch with `main`'s
  source and the new tests, ran with `--continue-on-collection-errors`. 34 of
  the new tests failed there for the expected reasons. Caveat: the four
  `test_backends` face-detector tests failed with `ModuleNotFoundError:
  onnxruntime` in that configuration rather than on their assertion, so for
  those four the before/after check is **not** clean — they were confirmed only
  by reading, not by a red run. That branch was deleted afterwards.
- **`scripts/ml_check.py` on CNB: passed** — SigLIP 768-d normalised vectors,
  InsightFace found the face in the reference photo (1 face), RapidOCR read
  "HELLO 2026". The two synthetic ovals correctly yield 0 faces; the script
  asserts on the reference photo instead.
- **`scripts/benchmark.py` on CNB: passed on the full corpus** (1,182 units,
  no skipped datasets, captions present). Before/after numbers are in
  `BENCHMARK.md` ("Re-run after the 2026-10-19 fixes"). Two caveats recorded
  there: the +5 lossy folds are corpus drift rather than a measured improvement
  (old and new grouping agree exactly on 200 images), and the inference timing
  spread looks like runner speed but was not isolated.
- **Frame bound justified by measurement**: `scripts/frame_bound_check.py`
  (new) shows a 3000 px portrait keeps its face at the same det_score after the
  1024 px bound (0.910 → 0.911) and loses no OCR text.

### The two numbers that needed chasing

- A first benchmark run lost Flickr30k and reported a lossy fold rate of 0.021.
  `fetch_flickr` was swallowing the Parquet mirror's error and re-raising only
  the fallback's "scripts are no longer supported", so the real failure was
  invisible. Fixed: the first error is logged. The 0.021 was a corpus artifact.
- The full run then reported 0.438 against the old 0.375. Checked rather than
  claimed: old and new `near_duplicates` return identical masters on 200 images
  (10 folds each), and the old banding only missed ~0.5% of distance-6 pairs, so
  the delta is corpus drift, not the fix. `BENCHMARK.md` says so.


### What is still open

1. **Re-measure the benchmark on a full corpus.** Needs a `datasets` version
   that still runs loading scripts, or a Flickr30k mirror shipping Parquet.
   Until then the caption metrics and the 0.375 figure are unre-run.
2. **Findings 9-13 are uncommitted to `main`.** They are on the review branch
   only; the user decides how to merge.
3. Everything in section 2.2 and section 3 above is still true except the items
   findings 9-13 closed: `put` is still `INSERT OR REPLACE`, durable workers
   still write one shard per task, `coordinator` still has no `--n-shards`,
   `asr_error` is still silent in summaries, `snapshot_dir` is still absolute,
   `_all_units` still loads everything, and sharpness is still measured at each
   frame's own resolution.
4. **Sharpness-based master election** is now the visible weak spot (4/48 wrong
   on blurred copies, and the compressed-variant copies score *higher* Laplacian
   variance because downscale-then-upscale inflates it). Normalising to a fixed
   size before the Laplacian is the fix; it is not done.
5. `scripts/query.py` still bypasses `Index.check_backend` — the user's file.

