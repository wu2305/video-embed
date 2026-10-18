from __future__ import annotations


from mmindex.config import Settings
from mmindex.export import _band_keys, near_duplicates


def _unit(dhash: str, sharpness: float) -> dict:
    return {"dhash": dhash, "sharpness": sharpness}


def test_band_keys_split_into_four_bands():
    keys = _band_keys("0123456789abcdef")
    assert len(keys) == 4
    assert len({key.split(":")[0] for key in keys}) == 4


def test_band_keys_empty_hash():
    assert _band_keys("") == []


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


def test_band_keys_cover_every_pair_within_hamming():
    """Pigeonhole guarantee: any pair within 3 bits shares at least one band."""
    settings = Settings()
    settings.near_dup_hamming = 3
    base = 0x0123456789ABCDEF
    for bit in range(64):
        other = base ^ (1 << bit)
        units = [_unit(f"{base:016x}", 1.0), _unit(f"{other:016x}", 2.0)]
        masters = near_duplicates(units, settings)
        assert masters[0] is False, f"bit {bit} was not grouped"
