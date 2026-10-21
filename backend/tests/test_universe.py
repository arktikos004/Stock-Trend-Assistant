"""PIT 成分股：重放事件表得到任一日期的成分股集合，且事件表必須自洽。

倖存者偏誤的修法本身也可能出錯——重放順序弄反、事件漏了一筆，
都會安靜地給出一份「看起來很合理」的錯名單。這裡把自洽性檢查釘死。
"""

from datetime import date, timedelta

import pandas as pd
import pytest

from stockta.config import DATA_CACHE_DIR, MARKET_INDEX_TICKER, STOCK_POOL, STOCK_POOL_ASOF
from stockta.data.universe import (
    EVENTS_PATH,
    INDEX_SIZE,
    UniverseError,
    all_tickers_ever,
    coverage_start,
    last_review_effective,
    load_anchor,
    members_asof,
    membership_frame,
    pool_staleness,
    third_friday,
    validate,
)

pytestmark = pytest.mark.leakage

_SOURCE = "https://example.invalid/review/2020Q1"


def _write_events(tmp_path, rows: list[tuple[str, str, str]], review: str = "臨時調整"):
    """rows = [(生效日, 代號, add|drop)]。

    review 預設「臨時調整」：合成資料用的是隨手挑的日期，不該冒充定期審核——
    定期審核的生效日受「當月第三個星期五」規則約束，validate() 會檢查。
    要驗那條規則的測試自己傳 review="定期審核"。
    """
    path = tmp_path / "events.csv"
    lines = ["effective_date,ticker,action,review,source_url,name,note"]
    for effective_date, ticker, action in rows:
        lines.append(f"{effective_date},{ticker},{action},{review},{_SOURCE},,")
    path.write_text("\n".join(lines), encoding="utf-8")
    return path


def _initial_fifty(effective_date="2005-01-01"):
    return [(effective_date, f"{1000 + i}.TW", "add") for i in range(INDEX_SIZE)]


def test_members_asof_replays_events_in_order(tmp_path):
    path = _write_events(
        tmp_path,
        [
            *_initial_fifty(),
            ("2010-06-18", "1000.TW", "drop"),
            ("2010-06-18", "9999.TW", "add"),
        ],
    )

    before = members_asof(date(2010, 6, 17), path)
    on_the_day = members_asof(date(2010, 6, 18), path)  # 收盤後才生效：當天仍是舊名單
    after = members_asof(date(2010, 6, 21), path)

    assert "1000.TW" in before and "9999.TW" not in before
    assert on_the_day == before
    assert "9999.TW" in after and "1000.TW" not in after
    assert len(before) == len(after) == INDEX_SIZE


def test_members_before_coverage_raise(tmp_path):
    """涵蓋起日之前的名單不完整，拿去回測會安靜地出錯——直接拋錯。"""
    path = _write_events(tmp_path, _initial_fifty("2005-01-01"))

    with pytest.raises(UniverseError, match="早於"):
        members_asof(date(2004, 12, 31), path)


def test_same_day_add_and_drop_apply_together(tmp_path):
    """同日的納入與剔除必須一起套用，中途不得出現 49 或 51 檔。"""
    path = _write_events(
        tmp_path,
        [*_initial_fifty(), ("2010-06-18", "1000.TW", "drop"), ("2010-06-18", "9999.TW", "add")],
    )

    assert validate(path, sessions=()) == []


def test_validate_catches_a_missing_add(tmp_path):
    """剔除一檔卻沒有對應的納入 → 規模掉到 49，必須被抓到。"""
    path = _write_events(tmp_path, [*_initial_fifty(), ("2010-06-18", "1000.TW", "drop")])

    problems = validate(path, sessions=())

    assert len(problems) == 1
    assert "49 檔" in problems[0]


def test_validate_catches_an_extra_add(tmp_path):
    path = _write_events(tmp_path, [*_initial_fifty(), ("2010-06-18", "9999.TW", "add")])

    problems = validate(path, sessions=())

    assert len(problems) == 1
    assert "51 檔" in problems[0]


def test_dropping_a_non_member_is_an_error(tmp_path):
    """順序矛盾（先剔除後納入）必須炸，不能安靜地給出錯名單。"""
    path = _write_events(tmp_path, [*_initial_fifty(), ("2010-06-18", "8888.TW", "drop")])

    with pytest.raises(UniverseError, match="順序矛盾"):
        members_asof(date(2011, 1, 1), path)


def test_adding_an_existing_member_is_an_error(tmp_path):
    path = _write_events(tmp_path, [*_initial_fifty(), ("2010-06-18", "1000.TW", "add")])

    with pytest.raises(UniverseError, match="重複"):
        members_asof(date(2011, 1, 1), path)


def test_source_url_is_mandatory(tmp_path):
    """沒有出處的列不准進表——這份資料的價值完全建立在可查證上。"""
    path = tmp_path / "events.csv"
    path.write_text(
        "effective_date,ticker,action,review,source_url,note\n"
        "2010-06-18,1000.TW,add,定期審核,,\n",
        encoding="utf-8",
    )

    with pytest.raises(UniverseError, match="source_url"):
        members_asof(date(2011, 1, 1), path)


