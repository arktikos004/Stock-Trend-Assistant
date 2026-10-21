"""cross-sectional 指標與資料集的單元測試。"""

import numpy as np
import pandas as pd
import pytest

from stockta.config import CS_SPLIT_TRAIN_END, CS_SPLIT_VAL_END
from stockta.features.market import build_market_context
from stockta.ml.cross_sectional import build_cs_dataset, split_masks
from stockta.ml.cs_metrics import NW_LAGS, daily_rank_ic, portfolio_backtest, quantile_spread, rank_ic
from stockta.stats import newey_west


def _two_days(n=20):
    d0 = pd.Timestamp("2026-01-05")
    d1 = pd.Timestamp("2026-01-06")
    dates = np.array([d0] * n + [d1] * n)
    return dates


def test_rank_ic_perfect_positive():
    dates = _two_days()
    rets = np.concatenate([np.linspace(-0.1, 0.1, 20), np.linspace(-0.1, 0.1, 20)])
    scores = rets.copy()  # 分數與報酬完全同序 → IC = 1
    out = rank_ic(dates, scores, rets)
    assert out["mean"] > 0.99
    assert out["n_days"] == 2


def test_rank_ic_reversed_negative():
    dates = _two_days()
    rets = np.concatenate([np.linspace(-0.1, 0.1, 20), np.linspace(-0.1, 0.1, 20)])
    scores = -rets  # 完全反序 → IC = -1
    assert rank_ic(dates, scores, rets)["mean"] < -0.99


def test_rank_ic_t_nw_is_newey_west_on_the_daily_series():
    """顯著性看 Newey–West t：5 日報酬 → 相鄰基準日重疊 4 天 → 落後 4 期。"""
    rng = np.random.default_rng(3)
    days = pd.bdate_range("2026-01-05", periods=30)
    dates = np.repeat(days.values, 12)
    rets = rng.normal(0, 0.02, len(dates))
    scores = rets + rng.normal(0, 0.03, len(dates))
    out = rank_ic(dates, scores, rets)
    daily = daily_rank_ic(dates, scores, rets)
    mean, se = newey_west(daily.to_numpy(), lags=NW_LAGS)
    assert NW_LAGS == 4
    assert out["n_days"] == len(daily) == 30
    assert out["mean"] == pytest.approx(daily.mean())
    assert out["t_nw"] == pytest.approx(mean / se)
    assert out["t"] == pytest.approx(daily.mean() / daily.std(ddof=1) * np.sqrt(30))


def test_quantile_spread_positive_when_score_predicts():
    dates = _two_days()
    rets = np.concatenate([np.linspace(-0.1, 0.1, 20), np.linspace(-0.1, 0.1, 20)])
    scores = rets.copy()
    assert quantile_spread(dates, scores, rets, top_fraction=0.2) > 0


def test_portfolio_backtest_beats_benchmark_when_skilled():
    # 分數完美排序：前段報酬高於全體平均 → 策略應勝基準
    days = [pd.Timestamp("2026-01-05") + pd.Timedelta(days=i) for i in range(0, 60, 1)]
    rows_d, rows_t, rows_s, rows_r = [], [], [], []
    rng = np.random.default_rng(0)
    for d in days:
        for j in range(20):
            r = rng.normal(0, 0.03)
            rows_d.append(d); rows_t.append(f"S{j}"); rows_s.append(r); rows_r.append(r)
    bt = portfolio_backtest(
        np.array(rows_d), np.array(rows_t), np.array(rows_s), np.array(rows_r),
        holding_days=5, top_fraction=0.2, cost_bps=0.0,
    )
    assert bt["periods"] > 0
    assert bt["gross_cum"] > bt["bench_cum"]  # 有排序技能時前段應勝全體


