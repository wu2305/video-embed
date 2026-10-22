# Unified Search System — Architecture Design

*Finalized 2026-10-21. This is the target the repository is building toward.
`mmindex` (the code in `src/`) implements the NAS multimedia pipeline in
§3.1.2; the other sections describe the gateway and integrations around it.*

---

## 1. Business background and architectural objectives

The client's internal data assets are scattered across several heterogeneous
systems, creating isolated data silos. When a business line needs a specific
piece of material it has to query several systems one by one, and it is hard
to verify whether what comes back is relevant.

The system builds a **Unified Search Gateway** that hides the differences in
underlying storage and access control behind a single search entry point. The
goal is to make cross-domain material retrieval far faster and more precise.

It integrates three data sources:

| Source | Role | Constraint |
|---|---|---|
| **Archive System** | Third-party compliance archive | High confidentiality. Raw documents are never exposed; only cleansed, consolidated metadata can be queried. |
| **Intranet NAS (Synology)** | Multimedia asset pool | Historical promotional material and operational records: very large volumes of images, audio and video. |
| **WeCom (WeChat Work)** | Daily collaboration environment | Online documents and working material in departmental spaces and knowledge bases. |

## 2. Core technical pain points

- **Multimodal, heterogeneous data.** Search targets span structured metadata,
  unstructured documents (Word/PDF) and multimedia files. Formats are too
  fragmented for a single text-indexing solution to work.
- **Subsystem boundaries and access constraints.** Each system has strict
  physical or business isolation. The Archive System forbids fetching raw
  files. WeCom's open APIs only reach micro-drives created by self-built apps,
  so existing departmental spaces cannot be scanned across permissions.
- **Fragmented IAM.** Authorization granularity differs widely: WeCom uses
  fine-grained RBAC and per-user ACLs, the NAS relies on physical directories
  and user-group mappings, and the Archive System uses custom confidentiality
  visibility rules. Aligning privileges and federating authentication at the
  gateway is the core architectural hurdle.

## 3. Subsystem integration strategies and data pipelines

### 3.1 NAS: IAM foundation and multimedia search pipeline

Designed for the client's existing Synology DSM 7.2+ environment, covering
both access control and data processing.

#### 3.1.1 Prerequisite: centralized identity and access management

Business users mostly reach the NAS through Windows File Explorer (SMB). To
avoid maintaining two disjoint account systems for the gateway and the NAS,
permissions are centralized at the infrastructure layer:

- **SSO / directory service integration.** Integrate DSM directly with the
  enterprise's central authentication system (AD/LDAP or an enterprise IdP).
  Account lifecycle and read/write ACLs are managed globally from the central
  node or through DSM global group policies.
- **Protocol compatibility edge case.** Web SSO (OIDC/SAML) normally covers
  only the DSM web UI. To keep the existing "mount in File Explorer" workflow,
  the infrastructure must integrate through a directory service that supports
  NTLM/Kerberos (AD/LDAP). That gives the web gateway and the SMB shares the
  same source of authentication.

> **To be confirmed:** which central IdP does the client use today (AD, LDAP,
> or OIDC only)? This decides whether SMB compatibility is achievable.

#### 3.1.2 Multimedia vector search pipeline (POC phase)

Mounted multimedia directories go through an asynchronous ETL and embedding
pipeline that extracts multimodal features.

| Stage | Design | `mmindex` implementation |
|---|---|---|
| 1. Ingestion and cleansing | Fast hash + SHA-256 secondary validation for dedup. Normalize shooting time from EXIF, filesystem timestamps and filename conventions. | `scan` — xxhash64 candidate hash, SHA256 confirmation, canonical time EXIF → filename → mtime (`scan.py`, `hashing.py`) |
| 2. Feature extraction | **Video:** scene boundary detection; timestamped transcription with `faster-whisper`; one keyframe per scene. Inference may run on the full-size frame; what is stored is a compressed preview image (e.g. WebP), longest side capped at 1024 px, to keep storage and I/O small. **Vision:** SigLIP 768-d image vectors, InsightFace face detection + 512-d face vectors, RapidOCR on-screen text, perceptual hash, sharpness score. | `prepare`, `extract`, `infer` (`stages.py`, `backends.py`, `media.py`) |
| 3. Clustering and dimensionality guardrail | Person-level clustering with HDBSCAN. Above 20,000 faces in a batch, reduce to 64 dimensions first to prevent OOM. | `cluster` — `pca_threshold=20_000`, `pca_components=64` (`clustering.py`, `config.py`) |
| 4. Snapshot and atomic release | Persist to a unified snapshot (SQLite, FP16 vector matrix, person catalog). Run consistency checks, keep the sharpest duplicate as the primary version, switch atomically through a manifest with zero downtime. | `export` + `verify` (`export.py`) |
| 5. Hybrid search | Cosine similarity for base recall; `+0.15` when the query hits OCR or ASR text. Hard filters by person and by minimum face count. | `search` (`search.py`) |

