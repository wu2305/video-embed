# HANDOFF — code review, fixes and a query console (2026-10-19/20)

For the next agent or person picking this up. Read `agents.md` first for the
production constraints; this file covers the three sessions on
`review/2026-10-19` — the code review and its 13 findings, the CNB verification,
and the sharpness fix plus query console. It says what was done, what is **not**
solved, what is **not verified**, and what to do next, in that order.

Sections 0-5 are the original write-up and are kept for the reasoning, but their
"state" claims are historical. **Sections 6 and 7 are the current truth.**

## Start here

Everything is on branch `review/2026-10-19` (18 commits, pushed, clean tree);
`main` has none of it. All 13 review findings are fixed, sharpness is now
measured at a fixed scale, and `scripts/serve.py` serves a query console over a
forwarded port.

Verified on CNB: **181 passed**, smoke clean, `ml_check.py` green against real
weights, full-corpus benchmark green, console exercised in the container.

**Nothing is committed to `main` — that decision is the user's.**

Read in this order:

1. `agents.md` — production constraints that must not be broken.
2. Section 6 — what each finding does now, how it was verified, and the traps
   (no exec on CNB workspaces; builds only see pushed commits).
3. Section 7 — the sharpness fix, the query console, and how to run it.
4. Section 6 "State at hand-off" and "What is still open" — current status.
5. `BENCHMARK.md` — before/after numbers and which deltas are *not* the fixes.

Next task by value: the 3 motion-blur master-election misses need a
blur-sensitive metric (rescaling did not fix them). Highest-priority decision:
how to land the branch.


---

## 0. State of the working tree

> **Superseded:** everything described here was committed to
> `review/2026-10-19`. See "Start here" and section 6 for the current state.

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

> **Superseded for findings 9-13:** they are fixed on `review/2026-10-19`; see
> section 6. Table 2.1 below is kept only as the original problem statement.
> Section 2.2 and section 3 are still accurate.

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
  Laplacian. **Done** — `sharpness_edge` 256 px, section 7. It fixed the
  compressed-copy case (fold rate 0.4375 -> 1.000) but *not* the 3 motion-blur
  misses, which need a different metric.

---

## 3. Issues NOT verified

Things I believe but did not prove, or could not check in this environment.
Do not treat any of them as settled.

### 3.1 Not run at all

> **Superseded for the first three bullets:** `ml_check.py` and `benchmark.py`
> both ran on CNB and `BENCHMARK.md` has been re-measured (twice). See sections
> 6 and 7. The shared-mount, scale and regression-test bullets were also
> addressed — regression tests were confirmed to fail on the old source, with
> the one caveat in section 6.

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
  **Answered** by `scripts/frame_bound_check.py`: a 3000 px portrait keeps its
  face at the same det_score after the 1024 px bound (0.910 -> 0.911) and loses
  no OCR text, so 1024 px is justified rather than assumed.
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

> **Status:** steps 1-3 are done on `review/2026-10-19` (the branch is committed
> and pushed; the before/after test check ran with the one caveat in section 6;
> findings 9-13 are fixed). Step 2's benchmark and ml-check ran on CNB. Steps 4,
> 5 and 6 are still open — see "What is still open" in section 6 for the
> current priority order, which supersedes the ordering below.

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

- **Full suite + smoke on CNB.** At the end of this session (section 7 added
  `test_sharpness.py` and `test_serve.py`): **181 passed**. Earlier, right after
  findings 9-13: 154 passed, 4 skipped of 158 collected. The skips are
  environmental: 3 in `test_audio_guard.py` (PyAV absent under the `test` extra)
  and 1 in `test_ml_retrieval.py` (torch absent). `smoke.sh` ran clean on both
  builds.
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


### State at hand-off (2026-10-20, end of third session)

- Branch `review/2026-10-19`, HEAD `1e45293`, **18 commits ahead of `main`**,
  working tree clean, everything pushed to `origin`. `main` is still `30613c6`
  and has none of this work.
- Verified on that branch, on CNB: **181 passed** (was 145 before the review),
  `smoke.sh` clean, `ml_check.py` passed against real weights, full-corpus
  benchmark passed, and the query console exercised end-to-end in the container
  (build `cnb-a2v-1k5av5srh`).
- No CNB workspace is running; the platform recycled the last one. Nothing is
  left running locally, and no browser session is open.
