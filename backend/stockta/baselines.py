"""簡單因子對照與可成交性：規則見 docs/baseline_prereg.md（版本 RULES_VERSION）。

- **和簡單因子比**：短期反轉、20 日與 60 日動量。主要檢定是中和後 Rank IC——每天把模型的名次分數
  對三個因子的名次分數做截面迴歸，取殘差和 5 日報酬的 Spearman 相關；各因子自己的 IC、模型減因子的
  IC 差與兩者的相關只描述。
- **可成交版 Rank IC**：排序在收盤後才寫入，報酬改從 t+1 收盤起算到 t+6 收盤。
- **還要多久**：若真實 IC 等於回測，t 的期望值到 2 所需的已到期天數。
- **前 20% 與後 20% 的實際報酬**：即時記錄的基準日、可成交版報酬、等權、不扣成本。

這裡都是純函式；讀資料庫與價格的部分在 api/routers/monitor.py。
"""

from __future__ import annotations

import math
from collections.abc import Sequence
from dataclasses import dataclass
from datetime import date

import numpy as np
from scipy.stats import rankdata, spearmanr

from stockta.config import LABEL_HORIZON_DAYS
from stockta.evidence import ic_group
from stockta.monitor import newey_west, quintile, rank_order

RULES_VERSION = "v1"
RULES_DOC = "docs/baseline_prereg.md"

MIN_NAMES = 10  # 每日至少幾檔才計入（與線上 Rank IC 相同）
MIN_DAYS = 20  # 中和後 IC 計入不足 20 天不判讀
VERDICT_T = 2.0
HLZ_T = 3.0  # Harvey, Liu & Zhu (2016) 的新因子門檻，只列出供參考
TARGET_T = 2.0  # 「還要多久」以 t 的期望值到 2 推算
RESID_EPS = 1e-9  # 殘差標準差低於此值＝分數幾乎完全由三個因子決定，該日不計
NEXT_CLOSE = 1  # 可成交版：從基準日的下一個收盤起算

# (鍵, 名稱, 回看交易日數, 方向)：數值越大代表預期越強，短期反轉因此取負號
FACTORS: tuple[tuple[str, str, int, int], ...] = (
    ("reversal_5d", "短期反轉", 5, -1),
    ("momentum_20d", "20 日動量", 20, 1),
    ("momentum_60d", "60 日動量", 60, 1),
)
LOOKBACK = max(lookback for _key, _label, lookback, _sign in FACTORS)


@dataclass(frozen=True)
class Obs:
    """一檔股票在一個基準日的觀測值；缺值（資料不足或尚未到期）為 None。"""

    ticker: str
    score: float
    factors: dict[str, float] | None
    ret: float | None  # t 收盤到 t+5 收盤
    ret_next: float | None  # t+1 收盤到 t+6 收盤


@dataclass(frozen=True)
class DayPanel:
    day: date
    live: bool  # 即時記錄：與 monitor.json 的 groups.live 同一定義
    obs: tuple[Obs, ...]


def _close(close: np.ndarray, i: int) -> float | None:
    if i < 0 or i >= len(close):
        return None
    c = float(close[i])
    return c if math.isfinite(c) and c > 0 else None


def factor_values(close: np.ndarray, pos: int) -> dict[str, float] | None:
    """基準日（位置 pos）收盤時的三個因子；只用 pos 以前（含）的收盤價。資料不足回 None。"""
    now = _close(close, pos)
    if now is None or pos < LOOKBACK:
        return None
    out: dict[str, float] = {}
    for key, _label, lookback, sign in FACTORS:
        before = _close(close, pos - lookback)
        if before is None:
            return None
        out[key] = sign * (now / before - 1)
    return out


def forward_return(close: np.ndarray, pos: int, start: int = 0, horizon: int = LABEL_HORIZON_DAYS) -> float | None:
    """從位置 pos + start 的收盤持有 horizon 個交易日的報酬；尚未到期或缺價回 None。"""
    entry, exit_ = _close(close, pos + start), _close(close, pos + start + horizon)
    if entry is None or exit_ is None:
        return None
    return exit_ / entry - 1


def rank_score(values: Sequence[float]) -> np.ndarray:
    """名次分數：同分取平均名次，線性映到 [−1, 1]（Gu, Kelly & Xiu, 2020）。"""
    a = np.asarray(values, dtype=float)
    if len(a) < 2:
        return np.zeros(len(a))
    return 2 * (rankdata(a) - 1) / (len(a) - 1) - 1


def neutralize(scores: Sequence[float], factors: Sequence[Sequence[float]]) -> np.ndarray | None:
    """模型的名次分數對各因子的名次分數（含截距）做最小平方法，回傳殘差；殘差幾乎為 0 時回 None。"""
    x = rank_score(scores)
    design = np.column_stack([np.ones(len(x)), *(rank_score(f) for f in factors)])
    beta, *_ = np.linalg.lstsq(design, x, rcond=None)
    resid = x - design @ beta
    return resid if float(np.std(resid)) >= RESID_EPS else None


def spearman(a: Sequence[float], b: Sequence[float]) -> float | None:
    """至少 MIN_NAMES 檔、兩邊都有變異才算；否則 None。"""
    x, y = np.asarray(a, dtype=float), np.asarray(b, dtype=float)
    if len(x) < MIN_NAMES or len(np.unique(x)) < 2 or len(np.unique(y)) < 2:
        return None
    return float(spearmanr(x, y)[0])


