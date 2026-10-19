from __future__ import annotations


import random
import time

import numpy as np

from mmindex.config import Settings
from mmindex.export import _band_layout, _popcount, near_duplicates


def _unit(dhash: str, sharpness: float) -> dict:
    return {"dhash": dhash, "sharpness": sharpness}


def test_band_layout_covers_every_bit_once():
    for bands in (1, 4, 7, 8, 64):
        layout = _band_layout(bands)
        assert len(layout) == bands
        covered = []
        for shift, width in layout:
            covered.extend(range(shift, shift + width))
        assert covered == list(range(64)), bands


def test_popcount_matches_python():
    import random

    rng = random.Random(3)
    values = [0, 1, (1 << 64) - 1] + [rng.getrandbits(64) for _ in range(200)]
    counts = _popcount(np.array(values, dtype=np.uint64)).tolist()
    assert counts == [bin(v).count("1") for v in values]


def test_near_duplicates_match_when_prefix_differs():
    """Regression: near-dups differing in the high bits must still group.

    The previous prefix-only bucketing missed any pair whose first 32 bits
    differed, even at hamming distance 1.
    """
    settings = Settings()
    settings.near_dup_hamming = 6
    units = [
        _unit("ffffffffffffffff", 10.0),
        _unit("fffffffffffffffe", 1.0),
    ]
    masters = near_duplicates(units, settings)
    assert masters[0] is True
    assert masters[1] is False


def test_near_duplicates_keep_sharpest_master():
    settings = Settings()
    settings.near_dup_hamming = 6
    units = [
        _unit("0000000000000000", 1.0),
        _unit("0000000000000001", 50.0),
    ]
    masters = near_duplicates(units, settings)
    assert masters[1] is True
    assert masters[0] is False


def test_near_duplicates_respects_hamming_threshold():
    settings = Settings()
    settings.near_dup_hamming = 2
    # 8 bits apart: far beyond the threshold, so both stay masters.
    units = [
        _unit("0000000000000000", 10.0),
        _unit("00000000000000ff", 1.0),
    ]
    masters = near_duplicates(units, settings)
    assert masters == {0: True, 1: True}


def test_near_duplicates_transitive_grouping():
    """A~B and B~C puts all three in one group with a single master."""
    settings = Settings()
    settings.near_dup_hamming = 4
    units = [
        _unit("0000000000000000", 5.0),
        _unit("0000000000000001", 1.0),
        _unit("0000000000000003", 2.0),
    ]
    masters = near_duplicates(units, settings)
    assert masters[0] is True
    assert masters[1] is False
    assert masters[2] is False


def test_near_duplicates_keeps_member_above_sharpness_ratio():
    settings = Settings()
    settings.near_dup_hamming = 6
    settings.near_dup_sharpness_ratio = 0.9
    units = [
        _unit("0000000000000000", 10.0),
        _unit("0000000000000001", 9.5),
    ]
    masters = near_duplicates(units, settings)
    assert masters == {0: True, 1: True}


def test_near_duplicates_ignores_missing_hash():
    settings = Settings()
    units = [{"sharpness": 1.0}, {"sharpness": 2.0}]
    assert near_duplicates(units, settings) == {0: True, 1: True}


def _flip(value: int, bits) -> int:
    for bit in bits:
        value ^= 1 << bit
    return value


def test_every_pair_within_threshold_is_grouped():
    """Pigeonhole guarantee: no pair within ``near_dup_hamming`` bits is missed.

    Regression: bands used to index only the low 16 bits, so pairs at hamming
    4-6 were missed whenever each low nibble differed.
    """
    settings = Settings()
    settings.near_dup_hamming = 6
    rng = random.Random(11)
    for flips in range(1, 7):
        for _ in range(150):
            base = rng.getrandbits(64)
            other = _flip(base, rng.sample(range(64), flips))
            units = [_unit(f"{base:016x}", 100.0), _unit(f"{other:016x}", 1.0)]
            assert near_duplicates(units, settings)[1] is False, (flips, base, other)


def test_adversarial_flips_in_every_low_nibble_are_grouped():
    settings = Settings()
    settings.near_dup_hamming = 6
    base = 0x0123456789ABCDEF
    other = _flip(base, [0, 4, 8, 12])
    units = [_unit(f"{base:016x}", 100.0), _unit(f"{other:016x}", 1.0)]
    assert near_duplicates(units, settings) == {0: True, 1: False}


def test_pair_just_over_threshold_is_not_grouped():
    settings = Settings()
    settings.near_dup_hamming = 6
    base = 0x0123456789ABCDEF
    other = _flip(base, [1, 9, 17, 25, 33, 41, 49])
    units = [_unit(f"{base:016x}", 100.0), _unit(f"{other:016x}", 1.0)]
    assert near_duplicates(units, settings) == {0: True, 1: True}


def test_matches_brute_force_reference():
    """Grouping equals an O(n^2) union of every pair within the threshold."""
    from mmindex.media import hamming

    settings = Settings()
    settings.near_dup_hamming = 6
    rng = random.Random(5)
    units = []
    for _ in range(120):
        base = rng.getrandbits(64)
        units.append(_unit(f"{base:016x}", rng.uniform(1, 100)))
        for _ in range(rng.randint(0, 3)):
            other = _flip(base, rng.sample(range(64), rng.randint(0, 8)))
            units.append(_unit(f"{other:016x}", rng.uniform(1, 100)))

    parent = list(range(len(units)))

    def find(node):
        while parent[node] != node:
            parent[node] = parent[parent[node]]
            node = parent[node]
        return node

    for i in range(len(units)):
        for j in range(i + 1, len(units)):
            if hamming(units[i]["dhash"], units[j]["dhash"]) <= settings.near_dup_hamming:
                parent[find(j)] = find(i)
    groups: dict[int, list[int]] = {}
    for i in range(len(units)):
        groups.setdefault(find(i), []).append(i)
    expected = {i: True for i in range(len(units))}
    for group in groups.values():
        best = max(group, key=lambda i: units[i]["sharpness"])
        for member in group:
            if member != best and units[member]["sharpness"] < units[best]["sharpness"] * 0.9:
                expected[member] = False

    assert near_duplicates(units, settings) == expected


def test_scales_to_tens_of_thousands_of_units():
    """Regression: candidate pairs used to be ~23% of all pairs (quadratic set)."""
    settings = Settings()
    rng = random.Random(1)
    units = [_unit(f"{rng.getrandbits(64):016x}", 1.0) for _ in range(30_000)]
    started = time.time()
    masters = near_duplicates(units, settings)
    assert time.time() - started < 20
    assert sum(masters.values()) >= 29_900  # random hashes essentially never collide


def test_many_identical_hashes_form_one_group():
    settings = Settings()
    units = [_unit("0" * 16, float(i + 1)) for i in range(2_000)]
    masters = near_duplicates(units, settings)
    assert masters[1_999] is True  # sharpest wins
    assert sum(masters.values()) < 2_000