**Spec deviation:** `extract` currently persists each keyframe as a
full-resolution `.npy` array. Using full-size frames for inference is
acceptable, but the artifact the index keeps should be a compressed preview
image (e.g. WebP, ≤1024 px longest side), not the raw frame.

See [`ARCHITECTURE.md`](../ARCHITECTURE.md) for the pipeline internals, the
CPU port and the distributed spot-worker design, and
[`BENCHMARK.md`](../BENCHMARK.md) for measured quality.

### 3.2 Archive System: metadata federated search

The Archive System is the compliance foundation. Its intake is tightly
controlled and it already receives auto-archived core documents (such as
contracts) from upstream workflow systems like OA. The gateway therefore does
**not** crawl it; it uses an **API federated search** model.

Before integration the third-party vendor must define and provide two API
contracts:

1. **Identity passthrough.** How the full-text search API accepts the
   caller's identity (specific headers, JWT, or SSO tickets), so the gateway
   can legitimately map the current operator onto the Archive System.
2. **Deep-link schema.** The standard URL structure and required parameters
   for redirecting a user from a search hit straight to the record's detail
   page in the Archive System.

### 3.3 WeCom: architectural trade-off and pruning strategy

WeCom online documents change very often and their permissions are extremely
granular (per-user ACLs). Keeping a highly available, strongly consistent
incremental index and permission sync (event callbacks plus frequent
permission re-fetches) would add disproportionate complexity and maintenance
cost.

**ADR — physical isolation by mutability.** For ROI and stability:

1. **High-frequency mutable data** (online docs, active drafts) is excluded
   from the unified index. Users search for it natively in WeCom.
2. **Low-frequency, static data** (finalized specs, settled knowledge assets)
   is moved to the NAS under an archiving protocol the business lines
   establish, where the NAS pipeline ingests it like any other material.

> **To be confirmed:** does the business side formally sign off on this
> pruning strategy (no dynamic WeCom indexing; manual or periodic archiving
> to NAS instead) to close the scope?

---

## 4. Operating model

*Proposed 2026-10-22. Decisions marked **To be confirmed** are still open.*

