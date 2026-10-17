"""換股票池：回補不跨越換池日，歷史紀錄的名稱不因移出股票池而消失。

每個基準日的排序只能用當天生效的股票池：若換池後的第一次排程把新納入的股票
回補到換池前的基準日，那幾天的橫斷面會混進兩份名單，Rank IC 與成績都會失真。
"""

from datetime import date

import pandas as pd

from stockta.config import FORMER_POOL_NAMES, STOCK_POOL, stock_name
from stockta.data.calendar import backfill_sessions


def test_backfill_never_reaches_before_the_pool_change():
    sessions = pd.DatetimeIndex(["2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-19"])
    got = backfill_sessions(sessions, 5, not_before=date(2026, 10, 19))
    assert [d.date() for d in got] == [date(2026, 10, 19)]


def test_backfill_keeps_the_full_window_after_the_change():
    sessions = pd.DatetimeIndex(["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-11-02"])
    got = backfill_sessions(sessions, 5, not_before=date(2026, 10, 19))
    assert [d.date() for d in got] == [date(2026, 10, 27), date(2026, 10, 28), date(2026, 10, 29), date(2026, 10, 30), date(2026, 11, 2)]


def test_removed_stocks_keep_their_names_for_old_records():
    assert stock_name("2330.TW") == STOCK_POOL["2330.TW"]
    assert stock_name("1101.TW") == "台泥"
    assert stock_name("9999.TW") == ""
    assert not set(FORMER_POOL_NAMES) & set(STOCK_POOL)
