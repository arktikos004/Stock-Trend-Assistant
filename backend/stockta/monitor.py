"""模型監控與例外報表：規則見 docs/monitor_prereg.md（版本 RULES_VERSION）。

- **模型失效警示**：採 Giacomini & Rossi (2009) 的 forecast breakdown——線上（樣本外）逐日 Rank IC
  減回測（樣本內）IC 的平均，以 Newey–West HAC 標準誤（Bartlett kernel、落後 4 期，因為相鄰基準日的
  5 日報酬重疊）檢定是否顯著為負。最近 20 日平均為負只是描述性的「留意」，不是檢定。
- **例外報表**：排名分位遷移（往前第 5 個基準日 → 今天；文獻以分位數投組檢驗排序、以成員變動衡量換手）、
  52 週新高新低（George & Hwang, 2004）。

只顯示、不自動停用或替換模型。這裡都是純函式；讀資料庫與價格的部分在 api/routers/monitor.py。
"""

from __future__ import annotations

import statistics
from collections.abc import Sequence
from datetime import date

import numpy as np
import pandas as pd

RULES_VERSION = "v1"
RULES_DOC = "docs/monitor_prereg.md"

NW_LAGS = 4  # 預測期 5 日 − 1
MIN_DAYS = 20  # 已到期交易日少於此數不判定
BREAKDOWN_T = -1.645  # 單尾 5%
RECENT_DAYS = 20  # 描述性提示：最近 20 日平均
SKILL_T = (2.0, 3.0)  # 慣例顯著門檻；Harvey, Liu & Zhu (2016) 的新因子門檻
QUINTILES = 5
MIGRATION_SESSIONS = 5  # 與模型的預測期一致
WEEK52 = 250  # 交易日


def newey_west(x: Sequence[float], lags: int = NW_LAGS) -> tuple[float, float]:
    """平均與其 Newey–West HAC 標準誤（Bartlett kernel：權重 1 − l／(lags + 1)）。"""
    a = np.asarray(x, dtype=float)
    n = len(a)
    e = a - a.mean()
    s = float(e @ e) / n
    for lag in range(1, min(lags, n - 1) + 1):
        s += 2 * (1 - lag / (lags + 1)) * float(e[lag:] @ e[:-lag]) / n
    return float(a.mean()), float(np.sqrt(max(s, 0.0) / n))


def model_health(days: Sequence[tuple[date, float]], backtest_ic: float | None) -> dict:
    """days＝[(基準日, 當日 Rank IC)]（已到期、IC 可算的日子，依日期排序）。回傳狀態與統計量。"""
    ics = [ic for _, ic in days]
    n = len(ics)
    out: dict = {
        "status": "insufficient",
        "n_days": n,
        "backtest_ic": backtest_ic,
        "mean_ic": None,
        "se_nw": None,
        "t_skill": None,
        "t_breakdown": None,
        "recent_mean_ic": statistics.fmean(ics[-RECENT_DAYS:]) if ics else None,
        "thresholds": {
            "breakdown_t": BREAKDOWN_T,
            "min_days": MIN_DAYS,
            "recent_days": RECENT_DAYS,
            "nw_lags": NW_LAGS,
            "skill_t": list(SKILL_T),
        },
    }
    if n < 2:
        return out
    mean, se = newey_west(ics)
    out.update(mean_ic=mean, se_nw=se)
    if se > 0:
        out["t_skill"] = mean / se
        if backtest_ic is not None:
            out["t_breakdown"] = (mean - backtest_ic) / se
    if n < MIN_DAYS:
        return out
    if out["t_breakdown"] is not None and out["t_breakdown"] < BREAKDOWN_T:
        out["status"] = "breakdown"
    elif out["recent_mean_ic"] is not None and out["recent_mean_ic"] < 0:
        out["status"] = "watch"
    else:
        out["status"] = "normal"
    return out


def quintile(rank: int, n: int) -> int:
    """名次（1＝最強）→ 五分位（1＝前 20%）：⌊(名次 − 1) × 5 ÷ n⌋ + 1。"""
    return (rank - 1) * QUINTILES // n + 1


def _ranks(scores: dict[str, float]) -> dict[str, int]:
    ordered = sorted(scores, key=lambda t: (-scores[t], t))  # 同分依代號，結果可重現
    return {t: i + 1 for i, t in enumerate(ordered)}


def quintile_moves(now: dict[str, float], before: dict[str, float]) -> list[dict]:
    """兩個基準日都有分數的股票之間比分位：進入／離開第 1 分位，或分位變動 ≥ 2。"""
    common = sorted(set(now) & set(before))
    if not common:
        return []
    rank_now, rank_before = _ranks({t: now[t] for t in common}), _ranks({t: before[t] for t in common})
    n = len(common)
    moves = []
    for t in common:
        q_now, q_before = quintile(rank_now[t], n), quintile(rank_before[t], n)
        tags = []
        if q_before != 1 and q_now == 1:
            tags.append("enter_top")
        if q_before == 1 and q_now != 1:
            tags.append("leave_top")
        if abs(q_now - q_before) >= 2:
            tags.append("jump")
        if tags:
            moves.append(
                {"ticker": t, "rank_now": rank_now[t], "rank_before": rank_before[t], "q_now": q_now, "q_before": q_before, "tags": tags}
            )
    return sorted(moves, key=lambda m: (m["q_now"] - m["q_before"], m["rank_now"]))


def week52(close: pd.Series, as_of: date) -> dict | None:
    """只用 as_of 當天或以前的收盤價；不足 251 個交易日回 None。to_high＝收盤價 ÷ 52 週最高價（含當日）。"""
    s = close[close.index <= pd.Timestamp(as_of)].dropna()
    if len(s) < WEEK52 + 1:
        return None
    last = float(s.iloc[-1])
    prior = s.iloc[-1 - WEEK52 : -1]
    high, low = float(prior.max()), float(prior.min())
    return {"new_high": last > high, "new_low": last < low, "to_high": last / max(high, last)}
