from __future__ import annotations

import numpy as np

from mmindex.stages import _scene_text


def _prepared(words, spans):
    return {
        "asr_text": " ".join(words),
        "scenes": [
            {"index": index, "start": start, "end": end, "midpoint": (start + end) / 2}
            for index, (start, end) in enumerate(spans)
        ],
    }


def test_scene_text_slices_by_time_window():
    words = [f"w{i}" for i in range(10)]
    prepared = _prepared(words, [(0.0, 2.0), (2.0, 4.0), (4.0, 6.0)])
    assert _scene_text(prepared, 0).split() == words[0:3]
    assert _scene_text(prepared, 1).split() == words[3:6]
    assert _scene_text(prepared, 2).split() == words[6:10]


def test_scene_text_returns_full_transcript_for_single_scene():
    prepared = _prepared(["hello", "world"], [(0.0, 5.0)])
    assert _scene_text(prepared, 0) == "hello world"


def test_scene_text_handles_empty_transcript():
    assert _scene_text({"asr_text": "", "scenes": []}, 0) == ""


def test_scene_text_handles_zero_duration():
    prepared = _prepared(["a", "b"], [(0.0, 0.0)])
    assert _scene_text(prepared, 0) == "a b"


def test_scene_text_clamps_out_of_range_index():
    prepared = _prepared([f"w{i}" for i in range(4)], [(0.0, 1.0), (1.0, 2.0)])
    assert _scene_text(prepared, 99) == "w2 w3"


def _segmented(spans, segments):
    return {
        "schema": 2,
        "asr_text": " ".join(s["text"] for s in segments),
        "asr_segments": segments,
        "scenes": [
            {"index": index, "start": start, "end": end, "midpoint": (start + end) / 2}
            for index, (start, end) in enumerate(spans)
        ],
    }


def test_scene_text_uses_segment_timings_not_word_counts():
    """Regression: text was spread pro rata, so a long scene that is mostly
    silence still received words spoken entirely in a different scene."""
    prepared = _segmented(
        [(0.0, 10.0), (10.0, 12.0)],
        [
            {"start": 9.5, "end": 10.5, "text": "spoken at the boundary"},
            {"start": 11.0, "end": 11.8, "text": "second scene only"},
        ],
    )
    # Pro rata would give the 10 s scene five of six words; timings give one segment.
    assert _scene_text(prepared, 0) == "spoken at the boundary"
    assert _scene_text(prepared, 1) == "spoken at the boundary second scene only"


def test_scene_text_drops_segments_in_a_gap():
    prepared = _segmented(
        [(0.0, 2.0), (8.0, 10.0)],
        [{"start": 4.0, "end": 5.0, "text": "in the gap"}],
    )
    assert _scene_text(prepared, 0) == ""
    assert _scene_text(prepared, 1) == ""


def test_scene_text_with_segments_but_no_scenes():
    prepared = _segmented([], [{"start": 0.0, "end": 1.0, "text": "x"}])
    assert _scene_text(prepared, 0) == ""


def test_scene_text_segmented_single_scene_returns_everything():
    prepared = _segmented(
        [(0.0, 0.0)],
        [
            {"start": 0.0, "end": 1.0, "text": "one"},
            {"start": 1.0, "end": 2.0, "text": "two"},
        ],
    )
    assert _scene_text(prepared, 0) == "one two"


class _RecordingBackend:
    """Hash backend that reports which frames it saw, in order."""

    name = "hash"

    def __init__(self):
        self.seen: list[int] = []

    def embed_images(self, images):
        self.seen.extend(int(image[0, 0, 0]) for image in images)
        return np.ones((len(images), 4), dtype=np.float32)

    def detect_faces(self, images):
        return [[] for _ in images]

    def ocr(self, images):
        return ["" for _ in images]


def _entry_and_layout(tmp_path, layout, settings, frame_indices, scenes, segments):
    from mmindex.media import save_frame
    from mmindex.scan import ManifestEntry
    from mmindex.stages import frame_path

    entry = ManifestEntry(
        path=str(tmp_path / "clip.mp4"),
        rel_path="clip.mp4",
        kind="video",
        size=1,
        digest="d" * 16,
        fast_digest="f",
        canonical_time=0.0,
        mtime=0.0,
    )
    frames = []
    for index in frame_indices:
        target = frame_path(layout, entry, index)
        image = np.full((8, 8, 3), index, dtype=np.uint8)
        save_frame(target, image, settings.frame_max_edge, settings.frame_jpeg_quality)
        frames.append({"index": index, "file": str(target), "timestamp": 0.0, "width": 8, "height": 8})
    prepared = {
        "schema": 2,
        "scenes": scenes,
        "asr_segments": segments,
        "asr_text": " ".join(s["text"] for s in segments),
    }
    return entry, {"frames": frames}, prepared


def test_infer_aligns_units_to_frame_index_after_a_dropped_scene(
    tmp_path, layout, settings
):
    """Regression: units were indexed by list position, so a scene whose frame
    failed to decode shifted every later unit onto the wrong scene and text."""
    from mmindex.checkpoint import IncrementalCheckpoint
    from mmindex.stages import infer_entry

    scenes = [
        {"index": i, "start": float(i * 2), "end": float(i * 2 + 2), "midpoint": float(i * 2 + 1)}
        for i in range(3)
    ]
    segments = [
        {"start": 0.0, "end": 2.0, "text": "scene zero"},
        {"start": 2.0, "end": 4.0, "text": "scene one"},
        {"start": 4.0, "end": 6.0, "text": "scene two"},
    ]
    entry, extracted, prepared = _entry_and_layout(
        tmp_path, layout, settings, [0, 2], scenes, segments
    )
    store = IncrementalCheckpoint(layout.checkpoint_db, stage="infer", auto_sync=False)
    try:
        record = infer_entry(
            entry, layout, settings, store, _RecordingBackend(), extracted=extracted, prepared=prepared
        )
    finally:
        store.close(sync=False)

    units = record["units"]
    assert [u["unit_index"] for u in units] == [0, 2]
    assert [u["scene_start"] for u in units] == [0.0, 4.0]
    assert [u["asr_text"] for u in units] == ["scene zero", "scene two"]
