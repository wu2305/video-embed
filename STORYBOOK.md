# Unified Search — frontend design spec

User stories for the console of the Unified Search Gateway
([`docs/UNIFIED_SEARCH_DESIGN.md`](docs/UNIFIED_SEARCH_DESIGN.md)). The console
is one search box over two sources: the NAS media library, which `mmindex`
indexes, and the Archive System, which is searched live through its vendor API.
Within the NAS it turns "search by what the pixels look like" into "search by
who is doing what". Each scene gives the user's goal, the flow, what the repo
does today, and what is missing. Status tags: **exists**, **partial**, **new**.

*Updated 2026-10-22 to match the design doc: two sources fused into one list
(scene 4c), per-user permission filtering at query time (scene 6), and nightly
ingestion, so files show up the morning after they land (scene 7).*

The components for each scene are in the Storybook gallery under
[`storybook/`](storybook/README.md) (`cd storybook && npm install && npm run storybook`).
Its story groups are named after the scenes below.

Cast:

- **Mei**, an archivist in Marketing with 77 k clips and photos and no time to
  watch them. She signs in with her company account.
- **Raj**, in Finance. He runs the same searches and must not see Marketing's
  restricted folders, nor Mei his.
- **Dev**, an integrator whose app already has its own search API.

Facts about the gateway that shape every scene (design doc §3–5):

- **Two sources, one list.** NAS media comes from the `mmindex` snapshot.
  Archive System records come from the vendor's full-text API on every query;
  the gateway stores nothing from the Archive and never fetches the document,
  so an Archive result is metadata plus a deep link, never a preview.
- **WeCom is not a source.** Live WeCom documents are excluded by design (ADR,
  §3.3); users search them in WeCom. Finalized WeCom material is archived to the
  NAS and is found as NAS media.
- **Everyone signs in, and sees only what they could open.** The gateway
  resolves the caller's directory groups from the IdP on every query and keeps
  a NAS unit only if its folder ACL allows one of them. The Archive filters its
  own results through identity passthrough. A unit whose ACL could not be read
  is hidden from everyone (fail closed). Queries are logged with the caller's
  identity.
- **The NAS index is updated nightly.** A DSM hook queues changes during the
  day; the nightly cycle embeds them and publishes a new snapshot atomically.
  A file added this morning is searchable tomorrow morning, and a permission
  change on a folder applies from the next snapshot.
- **Keyframes are compressed previews.** `/api/thumb` serves the stored WebP
  preview (longest side ≤1024 px), not the full-size frame.

Facts about the current code that shape every scene:

- A *unit* is one scene keyframe (or one image). `units` stores `face_count`,
  `person_ids`, `ocr_text`, `asr_text`, `scene_start/end`
  (`src/mmindex/export.py:35`). It stores **no face bounding boxes**.
- People exist only as anonymous clusters, `person-0003` etc.
  (`src/mmindex/clustering.py:93`). Nothing carries a name.
- A published snapshot is immutable and swapped atomically. User-written data
  therefore cannot go in it. It needs a sidecar store that is merged at query
  time and survives a re-export.
- The console (`scripts/serve.py`) serves `/api/search`, `/api/thumb` and
  `/api/source` over GET only. It has no write route, no sign-in and no
  permission check: today anyone who can reach it sees everything.

---

## Scene 1 — Name a face

> Mei sees a face she recognises and wants every appearance to carry the name
> "Ana Ruiz".

**Flow**

1. Mei opens a result. The preview shows the keyframe with a box around each
   detected face.
2. She clicks one box and types "Ana Ruiz" (autocomplete offers existing names).
3. The console asks: *apply to all 212 appearances in cluster person-0003?*
   She confirms, or applies it to this face only.
4. Every unit in that cluster now shows "Ana Ruiz" as its person.

**Today**: *partial.* `--person person-0003` filters by cluster id, and
`Index.persons()` lists clusters with `sample_refs`.

**Missing**

- Persist face boxes at infer time (a per-unit `faces` table: unit, face index,
  bbox, 512-d embedding). Without boxes there is nothing to click.
- A `person_names` sidecar table: `person_id → name`, plus
  `face_overrides` for single-face corrections.
