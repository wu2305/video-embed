from __future__ import annotations

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
