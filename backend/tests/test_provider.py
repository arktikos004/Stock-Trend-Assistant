from datetime import date

import pandas as pd
import pytest

from stockta.data.cache import ParquetCache
from stockta.data.provider import DataProviderError, YFinanceProvider, _download

NAN = float("nan")
GOOD_1008 = ("2026-10-08", 2550.0, 2575.0, 2550.0, 2550.0, 20325120)
# Yahoo 在開盤前查詢時回傳的前一個交易日：價格全空，只有成交量
EMPTY_1012 = ("2026-10-12", NAN, NAN, NAN, NAN, 22485758)


def _yahoo(*rows):
    """模擬 yf.download 的回傳：大寫欄名、日期索引；不打真實網路。"""
    df = pd.DataFrame(rows, columns=["Date", "Open", "High", "Low", "Close", "Volume"])
    df["Date"] = pd.to_datetime(df["Date"])
    return df.set_index("Date")


def _cached_prices():
    return pd.DataFrame(
        {
            "open": [2550.0, 2545.0],
            "high": [2575.0, 2560.0],
            "low": [2550.0, 2530.0],
            "close": [2550.0, 2540.0],
            "volume": [20325120, 22485758],
        },
        index=pd.to_datetime(["2026-10-08", "2026-10-12"]),
    )


def test_download_drops_rows_without_prices(monkeypatch):
    monkeypatch.setattr("yfinance.download", lambda *a, **k: _yahoo(GOOD_1008, EMPTY_1012))

    df = _download("2330.TW", date(2026, 10, 1), date(2026, 10, 12), auto_adjust=False)

    assert list(df.index.date) == [date(2026, 10, 8)]


def test_download_with_no_prices_at_all_is_an_error(monkeypatch):
    monkeypatch.setattr("yfinance.download", lambda *a, **k: _yahoo(EMPTY_1012))

    with pytest.raises(DataProviderError):
        _download("2330.TW", date(2026, 10, 1), date(2026, 10, 12), auto_adjust=False)


def test_empty_price_row_does_not_overwrite_cached_prices(monkeypatch, tmp_path):
    cache = ParquetCache(tmp_path)
    cache.write("2330.TW", _cached_prices())
    monkeypatch.setattr("yfinance.download", lambda *a, **k: _yahoo(GOOD_1008, EMPTY_1012))
    provider = YFinanceProvider(cache=cache, auto_adjust=False, max_cache_age_days=0)  # 一律重新下載

    df = provider.get_ohlcv("2330.TW", date(2026, 10, 1), date(2026, 10, 12))

    assert df.loc["2026-10-12", "close"] == 2540.0
    assert cache.read("2330.TW").loc["2026-10-12", "close"] == 2540.0


def test_no_prices_at_all_falls_back_to_cache(monkeypatch, tmp_path):
    cache = ParquetCache(tmp_path)
    cache.write("2330.TW", _cached_prices())
    monkeypatch.setattr("yfinance.download", lambda *a, **k: _yahoo(EMPTY_1012))
    provider = YFinanceProvider(cache=cache, auto_adjust=False, max_cache_age_days=0)

    df = provider.get_ohlcv("2330.TW", date(2026, 10, 1), date(2026, 10, 12))

    assert list(df["close"]) == [2550.0, 2540.0]