- A write route, `POST /api/tag`, with `{unit_id, face_index, name, scope}`.
- Merge or split handling: tagging two clusters with the same name merges them;
  untagging one face moves it out. A merge is its own action in the console,
  never a side effect of *Apply name*: the button reads *Merge into Ana Ruiz*,
  a confirm step names both cluster ids and the combined appearance count, and
  the saved line offers *Undo merge*. The write route needs a matching undo
  (`DELETE` of the merge, or a merge log), because names are shared.

**Edge cases**: a name shared by two people (use a stable `person_key` as well as
the display name); a face in cluster `-1` (noise) that Mei tags, which becomes a
seed for a new cluster; a re-cluster changes ids (names must be re-anchored by
prototype similarity, not by `person-NNNN`).

**With the gateway** (design doc §4.2, §5):

- Counts are per viewer. "212 appearances" counts only units Mei may open, so
  Raj can see a smaller number for the same person, and a cluster with no
  visible appearance is not listed for him at all.
- Names are shared. A name Mei applies shows for everyone who can see that
  person, and the People page says so. Who may name or rename is still open
  (anyone signed in, or a curator group).
- New faces arrive nightly. Each one joins the nearest existing person, or waits
  in a pending pool until the next full re-cluster (weekly, proposed). The People
  page shows how many faces are pending so a missing appearance is explained. The
  re-cluster is when names must be re-anchored.

---

## Scene 2 — Write on the video

> Mei notes that "Ana is presenting the Q3 budget" at 01:12–01:40 of a clip.

**Flow**

1. While previewing, Mei pauses, presses *Add note*, and types text.
2. The note attaches to a time range (default: the current scene), or to a single
   image.
3. Optionally she picks people already in frame ("with Ana Ruiz").
4. The note appears as an overlay on the preview and is searchable.

**Today**: *new.* OCR and ASR text are searched with a fixed 0.15 bonus
(`search.py:3`), but they are machine-written and read-only.

**Missing**

- An `annotations` sidecar table: `path, digest, t_start, t_end, text, author,
  created_at`. Key by digest so a moved file keeps its notes.
- Join notes into `units` by overlap with `scene_start/scene_end`.
- Treat a note as stronger evidence than OCR or ASR. Start with a separate bonus
  (e.g. 0.25), tuned on the benchmark.
- Overlay rendering in the preview (a text track, not burned into the file).

**With the gateway**: a note is visible to everyone who can open its file, so it
inherits the file's folder ACL at query time, and its author is the signed-in
user's directory name rather than a free-text field. Notes live in the sidecar
store and appear at once; they do not wait for the nightly snapshot.

**Open question**: "type onto the video" is read here as a *note attached to a
time range*. If you mean *burn text into exported pixels*, that is a separate
render feature (ffmpeg `drawtext`) and does not affect search.

---

## Scene 3 — "Ana is cooking"

> Mei types `Ana Ruiz is cooking` and gets only the scenes where Ana appears and
> cooking is happening.

**Flow**

1. The query is split into a **who** and a **what**:
   `[Ana Ruiz]` → `person_id`, `cooking` → text and image embedding.
2. The index narrows candidates to units containing Ana's cluster, then ranks
   them by SigLIP similarity to "cooking" plus the text bonus (OCR, ASR, notes).
3. Results show the matched name, the score breakdown and the matched scene
   range.

**Today**: *partial.* `Index.search(text=..., person_id=...)` already combines a
person filter with similarity and a text bonus. It just needs the name and the
parser.

**Missing**

- Name resolution: `Ana`, `Ana Ruiz` and an alias all map to one person; an
  unknown name returns "no such person" rather than silently searching text.
- A small query parser (`<name> is/are <what>`, `<what> with <name>`). Start
  with rules; do not call an LLM on the hot path. People are only ever named in
  the query; the console has no person-id picker, since a query can name
  several people and users never see cluster ids.
- Multiple people: `Ana and Ben are cooking` requires both
  (`person_ids ⊇ {Ana, Ben}`); `Ana or Ben` is the union.
- A prompt template so the *what* embeds well ("a photo of someone cooking").
  Check it against the benchmark before adopting it.

