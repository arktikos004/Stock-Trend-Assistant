"""逐年驗證指標：合成資料上的已知答案（Newey–West、Diebold–Mariano、成本、Deflated Sharpe、PBO）。"""

import math

import numpy as np
import pandas as pd
import pytest

from stockta.ml.cs_metrics import portfolio_backtest
from stockta.ml.wf_metrics import deflated_sharpe, ic_diff_test, nw_t, pbo_cscv, rebalance_returns, sharpe

# ── Newey–West 與 Diebold–Mariano ──────────────────────────────────────


def test_nw_t_zero_lags_equals_ordinary_t():
    """落後 0 期時 Newey–West 只差在變異數除以 n 而不是 n−1：t_nw × √((n−1)/n) = 一般 t。"""
    x = np.random.default_rng(0).random(50) - 0.4
    ordinary = x.mean() / (x.std(ddof=1) / math.sqrt(len(x)))

    assert nw_t(x, lags=0)["t"] * math.sqrt((len(x) - 1) / len(x)) == pytest.approx(ordinary, rel=1e-12)


def test_nw_t_close_to_ordinary_t_on_white_noise():
    x = np.random.default_rng(1).random(5000) - 0.49
    ordinary = x.mean() / (x.std(ddof=1) / math.sqrt(len(x)))

    assert nw_t(x)["t"] == pytest.approx(ordinary, rel=0.05)


def _ic(seed: int, mean: float, n: int = 400) -> pd.Series:
    days = pd.bdate_range("2020-01-01", periods=n)
    return pd.Series(mean + (np.random.default_rng(seed).random(n) - 0.5) * 0.4, index=days)


def test_dm_identical_models_is_zero():
    ic = _ic(2, 0.03)
    result = ic_diff_test(ic, ic)

    assert result["mean"] == 0.0
    assert result["t"] is None


def test_dm_detects_better_model():
    base = _ic(3, 0.0)
    better = base + 0.05 + (np.random.default_rng(4).random(len(base)) - 0.5) * 0.02

    assert ic_diff_test(better, base)["t"] > 2


def test_dm_equal_skill_not_significant():
    assert abs(ic_diff_test(_ic(5, 0.02), _ic(6, 0.02))["t"]) < 2


def test_dm_uses_only_days_both_have():
    a, b = _ic(7, 0.02), _ic(8, 0.0)
    assert ic_diff_test(a, b.iloc[100:])["n"] == len(b) - 100


# ── 多空、只做多與成本 ─────────────────────────────────────────────────


def _panel(seed: int, n_days: int = 30, n_names: int = 15):
    rng = np.random.default_rng(seed)
    days = pd.bdate_range("2024-01-01", periods=n_days)
    tickers = [f"{1000 + i}.TW" for i in range(n_names)]
    frame = pd.DataFrame(
        {
            "date": np.repeat(days.to_numpy(), n_names),
            "tkr": np.tile(tickers, n_days),
            "s": rng.random(n_days * n_names),
            "r": (rng.random(n_days * n_names) - 0.5) * 0.06,
        }
    )
    return frame["date"].to_numpy(), frame["tkr"].to_numpy(), frame["s"].to_numpy(), frame["r"].to_numpy()