def test_portfolio_backtest_drops_nan_returns():
    days = [pd.Timestamp("2026-01-05"), pd.Timestamp("2026-01-06")]
    d, t, s, r = [], [], [], []
    for day in days:
        for j in range(12):
            d.append(day); t.append(f"S{j}"); s.append(float(j))
            r.append(np.nan if j == 0 else 0.01 * j)  # 一檔缺報酬
    bt = portfolio_backtest(np.array(d), np.array(t), np.array(s), np.array(r),
                            holding_days=1, top_fraction=0.2, cost_bps=0.0)
    assert not np.isnan(bt["net_cum"])  # NaN 應被剔除、不汙染結果


def _rand_walk(seed, periods=400):
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(end=pd.Timestamp.now().normalize(), periods=periods)
    close = 100.0 * np.exp(np.cumsum(rng.normal(0, 0.02, len(idx))))
    spread = np.abs(rng.normal(0, 0.01, len(idx)))
    return pd.DataFrame({
        "open": close, "high": close * (1 + spread), "low": close * (1 - spread),
        "close": close, "volume": rng.integers(1e6, 5e6, len(idx)).astype(float),
    }, index=idx)


def test_cs_labels_are_balanced_by_median():
    pool = {f"{2000+i}.TW": _rand_walk(i) for i in range(12)}
    market = _rand_walk(99)
    context = build_market_context(market, pool, min_tickers=3)
    ds = build_cs_dataset(pool, context)
    # above-median 標籤設計上約 50%
    assert 0.4 < ds.y.mean() < 0.6
    assert np.isfinite(ds.X).all()
    assert ds.is_train.sum() + ds.is_val.sum() + ds.is_test.sum() == len(ds.y)


def test_cs_split_stays_on_experiment_8_dates():
    """3 類模型的 SPLIT_* 在 #9 前移過；CS 模型與回測報告用 #8 當時的切分，不能跟著移。"""
    assert (CS_SPLIT_TRAIN_END, CS_SPLIT_VAL_END) == ("2024-12-31", "2025-12-31")
    pool = {f"{2000+i}.TW": _rand_walk(i, periods=700) for i in range(12)}
    context = build_market_context(_rand_walk(99, periods=700), pool, min_tickers=3)
    ds = build_cs_dataset(pool, context)
    dates = pd.DatetimeIndex(ds.dates)
    assert ds.is_train.any() and ds.is_val.any() and ds.is_test.any()
    assert dates[ds.is_train].max() <= pd.Timestamp(CS_SPLIT_TRAIN_END) < dates[ds.is_val].min()
    assert dates[ds.is_val].max() <= pd.Timestamp(CS_SPLIT_VAL_END) < dates[ds.is_test].min()


def test_split_masks_cut_on_base_dates():
    dates = pd.bdate_range("2024-12-26", "2025-01-10").values
    is_train, is_val, is_test = split_masks(dates, None, "2024-12-31", "2025-01-06")
    days = pd.DatetimeIndex(dates)

    assert days[is_train].max() == pd.Timestamp("2024-12-31")
    assert days[is_val].min() == pd.Timestamp("2025-01-01") and days[is_val].max() == pd.Timestamp("2025-01-06")
    assert days[is_test].min() == pd.Timestamp("2025-01-07")
    assert not (is_train & is_val).any() and not (is_val & is_test).any()


@pytest.mark.leakage
def test_purge_drops_rows_whose_label_crosses_the_cut():
    """標籤是 5 日報酬：訓練列與驗證列的標籤日不能落在切點之後。"""
    days = pd.bdate_range("2024-12-16", "2025-01-24")
    label_end = days.shift(5, freq="B")
    is_train, is_val, is_test = split_masks(days.values, label_end.values, "2024-12-31", "2025-01-15", purge=True)

    assert (label_end[is_train] <= pd.Timestamp("2024-12-31")).all()
    assert (label_end[is_val] <= pd.Timestamp("2025-01-15")).all()
    assert days[is_train].max() == pd.Timestamp("2024-12-24")  # 最後 5 個訓練日被清掉
    assert is_test.sum() == ((days > pd.Timestamp("2025-01-15")).sum())  # 測試列不清除
