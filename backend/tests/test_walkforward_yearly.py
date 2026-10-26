"""逐年驗證的流程：合成資料上確認切分、選擇碰不到測試年、測試年只讀一次、結果只有統計量。"""

from __future__ import annotations

import json
from dataclasses import replace
from datetime import date

import numpy as np
import pandas as pd
import pytest

from stockta.config import ARTIFACTS_CS_DIR
from stockta.ml.cross_sectional import fit_cs
from stockta.ml.walkforward_yearly import (
    WFConfig,
    WFData,
    fold_masks,
    pooled_val_ic,
    record_selection,
    run_test,
    score_test_years,
    select_variant,
    validate,
    yearly_folds,
)

CONFIG = WFConfig(
    folds=tuple(yearly_folds(2010, 2012)),
    grid=((2, 0.1), (3, 0.1)),
    seeds=(1, 2),
    n_estimators=5,
    n_jobs=2,
    start=date(2006, 1, 1),
)


def _data(seed: int = 0, n_names: int = 12, n_features: int = 8) -> WFData:
    rng = np.random.default_rng(seed)
    days = pd.bdate_range("2006-01-02", "2012-12-31")
    dates = np.repeat(days.to_numpy(), n_names)
    tickers = np.tile([f"{1000 + i}.TW" for i in range(n_names)], len(days))
    X = rng.random((len(dates), n_features)).astype(np.float32)
    ret = (rng.random(len(dates)) - 0.5) * 0.1 + 0.02 * (X[:, 0] - 0.5)  # 第 0 欄帶一點訊號
    median = pd.Series(ret).groupby(dates).transform("median").to_numpy()
    label_end = (pd.DatetimeIndex(dates) + pd.offsets.BDay(5)).to_numpy()
    baselines = {"momentum_20d": rng.random(len(dates)), "reversal_5d": rng.random(len(dates))}
    return WFData(X, (ret > median).astype(int), dates, tickers, ret, label_end, baselines)


def _poison_from(data: WFData, first_day: str, seed: int = 99) -> WFData:
    """first_day 以後的列換成亂數：特徵、標籤、報酬都變。"""
    rng = np.random.default_rng(seed)
    later = pd.DatetimeIndex(data.dates) >= pd.Timestamp(first_day)
    X, y, ret = data.X.copy(), data.y.copy(), data.ret_label.copy()
    X[later] = rng.random((int(later.sum()), X.shape[1])).astype(np.float32) * 100
    y[later] = 1 - y[later]
    ret[later] = rng.random(int(later.sum()))
    return replace(data, X=X, y=y, ret_label=ret)


def _without_daily(validation: dict) -> dict:
    return {
        year: {"selected": fold["selected"], "entries": [{k: v for k, v in e.items() if k != "val_daily_ic"} for e in fold["entries"]]}
        for year, fold in validation["folds"].items()
    }


# ── 切分 ─────────────────────────────────────────────────────────────


def test_sixteen_folds_have_expected_dates():
    folds = yearly_folds()

    assert [f.test_year for f in folds] == list(range(2010, 2026))
    assert (folds[0].train_end, folds[0].val_end, folds[0].test_end) == (date(2008, 12, 31), date(2009, 12, 31), date(2010, 12, 31))
    assert folds[-1].test_end == date(2025, 12, 31)


@pytest.mark.leakage
def test_fold_masks_disjoint_and_purged():
    data = _data()
    days, ends = pd.DatetimeIndex(data.dates), pd.DatetimeIndex(data.label_end)
    for fold in CONFIG.folds:
        train, val, test = fold_masks(data.dates, data.label_end, fold, CONFIG.start)

        assert not (train & val).any() and not (val & test).any() and not (train & test).any()
        assert (ends[train] <= pd.Timestamp(fold.train_end)).all()
        assert (ends[val] <= pd.Timestamp(fold.val_end)).all()
        assert days[test].min().year == fold.test_year and days[test].max() <= pd.Timestamp(fold.test_end)
        assert days[train].min() >= pd.Timestamp(CONFIG.start)


# ── 選擇碰不到測試年 ──────────────────────────────────────────────────


@pytest.mark.leakage
def test_fold_validation_ignores_its_test_year(tmp_path):
    """把測試年（含）以後的資料全換成亂數，該折的驗證成績與選出的超參數都不能變。"""
    one = replace(CONFIG, folds=(CONFIG.folds[-1],))
    clean = validate(_data(), one, tmp_path / "a")
    poisoned = validate(_poison_from(_data(), "2012-01-01"), one, tmp_path / "b")

    assert _without_daily(clean) == _without_daily(poisoned)


@pytest.mark.leakage
def test_selection_ignores_final_test_year(tmp_path):
    clean = validate(_data(), CONFIG, tmp_path / "a")
    poisoned = validate(_poison_from(_data(), "2012-01-01"), CONFIG, tmp_path / "b")

    assert _without_daily(clean) == _without_daily(poisoned)
    assert pooled_val_ic(clean) == pooled_val_ic(poisoned)


