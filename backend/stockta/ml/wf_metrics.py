"""逐年樣本外驗證的指標：規則見 docs/walkforward_prereg.md（第 5、7 節）。

- 多空與只做多：每 holding_days 個交易日換股一次（不重疊），前、後 top_fraction 等權；
  每次換股的成本＝（多方換掉的比例＋空方換掉的比例）× cost_bps，只做多則只算多方。
- Sharpe：每期（不年化）與年化兩種；Deflated Sharpe 用每期的值。
- 和基準比：逐日 Rank IC 差的平均 ÷ Newey–West 標準誤（Diebold & Mariano 1995）。
- Deflated Sharpe ratio（Bailey & López de Prado 2014）與 CSCV 的 PBO（Bailey, Borwein, López de Prado & Zhu 2017）。

都是純函式，輸入是陣列或 Series，不讀任何檔案。
"""

from __future__ import annotations

import math
from itertools import combinations

import numpy as np
import pandas as pd
from scipy.stats import norm, rankdata

from stockta.config import CS_COST_BPS, CS_TOP_FRACTION, LABEL_HORIZON_DAYS
from stockta.stats import MIN_STOCKS_PER_DAY, NW_LAGS, newey_west

EULER_GAMMA = 0.5772156649015329
PERIODS_PER_YEAR = 252 / LABEL_HORIZON_DAYS


def rebalance_returns(
    dates: np.ndarray,
    tickers: np.ndarray,
    scores: np.ndarray,
    rets: np.ndarray,
    *,
    holding_days: int = LABEL_HORIZON_DAYS,
    top_fraction: float = CS_TOP_FRACTION,
    cost_bps: float = CS_COST_BPS,
) -> pd.DataFrame:
    """每一期一列：多方、空方、全池的報酬，兩邊換掉的比例，以及多空、只做多扣成本前後的報酬。

    換股日是 dates 裡所有交易日（排序後）每隔 holding_days 取一天；當天報酬齊全的股票少於
    MIN_STOCKS_PER_DAY 檔就跳過。每邊取 max(3, ⌊top_fraction × n⌋) 檔，同分時依代號排序。
    """
    frame = pd.DataFrame({"date": pd.DatetimeIndex(dates), "tkr": tickers, "s": scores, "r": rets})
    frame = frame[np.isfinite(frame["r"].to_numpy(dtype=float))]
    calendar = np.sort(pd.DatetimeIndex(dates).unique())[::holding_days]
    groups = dict(tuple(frame.groupby("date")))
    rows = []
    prev_long: set[str] | None = None
    prev_short: set[str] | None = None
    for day in calendar:
        g = groups.get(pd.Timestamp(day))
        if g is None or len(g) < MIN_STOCKS_PER_DAY:
            continue
        n = len(g)
        k = max(3, int(n * top_fraction))
        ordered = g.sort_values(["s", "tkr"], ascending=[False, True], kind="mergesort")
        long, short = ordered.iloc[:k], ordered.iloc[-k:]
        long_set, short_set = set(long["tkr"]), set(short["tkr"])
        long_turn = 1.0 if prev_long is None else len(long_set - prev_long) / k
        short_turn = 1.0 if prev_short is None else len(short_set - prev_short) / k
        long_ret, short_ret = float(long["r"].mean()), float(short["r"].mean())
        cost = cost_bps / 1e4
        rows.append(
            {
                "date": pd.Timestamp(day),
                "n": n,
                "k": k,
                "long": long_ret,
                "short": short_ret,
                "pool": float(g["r"].mean()),
                "long_turnover": long_turn,
                "short_turnover": short_turn,
                "ls_gross": long_ret - short_ret,
                "ls_net": long_ret - short_ret - (long_turn + short_turn) * cost,
                "lo_gross": long_ret,
                "lo_net": long_ret - long_turn * cost,
            }
        )
        prev_long, prev_short = long_set, short_set
    return pd.DataFrame(rows)


def sharpe(returns, periods_per_year: float = PERIODS_PER_YEAR) -> dict:
    """每期報酬的 Sharpe：每期（平均 ÷ 樣本標準差）與年化（× √periods_per_year）。"""
    r = np.asarray(returns, dtype=float)
    r = r[np.isfinite(r)]
    if len(r) < 2 or float(np.std(r, ddof=1)) == 0:
        return {"n": len(r), "per_period": None, "annualized": None}
    per_period = float(np.mean(r) / np.std(r, ddof=1))
    return {"n": len(r), "per_period": per_period, "annualized": per_period * math.sqrt(periods_per_year)}


