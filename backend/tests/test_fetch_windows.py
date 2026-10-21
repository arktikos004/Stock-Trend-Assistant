"""黃金測試：每個價格載入入口抓的區間、順序與快取年限（整併資料源與回溯設定之前擷取）。

以類別層級替換 YFinanceProvider 的建構與 get_ohlcv，記下 max_cache_age_days 與每次的 (代號, 起日, 迄日)；
即時路由用的 app.state.data_provider 換成會記錄的假 provider。入口改用工廠或共用函式之後同樣適用。
這裡的天數一變，就是改到了抓取視窗或快取策略；已記錄的分數不受影響，但重算的分數會變。
"""

from __future__ import annotations

import sqlite3
import sys
from datetime import date, timedelta

import numpy as np
import pandas as pd
import pytest

from stockta.config import MARKET_INDEX_TICKER, SPLIT_TRAIN_END, STOCK_POOL
from stockta.data.calendar import last_completed_trading_day
from stockta.data.provider import DataProvider, DataProviderError, YFinanceProvider
from tests.conftest import FAKE_CS_MODEL, FakePredictor

POOL = list(STOCK_POOL)
MKT = MARKET_INDEX_TICKER
AS_OF = date(2026, 3, 2)  # 歷史查詢的固定基準日（星期一）


class Sentinel(Exception):
    """抓到大盤時丟出，讓回測類入口在抓完資料後就停下。"""


def _frame() -> pd.DataFrame:
    rng = np.random.default_rng(7)
    idx = pd.bdate_range("2003-01-01", "2027-12-31")
    close = 100.0 * np.cumprod(1 + (rng.random(len(idx)) - 0.5) * 0.04)
    spread = rng.random(len(idx)) * 0.01
    return pd.DataFrame(
        {
            "open": close * (1 + (rng.random(len(idx)) - 0.5) * 0.01),
            "high": close * (1 + spread),
            "low": close * (1 - spread),
            "close": close,
            "volume": rng.integers(500_000, 5_000_000, len(idx)).astype(float),
        },
        index=idx,
    )


FRAME = _frame()


class Calls:
    def __init__(self):
        self.ages: list[float] = []  # 每次建構 YFinanceProvider 的 max_cache_age_days
        self.yf: list[tuple[str, date, date]] = []  # YFinanceProvider.get_ohlcv
        self.state: list[tuple[str, date, date]] = []  # app.state.data_provider.get_ohlcv
        self.fail: set[str] = set()  # 這些代號丟 DataProviderError
        self.sentinel: set[str] = set()  # 這些代號丟 Sentinel


def _slice(calls: Calls, ticker: str, start: date, end: date) -> pd.DataFrame:
    if ticker in calls.sentinel:
        raise Sentinel(ticker)
    if ticker in calls.fail:
        raise DataProviderError(f"{ticker} 測試用失敗")
    return FRAME.loc[pd.Timestamp(start) : pd.Timestamp(end)].copy()


class RecordingProvider(DataProvider):
    def __init__(self, calls: Calls):
        self.calls = calls

    def get_ohlcv(self, ticker: str, start: date, end: date) -> pd.DataFrame:
        self.calls.state.append((ticker, start, end))
        return _slice(self.calls, ticker, start, end)


@pytest.fixture
def calls(monkeypatch) -> Calls:
    recorded = Calls()

    def init(self, cache=None, auto_adjust=True, max_cache_age_days=1.0, official=None):
        recorded.ages.append(max_cache_age_days)

    def get(self, ticker, start, end):
        recorded.yf.append((ticker, start, end))
        return _slice(recorded, ticker, start, end)

    monkeypatch.setattr(YFinanceProvider, "__init__", init)
    monkeypatch.setattr(YFinanceProvider, "get_ohlcv", get)
    return recorded


def _window(tickers, start: date, end: date) -> list[tuple[str, date, date]]:
    return [(t, start, end) for t in tickers]


def _days(n: int) -> timedelta:
    return timedelta(days=n)


class _Identity:
    def transform(self, x):
        return x


class _ThreeClass:
    def predict_proba(self, x):
        return np.tile([0.2, 0.3, 0.5], (len(x), 1))


class ReplayPredictor(FakePredictor):
    """歷史回放（scan_asof、history_series）直接用 _scaler 與 _model。"""

    _scaler = _Identity()
    _model = _ThreeClass()


@pytest.fixture
def api(client_with_model, calls, monkeypatch, tmp_path):
    from stockta.api.routers import monitor as monitor_router

    monkeypatch.setattr(monitor_router, "PREDICTIONS_DB_PATH", tmp_path / "none.db")
    state = client_with_model.app.state
    state.data_provider = RecordingProvider(calls)
    state.predictor = ReplayPredictor()
    return client_with_model