@pytest.mark.leakage
def test_scaler_sees_only_training_rows():
    data = _data()
    train, _val, _test = fold_masks(data.dates, data.label_end, CONFIG.folds[0], CONFIG.start)
    poisoned = _poison_from(data, "2009-01-01")  # 第一折的訓練期到 2008 年底

    _, clean_scaler, _ = fit_cs(data.X, data.y, train, params={"n_estimators": 2})
    _, poisoned_scaler, _ = fit_cs(poisoned.X, poisoned.y, train, params={"n_estimators": 2})

    np.testing.assert_array_equal(clean_scaler.mean_, poisoned_scaler.mean_)


def test_variant_selection_breaks_ties_toward_the_simpler_variant():
    def validation(ic: float) -> dict:
        entry = {"depth": 3, "learning_rate": 0.05, "val_daily_ic": {"2009-01-05": ic, "2009-01-06": ic}}
        return {"folds": {"2010": {"entries": [entry], "selected": {"depth": 3, "learning_rate": 0.05}}}}

    choice = select_variant({"V0": validation(0.02), "V1": validation(0.02), "V2": validation(0.01)}, [2010])

    assert choice == {"global": "V0", "sequential": {"2010": "V0"}}


# ── 測試期：先 commit 選擇、只讀一次 ───────────────────────────────────


@pytest.fixture
def selected(tmp_path):
    data = _data()
    cache = tmp_path / "cache"
    results = tmp_path / "walkforward_yearly.json"
    record_selection(results, "U1", "V0", validate(data, CONFIG, cache), {"code_commit": "test"})
    return data, cache, results


def test_test_phase_requires_recorded_selection(tmp_path):
    with pytest.raises(SystemExit, match="沒有"):
        run_test(_data(), CONFIG, tmp_path / "cache", tmp_path / "none.json", "U1", "V0", require_committed=False)


def test_test_phase_requires_a_committed_selection(selected):
    data, cache, results = selected
    with pytest.raises(SystemExit, match="commit"):
        run_test(data, CONFIG, cache, results, "U1", "V0", is_committed=lambda path: False)


def test_test_years_are_read_once(selected):
    data, cache, results = selected
    run_test(data, CONFIG, cache, results, "U1", "V0", require_committed=False)

    with pytest.raises(SystemExit, match="已經讀過"):
        run_test(data, CONFIG, cache, results, "U1", "V0", require_committed=False)
    again = run_test(data, CONFIG, cache, results, "U1", "V0", require_committed=False, rerun_reason="測試")
    assert again["tests"]["U1"]["V0"]["previous_reads"] == 1


def test_test_scores_average_every_seed_of_the_selected_setting(tmp_path):
    """測試年的分數＝選出的超參數下，每個種子各自訓練的模型取平均；每組超參數與種子各存一份。"""
    data = _data()
    config = replace(CONFIG, folds=(CONFIG.folds[0],), grid=((2, 0.05), (2, 0.1)))
    cache = tmp_path / "cache"
    chosen = validate(data, config, cache)["folds"]["2010"]["selected"]
    ((mask, scores),) = score_test_years(data, config, cache, {"2010": chosen}).values()

    train, _val, test = fold_masks(data.dates, data.label_end, config.folds[0], config.start)
    expected = np.zeros(int(test.sum()))
    for seed in config.seeds:
        params = {"max_depth": chosen["depth"], "learning_rate": chosen["learning_rate"], "n_estimators": config.n_estimators, "random_state": seed, "n_jobs": config.n_jobs}
        model, scaler, _rows = fit_cs(data.X, data.y, train, params=params)
        expected += model.predict_proba(scaler.transform(data.X[test]).astype(np.float32))[:, 1] / len(config.seeds)

    assert len(list((cache / "models" / "2010").glob("*.ubj"))) == len(config.grid) * len(config.seeds)
    np.testing.assert_array_equal(mask, test)
    np.testing.assert_allclose(scores, expected, rtol=0, atol=1e-9)


def _lists(value) -> list:
    if isinstance(value, list):
        return [value]
    if isinstance(value, dict):
        return [x for v in value.values() for x in _lists(v)]
    return []


def test_results_hold_statistics_only(selected):
    data, cache, results = selected
    run_test(data, CONFIG, cache, results, "U1", "V0", require_committed=False)
    saved = json.loads(results.read_text(encoding="utf-8"))

    assert _lists(saved) == []  # 沒有逐日、逐列的序列，只有彙總的數字
    per_year = saved["tests"]["U1"]["V0"]["per_year"]
    assert sorted(per_year) == ["2010", "2011", "2012"]
    assert set(per_year["2012"]["vs_baselines"]) == {"momentum_20d", "reversal_5d"}


def test_run_writes_only_results_and_cache(selected):
    data, cache, results = selected
    before = sorted((p.as_posix(), p.stat().st_mtime_ns) for p in ARTIFACTS_CS_DIR.rglob("*")) if ARTIFACTS_CS_DIR.exists() else []
    run_test(data, CONFIG, cache, results, "U1", "V0", require_committed=False)
    after = sorted((p.as_posix(), p.stat().st_mtime_ns) for p in ARTIFACTS_CS_DIR.rglob("*")) if ARTIFACTS_CS_DIR.exists() else []

    assert before == after
    assert {p.name for p in results.parent.iterdir()} == {"cache", "walkforward_yearly.json"}


def test_synthetic_run_is_deterministic(tmp_path):
    first = validate(_data(), CONFIG, tmp_path / "a")
    second = validate(_data(), CONFIG, tmp_path / "b")

    assert first == second