def test_all_tickers_ever_includes_delisted_names(tmp_path):
    """曾入榜但已被剔除的代號也要在清單裡——只抓現存成分股就是倖存者偏誤。"""
    path = _write_events(
        tmp_path,
        [*_initial_fifty(), ("2010-06-18", "1000.TW", "drop"), ("2010-06-18", "9999.TW", "add")],
    )

    ever = all_tickers_ever(path)

    assert "1000.TW" in ever  # 已被剔除，仍在清單內
    assert len(ever) == INDEX_SIZE + 1


def test_coverage_start_is_when_the_index_first_fills(tmp_path):
    path = _write_events(tmp_path, _initial_fifty("2005-01-01"))

    assert coverage_start(path) == date(2005, 1, 2)  # 收盤後生效：次日起才是完整名單


def test_membership_frame_shape_and_values(tmp_path):
    path = _write_events(
        tmp_path,
        [*_initial_fifty(), ("2010-06-18", "1000.TW", "drop"), ("2010-06-18", "9999.TW", "add")],
    )
    dates = ["2010-06-18", "2010-06-21"]

    frame = membership_frame(dates, path)

    assert frame.shape == (2, INDEX_SIZE + 1)
    assert frame.loc["2010-06-18", "1000.TW"]
    assert not frame.loc["2010-06-21", "1000.TW"]
    assert frame.loc["2010-06-21", "9999.TW"]
    # 每一天都必須恰好 50 檔
    assert (frame.sum(axis=1) == INDEX_SIZE).all()


def test_missing_events_file_gives_an_actionable_error(tmp_path):
    with pytest.raises(FileNotFoundError, match="人工策展"):
        members_asof(date(2020, 1, 1), tmp_path / "nope.csv")


# === 每季調整的排程：過期的池子必須藏不住 ===================================


@pytest.mark.parametrize(
    "year,month,expected",
    [
        (2024, 12, date(2024, 12, 20)),  # FTSE 公告：after close of Friday 20 Dec 2024
        (2026, 3, date(2026, 3, 20)),  # FTSE 公告：after close of Friday 20 Mar 2026
        (2025, 12, date(2025, 12, 19)),  # 中央社：2025-12-19 生效
        (2026, 6, date(2026, 6, 19)),
    ],
)
def test_third_friday_matches_published_review_dates(year, month, expected):
    """對照三份實際公告驗證排程算式，不是憑印象寫的。"""
    assert third_friday(year, month) == expected


def test_last_review_effective_walks_back_across_the_year_boundary():
    # 2026-01 還沒到 3 月審核，最近一次是 2025-12
    assert last_review_effective(date(2026, 1, 15)) == date(2025, 12, 19)
    # 生效日當天算已生效
    assert last_review_effective(date(2026, 3, 20)) == date(2026, 3, 20)
    # 生效日前一天則回到上一季
    assert last_review_effective(date(2026, 3, 19)) == date(2025, 12, 19)


def test_pool_staleness_counts_missed_reviews():
    """成分股每季換，所以『多久沒核對』本身就是要監看的量。"""
    missed, latest = pool_staleness(date(2025, 7, 1), today=date(2026, 8, 16))

    # 2025-09、2025-12、2026-03、2026-06 共四次
    assert missed == 4
    assert latest == date(2026, 6, 19)


def test_pool_staleness_is_zero_right_after_a_review():
    missed, _ = pool_staleness(date(2026, 6, 19), today=date(2026, 6, 20))

    assert missed == 0


def test_validate_flags_a_periodic_review_on_the_wrong_date(tmp_path):
    """定期審核的生效日必是當月第三個星期五——抄錯一週要被抓出來（沒有交易日曆時只能用這條規則）。"""
    path = _write_events(
        tmp_path,
        [*_initial_fifty(), ("2026-06-12", "1000.TW", "drop")],
        review="定期審核",
    )

    problems = validate(path, sessions=())

    assert any("第三個星期五" in p and "2026-06-19" in p for p in problems)


# === 錨點、審核清單與休市日 ===================================================

FIFTY = [f"{1000 + i}.TW" for i in range(INDEX_SIZE)]
# 2026 年的交易日：平日扣掉端午節（6/19）
SESSIONS = frozenset(d.date() for d in pd.bdate_range("2026-01-02", "2026-10-30")) - {date(2026, 6, 19)}


def _write_anchor(tmp_path, as_of: str, tickers):
    lines = ["as_of,ticker,name,source_url,note", *(f"{as_of},{t},,{_SOURCE}," for t in tickers)]
    (tmp_path / "tw50_anchor.csv").write_text("\n".join(lines), encoding="utf-8")


def _write_reviews(tmp_path, rows):
    lines = ["effective_date,n_changes,source_url,note", *(f"{d},{n},{_SOURCE}," for d, n in rows)]
    (tmp_path / "tw50_reviews.csv").write_text("\n".join(lines), encoding="utf-8")