# ── API：歷史查詢讀本機快取（9999） ──────────────────────────────────


def test_rank_on_a_past_date(api, calls):
    assert api.get(f"/api/rank?date={AS_OF}").status_code == 200
    assert calls.ages == [9999]
    assert calls.yf == _window([*POOL, MKT], AS_OF - _days(345), AS_OF)
    assert calls.state == []


def test_scan_on_a_past_date(api, calls):
    assert api.get(f"/api/scan?date={AS_OF}").status_code == 200
    assert calls.ages == [9999]
    assert calls.yf == _window([*POOL, MKT], AS_OF - _days(345), AS_OF + _days(20))


def test_scan_on_a_past_date_without_the_index(api, calls):
    calls.fail.add(MKT)
    r = api.get(f"/api/scan?date={AS_OF}")
    assert r.status_code == 503
    assert "歷史大盤資料不足" in r.text


def test_history_replay(api, calls):
    start, end = date(2026, 2, 2), AS_OF
    assert api.get(f"/api/stocks/2330.TW/history?start={start}&end={end}").status_code == 200
    assert calls.ages == [9999]
    assert calls.yf == _window([*POOL, MKT], start - _days(345), end + _days(21))


# ── API：即時路由讀 app.state.data_provider ───────────────────────────


@pytest.mark.parametrize("path", ["/api/stocks/2330.TW/prediction", "/api/stocks/2330.TW/indicators"])
def test_live_stock_routes(api, calls, path):
    end = last_completed_trading_day()
    assert api.get(path).status_code == 200
    assert calls.state == [("2330.TW", end - _days(305), end)]
    assert calls.ages == [] and calls.yf == []


def test_live_rank(api, calls):
    end = last_completed_trading_day()
    assert api.get("/api/rank").status_code == 200
    assert calls.state == _window(POOL, end - _days(305), end)


def test_screener(api, calls):
    end = last_completed_trading_day()
    r = api.get("/api/screener")
    assert r.status_code == 200
    as_of = date.fromisoformat(r.json()["base_date"])
    assert calls.state == _window(POOL, end - _days(305), end) + _window(POOL, as_of - _days(305), as_of)


def test_monitor_week52(api, calls):
    as_of = last_completed_trading_day()  # 沒有已記錄的排序時以最後交易日為準
    assert api.get("/api/monitor").status_code == 200
    assert calls.state == _window(POOL, as_of - _days(400), as_of)


# ── 每日紀錄 ─────────────────────────────────────────────────────────


@pytest.fixture
def recorder_db(monkeypatch, tmp_path):
    from stockta.ml import record_predictions, record_rank_predictions

    db = tmp_path / "predictions.db"
    monkeypatch.setattr(record_predictions, "PREDICTIONS_DB_PATH", db)
    monkeypatch.setattr(record_rank_predictions, "PREDICTIONS_DB_PATH", db)
    monkeypatch.setattr(record_predictions.Predictor, "from_registry", lambda *a, **k: FakePredictor())
    return db


def test_record_predictions(calls, recorder_db, monkeypatch):
    from stockta.ml import record_predictions

    monkeypatch.setattr(sys, "argv", ["record_predictions", "--days", "1"])
    end = last_completed_trading_day()
    assert record_predictions.main() in (0, 2)
    assert calls.ages == [1.0]
    assert calls.yf == _window([*POOL, MKT], end - _days(365), end)


def test_record_predictions_stops_without_the_index(calls, recorder_db, monkeypatch):
    from stockta.ml import record_predictions

    monkeypatch.setattr(sys, "argv", ["record_predictions", "--days", "1"])
    calls.fail.add(MKT)
    assert record_predictions.main() == 1


def _rank_store(db):
    from stockta.inference.store import RankPredictionStore

    return RankPredictionStore(db)


def test_record_rank_live(calls, recorder_db):
    from stockta.ml.record_rank_predictions import run_live

    model, scaler, _meta = FAKE_CS_MODEL
    end = last_completed_trading_day()
    assert run_live(_rank_store(recorder_db), model, scaler, "fake-cs", days=1) in (0, 2)
    assert calls.ages == [1.0]
    assert calls.yf == _window([*POOL, MKT], end - _days(365), end)


def test_record_rank_live_stops_without_the_index(calls, recorder_db):
    from stockta.ml.record_rank_predictions import run_live

    model, scaler, _meta = FAKE_CS_MODEL
    calls.fail.add(MKT)
    assert run_live(_rank_store(recorder_db), model, scaler, "fake-cs", days=1) == 1


