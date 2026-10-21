"""黃金測試：Rank IC、Newey–West 與組合回測在固定輸入上的輸出逐位元固定。

預期值在整併這些函式之前，從當時的實作擷取（golden/stats.json），之後不重新產生：
這裡失敗，代表改到了已公開數字背後的算法。
- 輸入只用均勻亂數與四則運算（不用常態亂數、exp、log），浮點數以 float.hex 儲存，跨平台逐位元可比。
- 前後段選股（quantile_spread、portfolio_backtest）的輸入沒有同分：同分時的順序取決於排序實作，不屬於要固定的行為。
"""

from __future__ import annotations

import json
from datetime import date, datetime
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from stockta.baselines import (
    DayPanel,
    Obs,
    factor_comparison,
    factor_values,
    forward_return,
    quintile_returns,
    spearman,
    tradable_ic,
)
from stockta.evidence import ic_group
from stockta.ml.cs_metrics import daily_rank_ic, portfolio_backtest, quantile_spread, rank_ic
from stockta.ml.report_rank_predictions import collect_matured, daily_ic
from stockta.monitor import model_health, newey_west

GOLDEN_PATH = Path(__file__).parent / "golden" / "stats.json"
START = "2025-01-02"


def encode(value):
    """輸出轉成可逐位元比較的 JSON：浮點數 → "f:" + float.hex，日期 → "d:" + ISO。"""
    if value is None:
        return None
    if isinstance(value, (bool, np.bool_)):
        return bool(value)
    if isinstance(value, (int, np.integer)):
        return int(value)
    if isinstance(value, (float, np.floating)):
        return "f:" + float(value).hex()
    if isinstance(value, str):
        return value
    if isinstance(value, (datetime, date)):
        return "d:" + value.isoformat()
    if isinstance(value, np.datetime64):
        return "d:" + pd.Timestamp(value).isoformat()
    if isinstance(value, pd.Series):
        return {"series": [[encode(k), encode(v)] for k, v in value.items()], "dtype": str(value.dtype)}
    if isinstance(value, np.ndarray):
        return {"array": [encode(v) for v in value.tolist()], "dtype": str(value.dtype)}
    if isinstance(value, dict):
        return {str(k): encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [encode(v) for v in value]
    raise TypeError(f"無法編碼 {type(value).__name__}")


# ── 輸入 ─────────────────────────────────────────────────────────────


def _panel(seed: int, n_days: int = 40, n_names: int = 12) -> pd.DataFrame:
    """逐日 × 逐檔的分數與 5 日報酬（長表）。"""
    rng = np.random.default_rng(seed)
    dates = pd.bdate_range(START, periods=n_days)
    return pd.DataFrame(
        {
            "date": np.repeat(dates.to_numpy(), n_names),
            "ticker": np.tile([f"{1100 + i}.TW" for i in range(n_names)], n_days),
            "score": rng.random(n_days * n_names),
            "ret": (rng.random(n_days * n_names) - 0.5) * 0.08,
        }
    )


def _day(frame: pd.DataFrame, i: int) -> pd.Series:
    return frame["date"] == frame["date"].unique()[i]


def _ties(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame.copy()
    out["score"] = (out["score"] * 100).round() / 100
    out.loc[out.index % 5 == 0, "ret"] = 0.01
    return out


def _with_nan(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame.copy()
    out.loc[_day(out, 3) & (out["ticker"] == "1100.TW"), "ret"] = np.nan  # spearmanr 回 NaN 的一天
    out.loc[_day(out, 6) & out["ticker"].isin(["1101.TW", "1102.TW", "1103.TW"]), "ret"] = np.nan
    return out


def _constant(frame: pd.DataFrame) -> pd.DataFrame:
    out = frame.copy()
    out.loc[_day(out, 2), "score"] = 0.5
    out.loc[_day(out, 7), "ret"] = 0.02
    return out


def _thin(frame: pd.DataFrame) -> pd.DataFrame:
    """第 1 天只剩 9 檔、第 4 天剩 10 檔（最少 10 檔的門檻兩側）。"""
    drop = (_day(frame, 1) & (frame.groupby("date").cumcount() >= 9)) | (_day(frame, 4) & (frame.groupby("date").cumcount() >= 10))
    return frame[~drop].reset_index(drop=True)


def _shuffled(frame: pd.DataFrame, seed: int) -> pd.DataFrame:
    order = np.random.default_rng(seed).permutation(len(frame))
    return frame.iloc[order].reset_index(drop=True)


PANELS = {
    "clean": lambda: _panel(1),
    "ties": lambda: _ties(_panel(2)),
    "nan": lambda: _with_nan(_panel(3)),
    "constant": lambda: _constant(_panel(4)),
    "thin": lambda: _thin(_panel(5)),
    "shuffled": lambda: _shuffled(_panel(6), seed=60),
    "float32": lambda: _panel(7).astype({"score": np.float32}),
}
NO_TIES = ("clean", "nan", "thin", "shuffled", "float32")


def _arrays(frame: pd.DataFrame):
    return frame["date"].to_numpy(), frame["score"].to_numpy(), frame["ret"].to_numpy()


def _online_lists(frame: pd.DataFrame):
    day_index = {d: i for i, d in enumerate(frame["date"].unique())}
    sources = ["live" if day_index[d] % 2 == 0 else "pit" for d in frame["date"]]
    return [pd.Timestamp(d) for d in frame["date"]], frame["score"].tolist(), frame["ret"].tolist(), sources


def _closes(seed: int, n_names: int, length: int) -> dict[str, np.ndarray]:
    rng = np.random.default_rng(seed)
    return {f"{2100 + i}.TW": 100.0 * np.cumprod(1 + (rng.random(length) - 0.5) * 0.06) for i in range(n_names)}


def _day_panels(seed: int, n_names: int = 14, n_days: int = 90, live_from: int = 60) -> list[DayPanel]:
    """基準日 60 起（因子要 60 日回看）；最後三天沒有 t+1 起算的報酬，最後兩天沒有 5 日報酬。"""
    closes = _closes(seed, n_names, 60 + n_days + 3)
    rng = np.random.default_rng(seed + 1)
    dates = pd.bdate_range(START, periods=60 + n_days + 3)
    panels = []
    for k in range(n_days):
        pos = 60 + k
        obs = tuple(
            Obs(
                ticker=t,
                score=float(rng.random()),
                factors=factor_values(c, pos),
                ret=forward_return(c, pos),
                ret_next=forward_return(c, pos, start=1),
            )
            for t, c in closes.items()
        )
        panels.append(DayPanel(day=dates[pos].date(), live=k >= live_from, obs=obs))
    return panels


class _FakeCache:
    def __init__(self, frames: dict[str, pd.DataFrame]):
        self.frames = frames

    def read(self, ticker: str) -> pd.DataFrame | None:
        return self.frames.get(ticker)


def _matured_case():
    dates = pd.bdate_range(START, periods=30)
    frames = {t: pd.DataFrame({"close": c}, index=dates) for t, c in _closes(30, 3, 30).items()}
    rng = np.random.default_rng(31)
    rows = [(t, d.strftime("%Y-%m-%d"), float(rng.random()), "live" if i % 3 else "pit") for i, d in enumerate(dates[::2]) for t in frames]
    rows += [("9999.TW", "2025-01-06", 0.5, "live"), ("2100.TW", "2025-01-04", 0.5, "pit")]  # 沒有快取、非交易日
    return collect_matured(rows, _FakeCache(frames))


# ── 案例 ─────────────────────────────────────────────────────────────

CASES: dict = {}
for _name, _build in PANELS.items():
    CASES[f"daily_rank_ic/{_name}"] = lambda b=_build: daily_rank_ic(*_arrays(b()))
    CASES[f"rank_ic/{_name}"] = lambda b=_build: rank_ic(*_arrays(b()))
    CASES[f"daily_ic/{_name}"] = lambda b=_build: daily_ic(*_online_lists(b()))
    if _name in NO_TIES:
        CASES[f"quantile_spread/{_name}"] = lambda b=_build: quantile_spread(*_arrays(b()))

for _h in (1, 5, 20):
    for _cost in (0.0, 58.5):
        CASES[f"portfolio_backtest/h{_h}/cost{_cost}"] = lambda h=_h, c=_cost: portfolio_backtest(
            *(lambda f: (f["date"].to_numpy(), f["ticker"].to_numpy(), f["score"].to_numpy(), f["ret"].to_numpy()))(
                _with_nan(_panel(8, n_days=80, n_names=15))
            ),
            holding_days=h,
            cost_bps=c,
        )

for _n in (1, 2, 3, 5, 300):
    _x = (np.random.default_rng(100 + _n).random(_n) - 0.5) * 0.2
    for _lags in (0, 1, 4, 10):
        CASES[f"newey_west/n{_n}/lags{_lags}"] = lambda x=_x, lags=_lags: newey_west(x, lags=lags)


def _ic_days(n: int, seed: int) -> list[tuple[date, float]]:
    ics = (np.random.default_rng(seed).random(n) - 0.45) * 0.4
    return [(d.date(), float(ic)) for d, ic in zip(pd.bdate_range(START, periods=n), ics, strict=True)]


for _n in (1, 5, 19, 25, 60):
    for _bt in (None, 0.0437):
        CASES[f"model_health/n{_n}/backtest{_bt}"] = lambda n=_n, bt=_bt: model_health(_ic_days(n, 200 + n), bt)

for _n in (0, 1, 2, 30):
    CASES[f"ic_group/n{_n}"] = lambda n=_n: ic_group(_ic_days(n, 300 + n))

_SPEARMAN_INPUTS = {
    "clean": lambda: (np.random.default_rng(40).random(12), np.random.default_rng(41).random(12)),
    "nine": lambda: (np.random.default_rng(42).random(9), np.random.default_rng(43).random(9)),
    "constant": lambda: (np.full(12, 0.3), np.random.default_rng(44).random(12)),
    "ties": lambda: ((np.random.default_rng(45).random(12) * 4).round(), (np.random.default_rng(46).random(12) * 3).round()),
}
for _name, _pair in _SPEARMAN_INPUTS.items():
    CASES[f"spearman/{_name}"] = lambda p=_pair: spearman(*p())

CASES["factor_comparison"] = lambda: factor_comparison(_day_panels(50))
CASES["tradable_ic"] = lambda: tradable_ic(_day_panels(51))
CASES["quintile_returns"] = lambda: quintile_returns(_day_panels(52))
CASES["collect_matured"] = _matured_case


# ── 測試 ─────────────────────────────────────────────────────────────


@pytest.fixture(scope="module")
def golden() -> dict:
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


def test_every_case_has_a_golden_value(golden):
    assert sorted(CASES) == sorted(golden)


@pytest.mark.parametrize("name", sorted(CASES))
def test_golden_stats_cases(name, golden):
    assert encode(CASES[name]()) == golden[name]