def test_long_short_costs_by_hand():
    """兩期、每邊 3 檔：第二期多方換掉 1 檔、空方換掉 2 檔。"""
    days = pd.bdate_range("2024-01-01", periods=6)  # 換股日：第 1 天與第 6 天
    tickers = [f"{1000 + i}.TW" for i in range(10)]
    first = dict(zip(tickers, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1], strict=True))  # 多 1000/1001/1002，空 1007/1008/1009
    second = dict(zip(tickers, [10, 9, 1, 8, 7, 6, 5, 4, 3, 2], strict=True))  # 多 1000/1001/1003，空 1008/1009/1002
    rows = []
    for i, day in enumerate(days):
        score = first if i == 0 else second
        for t in tickers:
            rows.append((day, t, score[t], 0.01 if score[t] >= 8 else -0.01))
    frame = pd.DataFrame(rows, columns=["date", "tkr", "s", "r"])

    out = rebalance_returns(frame["date"].to_numpy(), frame["tkr"].to_numpy(), frame["s"].to_numpy(), frame["r"].to_numpy(), cost_bps=58.5)

    assert len(out) == 2
    p1, p2 = out.iloc[0], out.iloc[1]
    assert (p1["long_turnover"], p1["short_turnover"]) == (1.0, 1.0)
    assert p2["long_turnover"] == pytest.approx(1 / 3)
    assert p2["short_turnover"] == pytest.approx(1 / 3)  # 換掉 1007、換進 1002
    assert p1["ls_net"] == pytest.approx(0.01 - (-0.01) - 2 * 0.00585)
    assert p2["ls_net"] == pytest.approx(p2["long"] - p2["short"] - (1 / 3 + 1 / 3) * 0.00585)
    assert p2["lo_net"] == pytest.approx(p2["long"] - (1 / 3) * 0.00585)


def test_long_only_matches_portfolio_backtest_without_ties():
    dates, tickers, scores, rets = _panel(9)
    out = rebalance_returns(dates, tickers, scores, rets, holding_days=5, cost_bps=58.5)
    reference = portfolio_backtest(dates, tickers, scores, rets, holding_days=5, cost_bps=58.5)

    assert len(out) == reference["periods"]
    assert np.prod(1 + out["lo_net"]) - 1 == pytest.approx(reference["net_cum"], rel=1e-12)
    assert np.prod(1 + out["lo_gross"]) - 1 == pytest.approx(reference["gross_cum"], rel=1e-12)


def test_ties_break_by_ticker():
    """分數全部相同時，多方取代號最前面的 k 檔、空方取最後面的 k 檔。"""
    days = pd.bdate_range("2024-01-01", periods=1)
    tickers = [f"{1000 + i}.TW" for i in range(15)]
    rets = np.arange(15) / 100
    out = rebalance_returns(np.repeat(days.to_numpy(), 15), np.array(tickers), np.zeros(15), rets)

    assert out.iloc[0]["long"] == pytest.approx(rets[:3].mean())
    assert out.iloc[0]["short"] == pytest.approx(rets[-3:].mean())


def test_sharpe_per_period_and_annualized():
    r = np.array([0.01, 0.03, -0.01, 0.02])
    result = sharpe(r, periods_per_year=50.4)

    assert result["per_period"] == pytest.approx(r.mean() / r.std(ddof=1))
    assert result["annualized"] == pytest.approx(result["per_period"] * math.sqrt(50.4))


# ── Deflated Sharpe 與 PBO ─────────────────────────────────────────────


def test_dsr_hand_example():
    """N=42、各組合 Sharpe 變異數 0.01、選出的每期 Sharpe 0.15、200 期、常態：SR0≈0.2209、DSR≈0.160。"""
    result = deflated_sharpe(sr=0.15, n_trials=42, var_trials=0.01, n_obs=200)

    assert result["sr0"] == pytest.approx(0.2209, abs=5e-4)
    assert result["dsr"] == pytest.approx(0.160, abs=2e-3)


def test_cscv_enumerates_12870_splits():
    returns = np.random.default_rng(10).random((160, 4)) - 0.5
    assert pbo_cscv(returns, np.repeat(np.arange(16), 10))["n_splits"] == 12870


def test_pbo_noise_about_half():
    """全是雜訊時，樣本內最好的組合在樣本外落在中位數以下的機率約一半。"""
    pbos = [pbo_cscv(np.random.default_rng(seed).random((160, 20)) - 0.5, np.repeat(np.arange(16), 10))["pbo"] for seed in range(10)]

    assert 0.4 <= np.mean(pbos) <= 0.6


def test_pbo_persistent_skill_zero():
    """有一個組合每一塊都穩定較好：它在樣本內、樣本外都排第一，PBO 為 0。"""
    rng = np.random.default_rng(11)
    returns = (rng.random((160, 20)) - 0.5) * 0.02
    returns[:, 7] += 0.05

    assert pbo_cscv(returns, np.repeat(np.arange(16), 10))["pbo"] == 0.0
