"""模型監控與例外報表（docs/monitor_prereg.md v1）：Newey–West、失效判定、分位遷移、52 週新高新低。

門檻與定義是預先聲明的（依期刊文獻）；這裡把文件寫的每一條釘死。洩漏測試：基準日之後的價格不影響結果。
"""

from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from stockta import monitor
from stockta.monitor import model_health, newey_west, quintile, quintile_moves, week52

AS_OF = date(2026, 10, 6)


def _days(ics: list[float]) -> list[tuple[date, float]]:
    start = date(2026, 7, 1)
    return [(start + timedelta(days=i), ic) for i, ic in enumerate(ics)]


def test_newey_west_matches_the_textbook_formula():
    x = [0.1, -0.2, 0.3, 0.05, -0.1, 0.2]
    mean, se = newey_west(x, lags=0)
    assert mean == pytest.approx(np.mean(x))
    assert se == pytest.approx(np.sqrt(np.var(x) / len(x)))  # 落後 0 期＝母體變異數 / T

    e = np.array(x) - np.mean(x)
    T = len(x)
    s = e @ e / T + 2 * (1 - 1 / 3) * (e[1:] @ e[:-1]) / T + 2 * (1 - 2 / 3) * (e[2:] @ e[:-2]) / T
    assert newey_west(x, lags=2)[1] == pytest.approx(np.sqrt(s / T))


def test_newey_west_widens_the_error_for_overlapping_returns():
    """相鄰基準日的 5 日報酬重疊 → 逐日 IC 正自我相關 → HAC 標準誤比樸素的大（t 變小）。"""
    rng = np.random.default_rng(0)
    shocks = rng.normal(0, 0.2, 205)
    overlapping = np.convolve(shocks, np.ones(5) / 5, mode="valid")  # 5 日移動平均＝重疊
    _, naive = newey_west(overlapping, lags=0)
    _, hac = newey_west(overlapping, lags=4)
    assert hac > 1.5 * naive


def test_model_health_statuses():
    assert model_health(_days([0.05] * 19), 0.04)["status"] == "insufficient"

    rng = np.random.default_rng(1)
    good = list(0.05 + rng.normal(0, 0.05, 60))
    h = model_health(_days(good), 0.0437)
    assert h["status"] == "normal" and h["t_skill"] > 2 and h["n_days"] == 60

    broken = list(-0.15 + rng.normal(0, 0.05, 60))
    h = model_health(_days(broken), 0.0437)
    assert h["status"] == "breakdown" and h["t_breakdown"] < monitor.BREAKDOWN_T

    # 整體與回測相符，只有最近 20 日轉負：只是「留意」，不是失效
    recent_dip = list(0.10 + rng.normal(0, 0.02, 40)) + list(-0.02 + rng.normal(0, 0.01, 20))
    h = model_health(_days(recent_dip), 0.0437)
    assert h["status"] == "watch" and h["recent_mean_ic"] < 0
    assert h["thresholds"] == {"breakdown_t": -1.645, "min_days": 20, "recent_days": 20, "nw_lags": 4, "skill_t": [2.0, 3.0]}


def test_quintiles_follow_the_declared_cut_points():
    n = 49
    sizes = [sum(quintile(r, n) == q for r in range(1, n + 1)) for q in range(1, 6)]
    assert sizes == [10, 10, 10, 10, 9]
    assert quintile(1, n) == 1 and quintile(10, n) == 1 and quintile(11, n) == 2 and quintile(49, n) == 5


def test_quintile_moves_tag_entries_exits_and_jumps():
    tickers = [f"{1000 + i}.TW" for i in range(20)]
    before = {t: 1.0 - i / 20 for i, t in enumerate(tickers)}  # 1000 最強……1019 最弱
    now = dict(before)
    now["1000.TW"], now["1010.TW"] = 0.30, 0.99  # 第 1 分位掉到第 4；第 3 分位跳到第 1
    moves = {m["ticker"]: m for m in quintile_moves(now, before)}
    assert set(moves["1000.TW"]["tags"]) == {"leave_top", "jump"}
    assert set(moves["1010.TW"]["tags"]) == {"enter_top", "jump"}
    assert moves["1010.TW"]["q_before"] == 3 and moves["1010.TW"]["q_now"] == 1
    assert all(m["tags"] for m in moves.values())
    # 只比兩天都有分數的股票
    assert "9999.TW" not in {m["ticker"] for m in quintile_moves({**now, "9999.TW": 1.5}, before)}


def _closes(values, end: date = AS_OF) -> pd.Series:
    return pd.Series(np.asarray(values, dtype=float), index=pd.bdate_range(end=pd.Timestamp(end), periods=len(values)))


def test_week52_new_high_and_low():
    flat = [100.0] * 260
    assert week52(_closes(flat + [101.0]), AS_OF) == {"new_high": True, "new_low": False, "to_high": 1.0}
    low = week52(_closes(flat + [99.0]), AS_OF)
    assert low["new_low"] and not low["new_high"] and low["to_high"] == pytest.approx(0.99)
    assert week52(_closes([100.0] * 250), AS_OF) is None  # 不足 251 個交易日


@pytest.mark.leakage
def test_week52_ignores_prices_after_the_base_date():
    rng = np.random.default_rng(3)
    past = _closes(100 + rng.normal(0, 1, 300).cumsum())
    future = pd.Series(np.full(20, 1e6), index=pd.bdate_range(start=pd.Timestamp(AS_OF) + timedelta(days=1), periods=20))
    assert week52(pd.concat([past, future]), AS_OF) == week52(past, AS_OF)
