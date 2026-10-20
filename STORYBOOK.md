# mmindex Storybook

User stories for turning the index from "search by what the pixels look like"
into "search by who is doing what". Each scene gives the user's goal, the flow,
what the repo does today, and what is missing. Status tags: **exists**,
**partial**, **new**.

The components for each scene are in the Storybook gallery under
[`storybook/`](storybook/README.md) (`cd storybook && npm install && npm run storybook`).
Its story groups are named after the scenes below.

Cast:

- **Mei**, an archivist with 77 k clips and photos and no time to watch them.
- **Dev**, an integrator whose app already has its own search API.

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
  `/api/source` over GET only. It has no write route.

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
  untagging one face moves it out.

**Edge cases**: a name shared by two people (use a stable `person_key` as well as
the display name); a face in cluster `-1` (noise) that Mei tags, which becomes a
seed for a new cluster; a re-cluster changes ids (names must be re-anchored by
prototype similarity, not by `person-NNNN`).

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
- A small query parser (`<name> is/are <what>`, `<what> with <name>`, plus a
  `--person` fallback). Start with rules; do not call an LLM on the hot path.
- Multiple people: `Ana and Ben are cooking` requires both
  (`person_ids ⊇ {Ana, Ben}`); `Ana or Ben` is the union.
- A prompt template so the *what* embeds well ("a photo of someone cooking").
  Check it against the benchmark before adopting it.

**Acceptance check**: with a fixture of three tagged people, the query
`Ana is cooking` returns no unit where Ana is absent, and ranks a cooking scene
above an Ana-only scene.

---

## Scene 4 — Images, and other APIs

> Mei's folder also holds JPEGs. Dev wants the same search from an existing
> product API.

**4a. Images**: *mostly exists.* `kind` already distinguishes video units from
images, and the pipeline indexes both. Gaps: the image has no `scene_start`, so
notes and previews must handle a null range; the console must show a still
instead of a player.

**4b. More media types** (audio-only, PDFs, screenshots): *new.* Each type is
a new `prepare` and `extract` implementation that emits the same unit record.
Everything downstream (infer, cluster, export, search) stays unchanged. Keep this
seam explicit by defining a `MediaHandler` protocol with `kinds`, `prepare` and
`extract`.

**4c. Plugging into an existing search API**: *new.* Two directions:

- **Inbound**: expose `/api/search` with a stable, versioned response
  (`/v1/search`), the same name/person/note fields, and a documented error shape,
  so another product can call mmindex.
- **Federated**: a `SearchSource` adapter interface (`search(query) → hits`)
  so mmindex can merge its hits with an external API's. Results are normalised to
  one hit shape (`source`, `id`, `score`, `preview_url`) and merged by rank
  fusion, not by comparing raw scores across systems.

Caveat: scores from different backends are not comparable. The current
`Index.check_backend` guard already rejects mixing embedding backends, and the
same rule applies to federation.

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

**Today**: *partial.* The console plays `/api/source` with HTTP range support and
shows a thumbnail grid. The grid card renders `<video muted preload="metadata">`
(`serve.py:399`). It does not seek to the matched scene.

**Missing**: the seek-and-loop preview, the face and note overlays from scenes 1
and 2, and keyboard navigation.

---

## Build order

| # | Step | Unlocks |
|---|------|---------|
| 1 | Persist face boxes and embeddings (infer + export) | Scene 1 |
| 2 | Sidecar store (`names`, `overrides`, `annotations`), merged at query time | Scenes 1, 2 |
| 3 | Name resolution and query parser | Scene 3 |
| 4 | Seek-and-loop preview, overlays | Scene 5 |
| 5 | `POST` tag and note routes, then `/v1/search` | Scenes 1, 2, 4c |
| 6 | `MediaHandler` protocol, `SearchSource` adapters | Scene 4 |

Step 1 changes what `infer` records, so existing checkpoints would need a
re-infer to gain boxes. Decide that cost before starting. The production
namespace `7d928ad0a65d18eab89b` is protected and must not be written by any of
this (`agents.md`, "Constraints that must be preserved").

## Not covered

Authentication and multi-user permissions for tagging, privacy rules for naming
people, and face-recognition consent. Naming faces is personal data, so these need
a decision before this ships outside a single-user setup.
