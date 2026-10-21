"""線上成績的分組與不確定區間：只決定怎麼呈現，不改變 monitor.py 依預先聲明判定的狀態。

- **寫入時間**：預測窗口從基準日的下一個交易日開盤（台北 09:00）起算。在那之前寫入資料庫或串入存證鏈的列，
  寫入時還看不到窗口內的任何價格；之後才寫入的（隔天補記、模型訓練完成後回補）另外標示。
  下一個交易日取實際交易日（大盤指數有 K 棒的日子，連假與颱風假不在裡面）；資料還沒到那一天時
  （尚未到期）以下一個平日近似，只會偏嚴、不會偏鬆。
- **相對強弱的三組成績**：即時記錄（live 且在窗口開始前寫入）、事後重建或補寫（pit，或窗口開始後才寫入的 live）、
  預測窗口開始前就已串入存證鏈（sealed）。
- **方向訊號的命中率**：同一批樣本的兩條基線（全猜觀望、全猜漲）與各訊號精度；95% 區間用以基準日為單位、
  區塊長度 5 的 circular block bootstrap（同一天的股票彼此相關，相鄰基準日的 5 日報酬重疊）。
"""

from __future__ import annotations

from bisect import bisect_right
from collections import Counter
from collections.abc import Iterable, Sequence
from datetime import date, datetime, time, timedelta, timezone

import numpy as np

from stockta.stats import newey_west

TAIPEI = timezone(timedelta(hours=8))
MARKET_OPEN = time(9, 0)
BOOTSTRAP_BLOCK = 5  # 與預測期一致
BOOTSTRAP_REPS = 2000
BOOTSTRAP_SEED = 20261012  # 固定種子：同一份資料每次匯出的區間相同
SIGNALS = ("漲", "跌", "觀望")


def window_opens(base_date: date, sessions: Sequence[date] = ()) -> datetime:
    """預測窗口開始的時間：基準日之後第一個交易日的台北 09:00。

    sessions＝已知的交易日（遞增）；基準日之後還沒有交易日資料時，以下一個平日近似。
    """
    i = bisect_right(sessions, base_date)
    if i < len(sessions):
        day = sessions[i]
    else:
        day = base_date + timedelta(days=1)
        while day.weekday() >= 5:
            day += timedelta(days=1)
    return datetime.combine(day, MARKET_OPEN, tzinfo=TAIPEI)


def written_before_window(base_date: date, written_at: datetime, sessions: Sequence[date] = ()) -> bool:
    return written_at < window_opens(base_date, sessions)


def parse_time(iso: str) -> datetime:
    """資料庫與鏈檔的 ISO 時間（含時區）。"""
    return datetime.fromisoformat(iso)


def link_spans(chain: Sequence[dict], table: str) -> list[tuple[int, int, datetime]]:
    """某張表在每一節涵蓋的 id 區間 (after_id, to_id] 與該節的寫入時間。"""
    spans = []
    for entry in chain:
        span = (entry.get("ranges") or {}).get(table) or {}
        if "after_id" in span and "to_id" in span and entry.get("recorded_at"):
            spans.append((span["after_id"], span["to_id"], parse_time(entry["recorded_at"])))
    return spans


def chained_at(row_id: int, spans: Sequence[tuple[int, int, datetime]]) -> datetime | None:
    for after_id, to_id, recorded_at in spans:
        if after_id < row_id <= to_id:
            return recorded_at
    return None


def sealed_base_dates(
    rows: Iterable[tuple[int, str]], spans: Sequence[tuple[int, int, datetime]], sessions: Sequence[date] = ()
) -> set[str]:
    """rows＝[(id, 基準日)]：回傳「每一列都在預測窗口開始前串入存證鏈」的基準日。"""
    ok: dict[str, bool] = {}
    for row_id, base_date in rows:
        at = chained_at(row_id, spans)
        sealed = at is not None and written_before_window(date.fromisoformat(base_date), at, sessions)
        ok[base_date] = ok.get(base_date, True) and sealed
    return {d for d, sealed in ok.items() if sealed}