The NAS pipeline runs in two phases with different shapes. The main node plus
spot workers in [`ARCHITECTURE.md` §4](../ARCHITECTURE.md#4-distributed-spot-architecture)
fits only the first.

### 4.1 Phase 1 — historical backfill (one-off)

Batch-process the existing historical archive once.

- **Topology:** one stable coordinator node plus preemptible spot workers over
  shared storage and the SQLite lease queue. Stages run one at a time across
  every machine (`prepare` → `extract` → `infer`), then `cluster` and
  `export` run on the coordinator.
- **Why it fits:** the corpus is large and fixed, throughput matters more than
  latency, and spot capacity is cheap. Every stage is idempotent, so losing
  a machine costs at most the files it had in flight.
- **Why it does not fit steady state:** it assumes a closed file list. Every
  stage has to finish before the next one starts, clustering is a full
  HDBSCAN pass, and a run ends with one full export. New files would wait for
  the next full batch, and spinning up a spot fleet for a few hundred files a
  day costs more than it saves.
- **Exit criterion:** the backfill snapshot is published and `verify` passes.
  After that the spot fleet is retired; it comes back only for a full
  re-index, such as a model upgrade that invalidates every embedding.

### 4.2 Phase 2 — steady-state incremental ingestion

Keep the index current as business lines add material to the NAS, including
the WeCom static material archived under §3.3.

| Concern | Steady-state design |
|---|---|
| **Topology** | One always-on ingestion node on the intranet next to the NAS, with a read-only mount. No spot fleet and no shared work queue; the same stage functions run in-process. |
| **Change detection** | Two inputs feed one nightly batch. During the day, a DSM file-change hook only records new and modified paths in a pending list; it never starts processing. At night, an incremental `scan` diffs the tree against the previous `manifest.jsonl` and merges in the pending list, which catches anything the hook missed. The fast hash is the change key, so unchanged files are skipped by the checkpoint. |
| **Deletes and moves** | Files missing from the new manifest are tombstoned, and the next snapshot drops their units. A move is a delete plus an add under the same digest, so the checkpoint reuses the existing features and nothing is re-inferred. |
| **Per-file processing** | Embedding runs only in the nightly window, so daytime NAS and CPU load is untouched. Within the window, `prepare` → `extract` → `infer` run file by file in a pipeline instead of stage by stage, so a file added today is searchable the next morning. |
| **Person clustering** | New faces are assigned to the nearest existing person prototype within a distance threshold; unmatched faces wait in a pending pool. A full HDBSCAN re-cluster runs on a slower cadence (e.g. weekly) to merge and split persons and absorb the pending pool. |
| **Publishing** | Each cycle exports a new snapshot from the checkpoint and switches `index_manifest.json` atomically, as today. Readers never see a partial index. The last *N* snapshots are kept for rollback. |
| **Failure handling** | A file that fails is retried on the next cycle and marked failed after *k* attempts. A cycle with failures still publishes the files that succeeded. |
| **Monitoring** | Per cycle: files added, changed and deleted, failures, cycle duration, snapshot id, and `verify` result. Alert when a cycle fails `verify` or nothing has been published for longer than the expected cadence. |

> **Decided 2026-10-22:** ingestion runs nightly. The DSM hook is used, but
> only to queue changes; embedding is triggered at night.
>
> **Proposed, not yet confirmed:** a weekly full re-cluster.

### 4.3 Run procedures

| Procedure | Trigger | Steps |
|---|---|---|
| Backfill | One-off, or a full re-index | Start coordinator → `scan` → enqueue each stage to spot workers → `cluster` → `export` → `verify` → retire workers |
| Incremental cycle | Nightly | Merge the DSM hook's pending list with an incremental `scan` → per-file pipeline for new and changed files → prototype assignment → `export` → `verify` → atomic switch |
| Full re-cluster | Weekly (proposed) | HDBSCAN over all faces → rebuild prototypes → `export` → `verify` → atomic switch |
| Rollback | Bad snapshot reported | Point `index_manifest.json` back at the previous snapshot |
| Model upgrade | New embedding model | New checkpoint namespace → backfill under that namespace → switch once `verify` and the benchmark pass. Old and new vectors are never mixed. |

---

## 5. Permission model

### 5.1 Principle: index broadly, filter per user at query time

The ingestion side must read everything it indexes, so the index itself holds
material that not every user may see. Permissions are therefore enforced on
every query at the gateway, never by limiting what gets indexed. The gateway
returns a hit only if the caller could open the source item directly.

### 5.2 Per-source enforcement

| Source | Where permissions live | Enforcement |
|---|---|---|
| **NAS** | DSM shared folders and directory ACLs, mapped to directory groups (§3.1.1) | At ingestion, record for each file the directory groups allowed to read it, taken from its share and directory ACLs. At query time, the gateway resolves the caller's groups from the IdP and keeps only units whose allowed groups intersect them. |
| **Archive System** | Vendor's confidentiality visibility rules | The gateway passes the caller's identity through (§3.2) and the vendor filters. The gateway stores nothing from the Archive. |
| **WeCom** | Per-user ACLs | Not applicable. Live data is not indexed (§3.3); archived material inherits the ACLs of the NAS folder it lands in. |

### 5.3 Keeping NAS permissions current

- ACLs are re-read on every incremental scan, so a permission change takes
  effect at the next published snapshot even when the file itself did not
  change.
- Group membership is resolved live from the IdP on each query, not stored in
  the index, so adding or removing a user from a group takes effect
  immediately.
- When a file's ACL cannot be read, its units are excluded from results
  rather than shown to everyone (fail closed).

### 5.4 Service accounts

| Account | Access | Used by |
|---|---|---|
| Ingestion | Read-only on the indexed NAS shares, plus read of their ACLs | Ingestion node |
| Index writer | Write to the snapshot directory and `index_manifest.json` | Ingestion node only |
| Gateway | Read-only on published snapshots; IdP group lookup; Archive API client | Search gateway |

Users never touch the index files directly. All access goes through the
gateway, which logs each query with the caller's identity for audit.

> **Decided 2026-10-22:** directory-level ACLs are enough at this stage;
> per-file ACLs are out of scope.
>
> **To be confirmed:** whether the audit log must meet a specific retention
> policy.

---

## Open items

| Item | Owner | Blocks |
|---|---|---|
| Central IdP type (AD / LDAP / OIDC only) | Client IT | §3.1.1 SMB-compatible SSO |
| Identity passthrough spec | Archive vendor | §3.2 federated search |
| Deep-link URL schema | Archive vendor | §3.2 result redirects |
| Sign-off on WeCom pruning ADR | Business side | §3.3 scope closure |
| Store keyframes as compressed previews (e.g. WebP) instead of raw `.npy` | This repo | §3.1.2 stage 2 spec deviation |
| Document (Word/PDF) parsing on NAS | Not yet designed | §2 heterogeneous data, §3.3 archived WeCom docs |
| DSM hook pending list, nightly incremental scan with tombstones, per-file pipeline, prototype assignment | This repo | §4.2 steady state |
| ACL capture at scan and query-time group filtering | This repo | §5.2 NAS enforcement |
| Audit log retention policy | Client IT | §5.4 query audit |