**Across sources**: the who/what split applies to the NAS only, because names are
NAS face clusters. The gateway sends the Archive System the *what* as plain text
("cooking"), so a query that names a person still returns matching Archive
records alongside Ana's clips.

**Acceptance check**: with a fixture of three tagged people, the query
`Ana is cooking` returns no unit where Ana is absent, and ranks a cooking scene
above an Ana-only scene.

---

## Scene 4 — More media, more sources

> Mei's folder also holds JPEGs and audio. The contract for the cooking class
> lives in the Archive System, not on the NAS. Dev wants the same search from an
> existing product API.

**4a. Images**: *mostly exists.* `kind` already distinguishes video units from
images, and the pipeline indexes both. Gaps: the image has no `scene_start`, so
notes and previews must handle a null range; the console must show a still
instead of a player.

**4b. More media types** (audio-only, Word/PDF documents, screenshots): *new.*
Each type is a new `prepare` and `extract` implementation that emits the same unit
record. Everything downstream (infer, cluster, export, search) stays unchanged.
Keep this seam explicit by defining a `MediaHandler` protocol with `kinds`,
`prepare` and `extract`. Document parsing on the NAS is not designed yet (design
doc open items); it matters most for archived WeCom material.

**4c. The Archive System**: *new.* Every query goes to the NAS index and to the
vendor's full-text API in parallel.

1. Results come back as one list, fused by rank (reciprocal rank fusion), never
   by comparing raw scores: NAS cosine scores and the vendor's relevance are on
   different scales. The current `Index.check_backend` guard already rejects
   mixing embedding backends, and the same rule applies here.
2. An Archive card shows the title, record type, archive date, department, the
   vendor's summary and the record id. It has no thumbnail, no score and no
   preview. Its title is a link that opens the record in the Archive System
   (deep-link schema, §3.2), which checks access again.
3. When both sources return results, cards carry a source badge (*NAS*,
   *Archive*) and a source filter appears: all, NAS media, Archive.
4. If the Archive API errors or times out, the NAS results still show with a
   warning that the list is incomplete. The reverse holds too.

**4d. WeCom**: *by design, not a source.* Live WeCom documents are searched in WeCom; finalized material archived to
the NAS shows up here as NAS media. The first-visit page (a centred search home: brand, one field and
the index freshness line) carries no explanatory copy about this.

**4e. Plugging into an existing search API**: *new.* Expose `/api/search` with a
stable, versioned response (`/v1/search`), the same name/person/note fields, and
a documented error shape, so another product can call the gateway. The caller
must pass the end user's identity, and results are filtered for that user exactly
as in scene 6; a service account alone gets nothing back.

---

## Scene 5 — Preview the result

> Mei clicks a hit and sees the exact moment, not a file name.

**Flow**

1. Clicking a hit opens a preview that **seeks to `scene_start`** and loops to
   `scene_end`.
2. Face boxes with names, the matched note, and the OCR/ASR snippet sit beside it.
3. Prev/next steps through hits without closing the preview.
4. *Open in folder* and *copy path* are shown, and nothing else that touches
   files.
5. The preview is a modal dialog: it takes focus on open, keeps Tab inside,
   closes on Esc, makes the page behind it inert and unscrollable, and returns
   focus to the card on close.

**Today**: *partial.* The console plays `/api/source` with HTTP range support and
shows a thumbnail grid. The grid card renders `<video muted preload="metadata">`
(`serve.py:399`). It does not seek to the matched scene.

**Missing**: the seek-and-loop preview, the face and note overlays from scenes 1
and 2, and keyboard navigation.

**With the gateway**:

- Only NAS hits open the preview. Archive cards open the Archive System, and
  prev/next skips them.
- `/api/source` checks the caller's permission live. If a file's folder ACL
  changed after last night's snapshot, the preview shows *You no longer have
  access to this file* and hides the frame, people, text and *Open clip* (fail
  closed). If the file was deleted or moved since, it says so; a moved file
  reappears under its new path after the next cycle.

---

## Scene 6 — Only what you may open

> Mei and Raj both search "budget". Mei must not see Finance's minutes; Raj must
> not see Marketing's restricted footage. Neither should be able to tell the
> other's results exist.

**Flow**