def nw_t(values, lags: int = NW_LAGS) -> dict:
    """平均與 Newey–West t（少於 2 個值或標準誤為 0 時 t 為 None）。"""
    x = np.asarray(values, dtype=float)
    if len(x) == 0:
        return {"n": 0, "mean": None, "t": None}
    if len(x) < 2:
        return {"n": 1, "mean": float(x[0]), "t": None}
    mean, se = newey_west(x, lags=lags)
    return {"n": len(x), "mean": mean, "t": mean / se if se > 0 else None}


def ic_diff_test(ic_a: pd.Series, ic_b: pd.Series, lags: int = NW_LAGS) -> dict:
    """Diebold–Mariano：同一批日子上 IC_a − IC_b 的平均 ÷ Newey–West 標準誤（只用兩邊都有 IC 的日子）。"""
    joined = pd.concat({"a": ic_a, "b": ic_b}, axis=1).dropna()
    return nw_t((joined["a"] - joined["b"]).to_numpy(), lags=lags)


def deflated_sharpe(sr: float, n_trials: int, var_trials: float, n_obs: int, skew: float = 0.0, kurt: float = 3.0) -> dict:
    """Deflated Sharpe ratio：考慮試過 n_trials 個組合後，真實 Sharpe 大於 0 的機率。

    sr 是每期（不年化）的 Sharpe，n_obs 是期數，var_trials 是各組合每期 Sharpe 的變異數，
    kurt 是一般峰態（常態 = 3）。SR0 是 n_trials 個無效組合中最大 Sharpe 的期望值。
    """
    sr0 = math.sqrt(var_trials) * (
        (1 - EULER_GAMMA) * norm.ppf(1 - 1 / n_trials) + EULER_GAMMA * norm.ppf(1 - 1 / (n_trials * math.e))
    )
    denom = math.sqrt(1 - skew * sr + (kurt - 1) / 4 * sr**2)
    return {"sr0": sr0, "dsr": float(norm.cdf((sr - sr0) * math.sqrt(n_obs - 1) / denom))}


def pbo_cscv(returns: np.ndarray, blocks: np.ndarray) -> dict:
    """Probability of backtest overfitting（CSCV）。

    returns：每期 × 每個組合的報酬（T × N）；blocks：每期屬於哪一塊（例如測試年）。
    每次取一半的塊當樣本內、另一半當樣本外，看樣本內 Sharpe 最高的組合在樣本外排第幾；
    PBO＝它落在樣本外中位數以下（logit ≤ 0）的比例。列舉全部 C(S, S/2) 種切法。
    """
    r = np.asarray(returns, dtype=float)
    labels = np.asarray(blocks)
    uniq = list(dict.fromkeys(labels.tolist()))
    s = len(uniq)
    if s % 2:
        raise ValueError("塊數必須是偶數，才能一半對一半")
    idx = {b: i for i, b in enumerate(uniq)}
    which = np.array([idx[b] for b in labels.tolist()])
    count = np.bincount(which, minlength=s).astype(float)
    s1 = np.zeros((s, r.shape[1]))
    s2 = np.zeros((s, r.shape[1]))
    np.add.at(s1, which, r)
    np.add.at(s2, which, r**2)

    splits = np.array([[1.0 if i in combo else 0.0 for i in range(s)] for combo in combinations(range(s), s // 2)])

    def _sharpe(mask: np.ndarray) -> np.ndarray:
        n = mask @ count
        total, total_sq = mask @ s1, mask @ s2
        mean = total / n[:, None]
        var = (total_sq - total**2 / n[:, None]) / (n[:, None] - 1)
        with np.errstate(divide="ignore", invalid="ignore"):
            return np.where(var > 0, mean / np.sqrt(var), 0.0)

    is_sharpe, oos_sharpe = _sharpe(splits), _sharpe(1.0 - splits)
    best = np.argmax(is_sharpe, axis=1)
    n_configs = r.shape[1]
    ranks = np.array([rankdata(row)[b] for row, b in zip(oos_sharpe, best, strict=True)])
    omega = ranks / (n_configs + 1)
    logits = np.log(omega / (1 - omega))
    return {"pbo": float(np.mean(logits <= 0)), "n_splits": len(splits), "logits": logits}