def ic_group(days: Sequence[tuple[date, float]]) -> dict:
    """一組逐日 Rank IC 的天數、平均與 Newey–West t（落後 4 期）。"""
    ics = [ic for _, ic in days]
    out = {"n_days": len(ics), "mean_ic": None, "t_nw": None, "first_day": None, "last_day": None}
    if not ics:
        return out
    out.update(first_day=min(d for d, _ in days), last_day=max(d for d, _ in days), mean_ic=float(np.mean(ics)))
    if len(ics) >= 2:
        mean, se = newey_west(ics)
        out["t_nw"] = mean / se if se > 0 else None
    return out


def _block_indices(n_days: int, rng: np.random.Generator) -> np.ndarray:
    """circular block bootstrap：隨機選起點，每段連續 BOOTSTRAP_BLOCK 個基準日（超過尾端就繞回開頭），湊滿 n_days 天。"""
    blocks = -(-n_days // BOOTSTRAP_BLOCK)
    starts = rng.integers(0, n_days, size=blocks)
    idx = (starts[:, None] + np.arange(BOOTSTRAP_BLOCK)[None, :]).ravel() % n_days
    return idx[:n_days]


def _interval(values: np.ndarray) -> tuple[float, float]:
    lo, hi = np.percentile(values, [2.5, 97.5])
    return float(lo), float(hi)


def hit_sample(records: Sequence[tuple[str, str, str]]) -> dict:
    """records＝[(基準日, 預測訊號, 實際訊號)]（已到期）。

    命中率、兩條基線（這批樣本裡實際為「觀望」「漲」的比例＝全猜觀望、全猜漲的命中率）與差距、
    各訊號的精度（喊了之後對的比例），以及命中率與兩個差距的 95% block bootstrap 區間。
    """
    n = len(records)
    out: dict = {
        "matured": n,
        "hits": 0,
        "hit_rate": None,
        "n_days": 0,
        "actual": dict.fromkeys(SIGNALS, 0),
        "baseline_hold": None,
        "baseline_up": None,
        "precision": {s: {"called": 0, "hits": 0} for s in SIGNALS},
        "ci_hit_rate": None,
        "ci_excess_hold": None,
        "ci_excess_up": None,
    }
    if n == 0:
        return out
    actual = Counter(a for _, _, a in records)
    out["actual"] = {s: actual.get(s, 0) for s in SIGNALS}
    for _, called, a in records:
        out["precision"][called]["called"] += 1
        out["precision"][called]["hits"] += called == a
    hits = sum(c == a for _, c, a in records)
    out.update(hits=hits, hit_rate=hits / n, baseline_hold=actual.get("觀望", 0) / n, baseline_up=actual.get("漲", 0) / n)

    by_day: dict[str, list[int]] = {}
    for d, c, a in records:
        cell = by_day.setdefault(d, [0, 0, 0, 0])  # 筆數、命中、實際觀望、實際漲
        cell[0] += 1
        cell[1] += c == a
        cell[2] += a == "觀望"
        cell[3] += a == "漲"
    days = np.array([by_day[d] for d in sorted(by_day)], dtype=float)
    out["n_days"] = len(days)
    if len(days) < 2:
        return out
    rng = np.random.default_rng(BOOTSTRAP_SEED)
    draws = np.empty((BOOTSTRAP_REPS, 3))
    for i in range(BOOTSTRAP_REPS):
        total, hit, hold, up = days[_block_indices(len(days), rng)].sum(axis=0)
        draws[i] = (hit / total, (hit - hold) / total, (hit - up) / total)
    out["ci_hit_rate"], out["ci_excess_hold"], out["ci_excess_up"] = (_interval(draws[:, k]) for k in range(3))
    return out