1. Opening the console signs Mei in through the company IdP. There is no
   anonymous access. The top bar shows her name; hovering it lists the directory
   groups the gateway resolved, which answers "why can't I see it".
2. She searches. Every NAS unit is kept only if its folder's allowed groups
   intersect hers; Archive results are already filtered by the vendor for her
   identity.
3. The results show only what she may open, with no note about filtering. The
   page never shows how many results were hidden, because a count leaks that
   they exist.
4. If a hit's permissions changed today, the preview refuses it (scene 5).

**Today**: *new.* Nothing records ACLs, and the console has no sign-in.

**Missing**

- Capture each file's allowed directory groups at scan time (directory-level
  ACLs only, as decided), and store them per unit in the snapshot.
- Resolve the caller's groups from the IdP on every query, not from a cache in
  the index, so a membership change applies at once.
- Filter at the gateway before ranking and before counting, including the
  People page counts and the "appears in" lists.
- Identity passthrough to the Archive API (vendor spec to be confirmed, §3.2).
- A permission check in `/api/source` and `/api/thumb`, not only in search.
- A query audit log with the caller's identity (retention policy to be
  confirmed).

**Acceptance check**: with a fixture of two folders and two users, neither user's
results, People counts, thumbnails or source URLs include a unit from the other's
folder, and a unit with an unreadable ACL appears for neither.

---

## Scene 7 — Today's files, tomorrow morning

> Mei uploads the launch rehearsal at 10:00 and searches for it at 10:05.

**Flow**

1. The top bar always shows how fresh the NAS index is: *77,412 items · updated
   today 02:40*. On the search home that line sits under the search field instead.
2. Her search finds nothing. The empty state says that files added to the NAS
   today become searchable tomorrow morning, so it does not read as broken. The
   first-visit page says the same.
3. Next morning the rehearsal is found; nothing else changed for her.
4. If the nightly cycle has not published for longer than its cadence, every
   page shows a *stale* warning with the last update date. Results are still
   correct for older files.

**Today**: *new.* The snapshot is published by hand after a full batch run.

**Missing**: the incremental nightly cycle (DSM hook pending list, incremental
scan with tombstones, per-file pipeline, prototype assignment, atomic publish,
design doc §4.2), and a gateway endpoint that reports the snapshot id, its
publish time and the next scheduled run.

---

## Build order

| # | Step | Unlocks |
|---|------|---------|
| 1 | Sign-in through the IdP; per-unit ACL groups at scan; query-time filtering in search, thumbnails and source | Scene 6, and every scene outside a single-user setup |
| 2 | Nightly incremental cycle; snapshot publish time in the API | Scene 7 |
| 3 | Persist face boxes and embeddings (infer + export) | Scene 1 |
| 4 | Sidecar store (`names`, `overrides`, `annotations`), merged at query time and filtered by ACL | Scenes 1, 2 |
| 5 | Name resolution and query parser | Scene 3 |
| 6 | Seek-and-loop preview, overlays, unavailable states | Scene 5 |
| 7 | Archive System adapter with identity passthrough; rank fusion | Scene 4c (blocked on the vendor's API specs) |
| 8 | `POST` tag and note routes, then `/v1/search` | Scenes 1, 2, 4e |
| 9 | `MediaHandler` protocol for new kinds | Scene 4b |

Step 1 comes first because naming faces and writing notes are personal data
that must not be shown across folders. Step 3 changes what `infer` records, so
existing checkpoints would need a re-infer to gain boxes. Decide that cost before
starting. The production namespace `7d928ad0a65d18eab89b` is protected and must
not be written by any of this (`agents.md`, "Constraints that must be
preserved").

## Open questions for the console

| Question | Blocks |
|---|---|
| Who may name or rename a person: anyone signed in, or a curator group? | Scene 1 |
| Can a user see who else wrote a note, or only that a note exists? | Scene 2 |
| The Archive vendor's response fields and deep-link schema | Scene 4c (`ArchiveRecord` in the gallery is a guess) |
| Does the weekly full re-cluster go ahead? It decides how long faces stay pending. | Scenes 1, 7 |

## Not covered

Privacy rules for naming people, and face-recognition consent. Naming faces is
personal data, so these need a decision before naming ships, even with
permission filtering in place.