def _anchored(tmp_path, anchor=None, reviews=None):
    """2026-03 換 1000→9999、2026-06（端午節提前到 6/18）換 1001→8888、2026-09 沒有異動，錨點 2026-09-30。"""
    path = _write_events(
        tmp_path,
        [
            ("2026-03-20", "1000.TW", "drop"),
            ("2026-03-20", "9999.TW", "add"),
            ("2026-06-18", "1001.TW", "drop"),
            ("2026-06-18", "8888.TW", "add"),
        ],
        review="定期審核",
    )
    current = [t for t in FIFTY if t not in ("1000.TW", "1001.TW")] + ["9999.TW", "8888.TW"]
    _write_anchor(tmp_path, "2026-09-30", current if anchor is None else anchor)
    _write_reviews(tmp_path, reviews if reviews is not None else [("2026-03-20", 1), ("2026-06-18", 1), ("2026-09-18", 0)])
    return path


def test_seed_is_derived_backward_from_the_anchor(tmp_path):
    path = _anchored(tmp_path)

    assert members_asof(date(2026, 3, 20), path) == set(FIFTY)  # 審核當天仍是推回去的起點名單
    after = members_asof(date(2026, 3, 23), path)
    assert "9999.TW" in after and "1000.TW" not in after


def test_forward_replay_reproduces_the_anchor(tmp_path):
    path = _anchored(tmp_path)

    assert members_asof(date(2026, 9, 30), path) == set(load_anchor(path).members)


def test_anchored_table_with_a_holiday_friday_validates(tmp_path):
    assert validate(_anchored(tmp_path), sessions=SESSIONS) == []


def test_holiday_friday_review_moves_to_previous_session(tmp_path):
    """2026-06-19 端午節休市，審核提前到 6/18；沒有交易日曆時無從得知，只能照第三個星期五判。"""
    path = _anchored(tmp_path)

    assert validate(path, sessions=SESSIONS) == []
    assert any("2026-06-18" in p and "2026-06-19" in p for p in validate(path, sessions=()))


def test_regular_review_must_be_the_friday(tmp_path):
    path = _write_events(tmp_path, [*_initial_fifty(), ("2026-03-19", "1000.TW", "drop"), ("2026-03-19", "9999.TW", "add")], review="定期審核")

    assert any("2026-03-19" in p and "2026-03-20" in p for p in validate(path, sessions=SESSIONS))


def test_ad_hoc_change_must_be_a_session(tmp_path):
    path = _write_events(tmp_path, [*_initial_fifty("2026-01-02"), ("2026-05-02", "1000.TW", "drop"), ("2026-05-02", "9999.TW", "add")])

    assert any("2026-05-02" in p and "不是交易日" in p for p in validate(path, sessions=SESSIONS))


def test_anchor_conflict_is_reported(tmp_path):
    """錨點沒有 2026-03 納入的 9999.TW：往回推時矛盾，必須說出來。"""
    anchor = [t for t in FIFTY if t != "1001.TW"] + ["8888.TW"]
    path = _anchored(tmp_path, anchor=anchor)

    assert any("錨點矛盾" in p for p in validate(path, sessions=SESSIONS))


def test_missing_review_is_reported(tmp_path):
    """漏列 2026-06 那一次：清單跳季，而且事件表有這一次的異動。"""
    path = _anchored(tmp_path, reviews=[("2026-03-20", 1), ("2026-09-18", 0)])

    problems = validate(path, sessions=SESSIONS)
    assert any("漏列" in p for p in problems)
    assert any("2026-06-18" in p and "沒有列" in p for p in problems)


def test_review_counts_must_match_the_events(tmp_path):
    path = _anchored(tmp_path, reviews=[("2026-03-20", 2), ("2026-06-18", 1), ("2026-09-18", 0)])

    assert any("2026-03-20" in p and "納入 1、剔除 1" in p for p in validate(path, sessions=SESSIONS))


def test_anchored_members_before_coverage_raise(tmp_path):
    with pytest.raises(UniverseError, match="早於"):
        members_asof(date(2026, 3, 19), _anchored(tmp_path))


def test_the_anchor_file_matches_the_configured_pool():
    """錨點檔與 config.STOCK_POOL 是同一份核對結果，不能各改各的。"""
    anchor = load_anchor(EVENTS_PATH)

    assert anchor.members == frozenset(STOCK_POOL)
    assert anchor.as_of == date.fromisoformat(STOCK_POOL_ASOF)


_TWII = DATA_CACHE_DIR / f"{MARKET_INDEX_TICKER.lstrip('^')}.parquet"


@pytest.mark.skipif(not _TWII.exists(), reason="需要本機的大盤快取當交易日曆（CI 沒有）")
def test_real_event_table_is_consistent():
    assert validate() == []
    start = coverage_start()
    for day in (start, date.fromisoformat(STOCK_POOL_ASOF), date.fromisoformat(STOCK_POOL_ASOF) + timedelta(days=21)):
        assert len(members_asof(day)) == INDEX_SIZE