def test_record_rank_backfill(calls, recorder_db):
    from stockta.ml.record_rank_predictions import run_backfill

    conn = sqlite3.connect(recorder_db)
    conn.execute("CREATE TABLE IF NOT EXISTS predictions (base_date TEXT)")
    conn.executemany("INSERT INTO predictions VALUES (?)", [("2026-03-02",), ("2026-03-03",)])
    conn.commit()
    conn.close()
    model, scaler, _meta = FAKE_CS_MODEL
    run_backfill(_rank_store(recorder_db), model, scaler, "fake-cs")
    first, second = date(2026, 3, 2), date(2026, 3, 3)
    assert calls.ages == [9999]
    assert calls.yf == _window([*POOL, MKT], first - _days(345), first) + _window([*POOL, MKT], second - _days(345), second)


# ── 研究用載入 ───────────────────────────────────────────────────────


def test_train_loaders(calls):
    from stockta.ml.train import load_market_context, load_pool_ohlcv

    end = last_completed_trading_day()
    pool = load_pool_ohlcv()
    load_market_context(pool)
    assert calls.ages == [3.0, 3.0]
    assert calls.yf == _window([*POOL, MKT], end - _days(7300), end)


def test_train_loader_with_no_data(calls):
    from stockta.ml.train import load_pool_ohlcv

    calls.fail.update(POOL)
    with pytest.raises(SystemExit):
        load_pool_ohlcv()


def test_walkforward_loader(calls):
    from stockta.ml.walkforward import _load_inputs

    end = last_completed_trading_day()
    _load_inputs()
    assert calls.ages == [3.0]
    assert calls.yf == _window([*POOL, MKT], end - _days(7300), end)


def test_walkforward_loader_with_no_data(calls):
    from stockta.ml.walkforward import _load_inputs

    calls.fail.update(POOL)
    with pytest.raises(SystemExit):
        _load_inputs()


def test_backtest_loader(calls, monkeypatch):
    from stockta.ml import backtest

    monkeypatch.setattr(backtest.Predictor, "from_registry", lambda *a, **k: FakePredictor())
    monkeypatch.setattr(sys, "argv", ["backtest", "--start", "2025-12-31"])
    calls.sentinel.add(MKT)
    end = last_completed_trading_day()
    with pytest.raises(Sentinel):
        backtest.main()
    assert calls.ages == [1.0]
    assert calls.yf == _window([*POOL, MKT], date(2025, 12, 31) - _days(730), end)


def test_calibrate_loader(calls, monkeypatch):
    from stockta.ml import calibrate

    monkeypatch.setattr(calibrate.Predictor, "from_registry", lambda *a, **k: FakePredictor())
    calls.sentinel.add(MKT)
    end = last_completed_trading_day()
    with pytest.raises(Sentinel):
        calibrate.main()
    assert calls.ages == [1.0]
    assert calls.yf == _window([*POOL, MKT], date.fromisoformat(SPLIT_TRAIN_END) - _days(730), end)


def test_fetch_cli(calls, monkeypatch, tmp_path):
    from stockta.data import fetch

    monkeypatch.setattr(fetch, "DOCS_DIR", tmp_path)
    monkeypatch.setattr(fetch, "PAUSE_SECONDS", 0)
    end = last_completed_trading_day()
    fetch.main([])
    assert calls.ages == [0.0]
    assert calls.yf == _window([*POOL, MKT], end - _days(7300), end)
    assert (tmp_path / "data_exploration.md").exists()


def test_fetch_cli_from_a_fixed_start_without_the_report(calls, monkeypatch, tmp_path):
    from stockta.data import fetch

    monkeypatch.setattr(fetch, "DOCS_DIR", tmp_path)
    monkeypatch.setattr(fetch, "PAUSE_SECONDS", 0)
    end = last_completed_trading_day()
    fetch.main(["--start", "2004-01-01", "--tickers", "2330.TW", "2317.TW", "--no-report"])
    assert calls.ages == [0.0]
    assert calls.yf == _window(["2330.TW", "2317.TW", MKT], date(2004, 1, 1), end)
    assert not (tmp_path / "data_exploration.md").exists()


def test_training_loaders_from_a_fixed_start(calls):
    from stockta.ml.train import load_market_context, load_pool_ohlcv

    end = last_completed_trading_day()
    load_market_context(load_pool_ohlcv(start=date(2004, 1, 1)), start=date(2004, 1, 1))
    assert calls.yf == _window([*POOL, MKT], date(2004, 1, 1), end)


def test_market_context_service(calls):
    from stockta.inference.market_context import MarketContextService

    class Cache:
        def read(self, ticker):
            return FRAME

    end = last_completed_trading_day()
    MarketContextService(YFinanceProvider(cache=None, auto_adjust=True), Cache(), POOL).get(end)
    assert calls.yf == [(MKT, end - _days(685), end)]
