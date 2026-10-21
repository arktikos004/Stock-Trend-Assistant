"""黃金測試：cross-sectional 資料集、訓練列與標準化參數在固定的合成股票池上逐位元固定。

預期值在加入切分、purge 與當時成分股的選項之前擷取（golden/cs_dataset.json），之後不重新產生：
預設參數下的資料集必須和現在一模一樣，現行模型的訓練才不受影響。
輸入只用均勻亂數與四則運算；XGBoost 的機率跨平台不保證逐位元相同，只比到相對誤差 1e-6。
"""

from __future__ import annotations

import hashlib
import json
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from sklearn.preprocessing import StandardScaler

from stockta.features.market import build_market_context
from stockta.ml.cross_sectional import _make_model, build_cs_dataset, fit_cs

GOLDEN_PATH = Path(__file__).parent / "golden" / "cs_dataset.json"
N_TICKERS = 12
N_DAYS = 600  # 2024-01-01 起約到 2026-04：訓練、驗證、測試三段都有資料


def _ohlcv(seed: int) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range("2024-01-01", periods=N_DAYS)
    close = 100.0 * np.cumprod(1 + (rng.random(N_DAYS) - 0.5) * 0.04)
    spread = rng.random(N_DAYS) * 0.01
    return pd.DataFrame(
        {
            "open": close * (1 + (rng.random(N_DAYS) - 0.5) * 0.01),
            "high": close * (1 + spread),
            "low": close * (1 - spread),
            "close": close,
            "volume": rng.integers(500_000, 5_000_000, N_DAYS).astype(float),
        },
        index=idx,
    )


def _inputs():
    pool = {f"{1100 + i}.TW": _ohlcv(10 + i) for i in range(N_TICKERS)}
    context = build_market_context(_ohlcv(99), pool, min_tickers=2)
    return pool, context


def _digest(array: np.ndarray) -> str:
    a = np.ascontiguousarray(array)
    if a.dtype == object:
        return hashlib.sha256("\x1f".join(map(str, a.tolist())).encode("utf-8")).hexdigest()
    return hashlib.sha256(a.tobytes()).hexdigest()


def summarize() -> dict:
    """資料集每個陣列的雜湊與形狀、訓練列、標準化參數，以及 XGBoost 在驗證列上的前 20 個機率。"""
    pool, context = _inputs()
    ds = build_cs_dataset(pool, context)
    arrays = {
        "X": ds.X, "y": ds.y, "dates": ds.dates, "tickers": ds.tickers, "ret_label": ds.ret_label,
        "is_train": ds.is_train, "is_val": ds.is_val, "is_test": ds.is_test,
        **{f"ret_{h}": r for h, r in ds.rets_by_h.items()},
    }
    tr = np.where(ds.is_train)[0][::2]
    scaler = StandardScaler().fit(ds.X[tr])
    model = _make_model("xgb")
    model.fit(scaler.transform(ds.X[tr]).astype(np.float32), ds.y[tr])
    probe = model.predict_proba(scaler.transform(ds.X[ds.is_val][:20]).astype(np.float32))[:, 1]
    return {
        "arrays": {name: {"sha256": _digest(a), "shape": list(a.shape), "dtype": str(a.dtype)} for name, a in arrays.items()},
        "train_rows": _digest(tr),
        "scaler_mean": _digest(scaler.mean_),
        "scaler_scale": _digest(scaler.scale_),
        "probe": [float(p) for p in probe],
    }


@pytest.fixture(scope="module")
def actual() -> dict:
    return summarize()


@pytest.fixture(scope="module")
def golden() -> dict:
    return json.loads(GOLDEN_PATH.read_text(encoding="utf-8"))


def test_cs_dataset_matches_golden(actual, golden):
    assert actual["arrays"] == golden["arrays"]


def test_cs_training_rows_and_scaler_match_golden(actual, golden):
    assert actual["train_rows"] == golden["train_rows"]
    assert actual["scaler_mean"] == golden["scaler_mean"]
    assert actual["scaler_scale"] == golden["scaler_scale"]


def test_cs_model_probe_matches_golden(actual, golden):
    np.testing.assert_allclose(actual["probe"], golden["probe"], rtol=1e-6)


def test_fit_cs_matches_the_training_path(golden):
    """fit_cs 與 train() 走同一條路：同樣的訓練列、同樣的標準化、同樣的機率。"""
    pool, context = _inputs()
    ds = build_cs_dataset(pool, context)
    model, scaler, tr = fit_cs(ds.X, ds.y, ds.is_train)

    assert _digest(tr) == golden["train_rows"]
    probe = model.predict_proba(scaler.transform(ds.X[ds.is_val][:20]).astype(np.float32))[:, 1]
    np.testing.assert_allclose(probe, golden["probe"], rtol=1e-6)