- Only untracked file: `scripts/query.py` (the user's). Everything else,
  including `scripts/serve.py`, `scripts/frame_bound_check.py` and
  `scripts/flickr_probe.py`, is committed.
- Local `.venv` has the test extras only — no torch/InsightFace — so the real
  ML path must be run on CNB.

### What is still open, in priority order

1. **[user] Decide how to land this.** 18 commits sit on the review branch and
   `main` has none of them. One merge, or a replay grouped per finding
   (findings 1-8 touch mostly disjoint code; `export.py`, `worker.py` and
   `queue.py` are shared). Do not assume the branch is wanted as-is.
2. **The 3 motion-blur master-election misses.** Rescaling did not fix them, so
   the next attempt needs a blur-sensitive metric (a real focus measure, not a
   sharper Laplacian). This is the only known correctness gap in dedup.
3. **Section 2.2 items that findings 9-13 did not touch**, all still true:
   `IncrementalCheckpoint.put` is still `INSERT OR REPLACE` (not
   first-writer-wins); durable workers still write one shard per task; no
   `--n-shards` on `mmindex coordinator`; `asr_error` still silent in stage
   summaries; `snapshot_dir` still absolute in `index_manifest.json`;
   `_all_units` still loads every infer record at once.
4. **Unverified areas from section 3 that remain unverified**: PCA-reduced
   clustering has still never been compared to full-dimension or CUDA (no ARI);
   no real NFS/FUSE mount has been exercised; nothing near 77 k files has run,
   so `_all_units` memory and search latency at production scale are unknown.
   The `cluster_selection_epsilon=0.55` question (raw vs normalised face
   vectors) is still open — the notebook that would settle it is not in this
   checkout.
5. `scripts/query.py` still bypasses `Index.check_backend` and hand-copies the
   `--explain` SQL. Leave it unless the user asks.

### Traps for the next session

- **CNB dev workspaces cannot be driven from a shell.** `cnb workspace` offers
  only start/list/stop/delete/detail; there is no exec. Use api-triggered builds
  (see "How to run anything remotely") and remember a build checks out a git
  ref — nothing uncommitted can be tested.
- **CNB joins a stage's `script:` list with `&&`.** A `- cmd &` line becomes
  `cmd & && next`, which is a syntax error. Put multi-step shell in one `|`
  block instead.
- **`pytest -q` is already in `addopts`**, so `-q -q` hides the summary line and
  makes the pass/skip count look wrong. Use `-o addopts="" -q -rs` when the
  count matters.
- **`mmindex.scan` is the re-exported function, not the module.** Patching it in
  a test needs `importlib.import_module("mmindex.scan")`.
- **The Flickr30k mirror matters.** `lmms-lab-encoder/flickr30k` is Parquet and
  works on `datasets` 5.x; `nlphuji/flickr30k` ships a loading script that 5.x
  refuses. `scripts/flickr_probe.py` prints both outcomes if a benchmark run
  loses images again.
- **`fetch_flickr`'s fallback is error-hiding by design.** It logs the first
  mirror's failure now, but a silent `skipped` entry in the benchmark report is
  still the signal that the corpus shrank — check `corpus.skipped` before
  quoting any metric.
- **Do not re-run `scripts/benchmark.py` casually.** A full run costs ~45-65 min
  of 8-vCPU time plus ~22 min of dataset download, and inference timing varies
  ~2-3x between runners, so cross-run timing comparisons are unreliable.
- **Chrome cannot decode `mpeg4`** (OpenCV's `mp4v` writer). Demo clips for the
  console must be H.264 or the player shows an error that looks like a server
  bug.


---

## 7. Sharpness normalisation and the query console (third session)

### Sharpness (`media.sharpness(image, size)`)

The bug: master election compares Laplacian variance between files, and raw
variance depends on resolution. A half-resolution copy, upscaled by the decoder,
carries *more* high-frequency energy than the original, so it won the election.
On 80 LFW faces the original won **0 of 80** against a quality-35 copy.

The fix: `sharpness()` takes a `size` and scales the grayscale image so its long
edge is that many pixels first. At 256 px the original wins **80 of 80** against
the compressed copy and **80 of 80** against a 17x17 Gaussian blur. Default is
`Settings.sharpness_edge = 256`; `0` restores raw behaviour.

Consequences a reader will hit:

- **Records now carry `sharpness_edge`.** `infer` writes it; `collect_units`
  copies it onto each unit; `export` refuses a corpus that mixes scales
  (`resolve_sharpness_edge`), because those values are not comparable and the
  election would be decided by when each file happened to be inferred.
  Records predating the field are all treated as raw (`0`), so a corpus inferred
  entirely before this change still exports.
- **An existing checkpoint cannot be mixed with new work.** Re-infer the whole
  corpus, or keep `sharpness_edge=0` for the whole run.
- **Benchmark effect:** lossy fold rate 0.4375 -> **1.000**; every other metric
  unchanged (blur fold 0.9625, master accuracy 0.9625, recall@1 0.845, purity
  0.9903, 28/28 persons). Full table in `BENCHMARK.md`.

### Query console (`scripts/serve.py`)

Standard library only — `http.server` + `ThreadingHTTPServer`, no new deps. One
page: query box, limit, person, min-faces, min-score, non-master toggle; result
cards with thumbnails; and a strip showing the embed / rank / total timings so
the PoC's mechanics are visible rather than asserted.

```
GET /                  the console
GET /api/info          snapshot, backend, units, matrix shape, persons
GET /api/search?q=...  ranked hits + timings
GET /api/thumb?id=N    cached bounded JPEG (video: frame re-read at scene midpoint)
GET /api/source?id=N   original file, Range-capable
```

```bash
python scripts/serve.py --work-dir /opt/benchmark_work --port 8000
# prints the CNB proxy URL when CNB_VSCODE_PROXY_URI is set
```

Things that were not obvious and cost time:

- **Browsers will not play a video without `Range` support.** Serving 200 with
  the whole body produced `MEDIA_ERR_SRC_NOT_SUPPORTED` (error 4) even though
  `curl` was happy. `_stream()` now returns 206 with `Content-Range`,
  `Accept-Ranges`, suffix ranges, and 416 for an unsatisfiable range.
- **Chrome cannot decode `mpeg4`** (the fourcc OpenCV's `mp4v` writer emits).
  The UI is fine; a test fixture in that codec will always show a broken player.
  Use H.264 for demo clips.
- **The server binds `0.0.0.0`** on purpose: CNB port preview requires it, and
  a `127.0.0.1` bind is unreachable through the proxy.
- Thumbnails are read only through ids present in the `units` table, so the
  endpoint cannot be used to read arbitrary container files.
- It is a demo: no auth, no pagination, one process, `no-store` on responses.

Tests: `tests/test_serve.py` (12) drive the real handler over a loopback socket,
including range semantics and error codes; `tests/test_sharpness.py` (8) cover
the metric, the recorded scale and the mixed-scale refusal. Removing the range
handling makes `test_source_streams_with_range_support` fail, which was checked.

**Verified in the CNB container itself** (build `cnb-snl-1k5asv48o`, real `ml`
backend, 127 units / 110 masters over a reduced benchmark corpus):
`/api/info` 200 with the person catalog, `/` 200 with the page, `/api/search`
200 with ranked hits, `/api/thumb` 200 returning JPEG bytes. An earlier run of
the same check failed only because `file(1)` is not installed in that image —
the endpoint itself had already returned 200.

### Console caveats for whoever opens it

- It holds **one** `Index` and **one** backend for the process; a second
  snapshot needs a restart. Fine for a demo, wrong for a service.
- `embed_text` is serialised behind a lock, so concurrent searches queue on the
  text tower rather than racing it.
- Thumbnails are cached in memory with a 512-entry cap, cleared wholesale when
  full (not LRU). A video thumbnail re-decodes the clip on every miss.
- No auth. Anything that reaches the port can read every indexed file through
  `/api/source`. Bind it behind a forwarded port, not on a public interface.

---

## 8. Runbook: picking this up cold

Everything below was run in this session; copy-paste it rather than
reconstructing it. `cnb` is the CNB CLI, authenticated with `cnb login`.

### Verify the branch is still green (cheapest useful check)

```bash
cd /Users/wuhaocheng/Documents/repos/video-embed
git status --short          # expect empty
git log --oneline -1        # expect 1e45293 or later on review/2026-10-19
.venv/bin/python -m pytest -o addopts="" -q     # expect 181 passed locally
```

The local venv has no torch/InsightFace, so it exercises the `hash` backend
only. For the real stack, use CNB.

### Run the suite on CNB (no exec there — this is the way)

Write the config once, then reuse it. `/tmp` does not survive between sessions;
keep it in the repo scratchpad or recreate it:

```yaml
# /tmp/cnb-test.yml
$:
  api_trigger:
    - name: review-suite
      runner: {cpus: 8}
      docker: {build: {dockerfile: .ide/Dockerfile}}
      env: {PIP_DISABLE_PIP_VERSION_CHECK: "1"}
      stages:
        - name: install
          timeout: 45m
          script:
            - python -m pip install -U pip
            - python -m pip install -e ".[test]"
        - name: test
          timeout: 30m
          script: python -m pytest -o addopts="" -q -rs
        - name: smoke
          script: bash scripts/smoke.sh
```

```bash
cnb build start-build --repo wu2305/video-embed --branch review/2026-10-19 \
  --event api_trigger --config "$(cat /tmp/cnb-test.yml)" --title "suite"
# then poll and read the stage log:
cnb build get-build-status --repo wu2305/video-embed --sn <sn>
cnb build get-build-stage --repo wu2305/video-embed --sn <sn> \
  --pipelineId <sn>-001 --stageId stage-1
```

The stage log comes back as a JSON `content` array with ANSI codes and pip
progress bars inline; strip both before reading. A ready-made reader:

```bash
python3 -c "
import sys,re,json
raw=open(sys.argv[1]).read()
body=raw[raw.index('content['):].split(':',1)[1]
for s in re.findall(r'\"((?:[^\"\\\\]|\\\\.)*)\"', body, re.S):
    print(s.encode().decode('unicode_escape'))
" stage.log
```

### Run the query console in the container

```yaml
        - name: console
          timeout: 20m
          script: |
            set -e
            python scripts/serve.py --work-dir /opt/benchmark_work --port 8000 &
            server=$!
            trap 'kill $server 2>/dev/null || true' EXIT
            sleep 15
            curl -sf http://127.0.0.1:8000/api/info | head -c 400
            curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8000/
```

Needs an index at `--work-dir` first (`scripts/benchmark.py`, or point it at any
exported snapshot). For an interactive session instead of a build, start a CNB
dev workspace, run `serve.py` in its terminal, and open the URL it prints
(`CNB_VSCODE_PROXY_URI` filled with the port) or forward the port from the
WebIDE PORTS panel.

### Reproduce the sharpness measurement

```bash
.venv/bin/python - <<'PY'
import io, numpy as np, cv2
from PIL import Image
from sklearn.datasets import fetch_lfw_people
from mmindex.media import sharpness
lfw = fetch_lfw_people(min_faces_per_person=5, resize=1.0, color=True)
imgs = [(np.clip(im, 0, 1) * 255).astype(np.uint8) for im in lfw.images[:80]]
def wechat(a):                      # the benchmark's compressed_variants
    im = Image.fromarray(a); w, h = im.size
    im = im.resize((max(64, w // 2), max(64, h // 2)))
    b = io.BytesIO(); im.save(b, "JPEG", quality=35); b.seek(0)
    return np.asarray(Image.open(b).convert("RGB"), dtype=np.uint8)
def burst(a):                       # the benchmark's blurry_bursts
    return cv2.GaussianBlur(a[:, :, ::-1], (17, 17), 6)[:, :, ::-1]
for size in (None, 256):
    for name, f in (("wechat", wechat), ("burst", burst)):
        wins = sum(sharpness(a, size) > sharpness(f(a), size) for a in imgs)
        print(f"size={size} vs {name}: original sharper {wins}/{len(imgs)}")
PY
```

Expected: `size=None` gives 0/80 against wechat and 80/80 against burst;
`size=256` gives 80/80 for both. If the first line stops being 0/80, the
resolution artefact is gone and the fix may no longer be needed.

### Files this session added

| Path | Purpose |
|---|---|
| `scripts/serve.py` | query console (stdlib only) |
| `scripts/frame_bound_check.py` | proves 1024 px frames keep detections/OCR |
| `scripts/flickr_probe.py` | which Flickr30k mirror loads under `datasets` 5.x |
| `tests/test_sharpness.py` | metric, recorded scale, mixed-scale refusal |
| `tests/test_serve.py` | routes, filters, thumbnails, range semantics |
