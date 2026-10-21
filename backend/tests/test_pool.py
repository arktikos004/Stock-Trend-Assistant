from datetime import date

import pandas as pd
import pytest

from stockta.config import MARKET_INDEX_TICKER
from stockta.data.pool import load_market, load_pool
from stockta.data.provider import DataProvider, DataProviderError


class _Provider(DataProvider):
    def __init__(self, missing: set[str]):
        self.missing = missing
        self.asked: list[str] = []

    def get_ohlcv(self, ticker: str, start: date, end: date) -> pd.DataFrame:
        self.asked.append(ticker)
        if ticker in self.missing:
            raise DataProviderError(f"{ticker} 沒有資料")
        return pd.DataFrame({"close": [1.0]}, index=pd.DatetimeIndex([pd.Timestamp(end)]))


def test_load_pool_keeps_order_and_reports_skips():
    provider = _Provider(missing={"2317.TW"})
    skipped = []
    out = load_pool(provider, date(2026, 1, 1), date(2026, 3, 2), tickers=["2454.TW", "2317.TW", "2330.TW"], on_skip=lambda t, e: skipped.append(t))
    assert list(out) == ["2454.TW", "2330.TW"]
    assert provider.asked == ["2454.TW", "2317.TW", "2330.TW"]
    assert skipped == ["2317.TW"]


def test_load_market_propagates_errors():
    with pytest.raises(DataProviderError):
        load_market(_Provider(missing={MARKET_INDEX_TICKER}), date(2026, 1, 1), date(2026, 3, 2))