def _stat(values: Sequence[float]) -> dict:
    """平均與 Newey–West t；少於 2 天不算 t。"""
    out = {"n_days": len(values), "mean": None, "t_nw": None}
    if values:
        out["mean"] = float(np.mean(values))
    if len(values) >= 2:
        mean, se = newey_west(values)
        out["t_nw"] = mean / se if se > 0 else None
    return out


def _verdict(n_days: int, t: float | None) -> str:
    if n_days < MIN_DAYS or t is None:
        return "insufficient"
    if t >= VERDICT_T:
        return "beyond"
    if t <= -VERDICT_T:
        return "negative"
    return "indistinct"


def factor_comparison(panels: Sequence[DayPanel]) -> dict:
    """第 2 節：全部已到期的基準日；同一天只用分數、三個因子與 5 日報酬都齊全的股票。"""
    keys = [key for key, *_ in FACTORS]
    model_ics: list[float] = []
    factor_ics: dict[str, list[float]] = {k: [] for k in keys}
    diffs: dict[str, list[float]] = {k: [] for k in keys}
    corrs: dict[str, list[float]] = {k: [] for k in keys}
    neutral: list[tuple[date, float]] = []
    for panel in panels:
        rows = [o for o in panel.obs if o.factors is not None and o.ret is not None]
        scores = [o.score for o in rows]
        rets = [o.ret for o in rows]
        cols = {k: [o.factors[k] for o in rows] for k in keys}
        ic_model = spearman(scores, rets)
        ic_by_factor = {k: spearman(cols[k], rets) for k in keys}
        if ic_model is None or any(v is None for v in ic_by_factor.values()):
            continue
        model_ics.append(ic_model)
        for k in keys:
            factor_ics[k].append(ic_by_factor[k])
            diffs[k].append(ic_model - ic_by_factor[k])
            corr = spearman(scores, cols[k])
            if corr is not None:
                corrs[k].append(corr)
        resid = neutralize(scores, [cols[k] for k in keys])
        ic_neutral = spearman(resid, rets) if resid is not None else None
        if ic_neutral is not None:
            neutral.append((panel.day, ic_neutral))

    group = ic_group(neutral)
    return {
        "n_days": len(model_ics),
        "model": _stat(model_ics),
        "neutral": {**group, "verdict": _verdict(group["n_days"], group["t_nw"])},
        "factors": [
            {
                "key": key,
                "label": label,
                "lookback": lookback,
                "ic": _stat(factor_ics[key]),
                "diff": _stat(diffs[key]),
                "corr_mean": float(np.mean(corrs[key])) if corrs[key] else None,
            }
            for key, label, lookback, _sign in FACTORS
        ],
        "thresholds": {"verdict_t": VERDICT_T, "hlz_t": HLZ_T, "min_days": MIN_DAYS, "min_names": MIN_NAMES},
    }


def tradable_ic(panels: Sequence[DayPanel]) -> dict:
    """第 3 節：報酬從 t+1 收盤起算的逐日 Rank IC，分全部與即時記錄兩組。"""
    days: list[tuple[date, float, bool]] = []
    for panel in panels:
        rows = [o for o in panel.obs if o.ret_next is not None]
        ic = spearman([o.score for o in rows], [o.ret_next for o in rows])
        if ic is not None:
            days.append((panel.day, ic, panel.live))
    return {
        "all": ic_group([(d, ic) for d, ic, _live in days]),
        "live": ic_group([(d, ic) for d, ic, live in days if live]),
    }


def days_needed(n_days: int, se_nw: float | None, backtest_ic: float | None) -> dict:
    """第 4 節：N ＝ n ×（2 × SEₙ ÷ IC_回測）²，還要 ＝ max(0, ⌈N⌉ − n)。"""
    out = {
        "status": "insufficient",
        "n_days": n_days,
        "se_nw": se_nw,
        "backtest_ic": backtest_ic,
        "target_t": TARGET_T,
        "needed": None,
        "remaining": None,
    }
    if n_days < MIN_DAYS or not se_nw or backtest_ic is None or backtest_ic <= 0:
        return out
    needed = math.ceil(n_days * (TARGET_T * se_nw / backtest_ic) ** 2)
    out.update(status="ok", needed=needed, remaining=max(0, needed - n_days))
    return out


def quintile_returns(panels: Sequence[DayPanel]) -> dict:
    """第 5 節：即時記錄的基準日，依當天分數分五分位，前 20%、後 20% 與全池的可成交版 5 日報酬（等權）。"""
    days: list[date] = []
    top: list[float] = []
    bottom: list[float] = []
    pool: list[float] = []
    for panel in panels:
        if not panel.live:
            continue
        rows = {o.ticker: o for o in panel.obs if o.ret_next is not None}
        if len(rows) < MIN_NAMES:
            continue
        ranks = rank_order({t: o.score for t, o in rows.items()})
        n = len(rows)
        q = {t: quintile(r, n) for t, r in ranks.items()}
        top.append(float(np.mean([rows[t].ret_next for t in rows if q[t] == 1])))
        bottom.append(float(np.mean([rows[t].ret_next for t in rows if q[t] == 5])))
        pool.append(float(np.mean([o.ret_next for o in rows.values()])))
        days.append(panel.day)
    spread = [a - b for a, b in zip(top, bottom, strict=True)]
    stat = _stat(spread)
    return {
        "n_days": len(days),
        "first_day": min(days) if days else None,
        "last_day": max(days) if days else None,
        "top_mean": float(np.mean(top)) if top else None,
        "bottom_mean": float(np.mean(bottom)) if bottom else None,
        "pool_mean": float(np.mean(pool)) if pool else None,
        "spread_mean": stat["mean"],
        "spread_t": stat["t_nw"],
    }
