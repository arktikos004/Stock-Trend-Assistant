from datetime import date

import pandas as pd
import pytest

from stockta.data.cache import ParquetCache
from stockta.data import provider as provider_module
from stockta.data.provider import CacheOnlyProvider, DataProviderError, YFinanceProvider, _download

NAN = float("nan")
GOOD_1008 = ("2026-10-08", 2550.0, 2575.0, 2550.0, 2550.0, 20325120)
# Yahoo 在開盤前查詢時回傳的前一個交易日：價格全空，只有成交量
EMPTY_1012 = ("2026-10-12", NAN, NAN, NAN, NAN, 22485758)


def _no_official(ticker):
    return None


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
    provider = YFinanceProvider(cache=cache, auto_adjust=False, max_cache_age_days=0, official=_no_official)  # 一律重新下載

    df = provider.get_ohlcv("2330.TW", date(2026, 10, 1), date(2026, 10, 12))

    assert df.loc["2026-10-12", "close"] == 2540.0
    assert cache.read("2330.TW").loc["2026-10-12", "close"] == 2540.0


def test_no_prices_at_all_falls_back_to_cache(monkeypatch, tmp_path):
    cache = ParquetCache(tmp_path)
    cache.write("2330.TW", _cached_prices())
    monkeypatch.setattr("yfinance.download", lambda *a, **k: _yahoo(EMPTY_1012))
    provider = YFinanceProvider(cache=cache, auto_adjust=False, max_cache_age_days=0, official=_no_official)

    df = provider.get_ohlcv("2330.TW", date(2026, 10, 1), date(2026, 10, 12))

    assert list(df["close"]) == [2550.0, 2540.0]


def _official_prices(close_1008: float = 2550.0):
    """證交所盤後資料的形狀：小寫欄名、日期索引、未還原權值。"""
    return pd.DataFrame(
        {
            "open": [2550.0, 2545.0, 2500.0],
            "high": [2575.0, 2560.0, 2510.0],
            "low": [2550.0, 2530.0, 2490.0],
            "close": [close_1008, 2540.0, 2490.0],
            "volume": [20325120, 13748000, 40545889],
        },
        index=pd.to_datetime(["2026-10-08", "2026-10-12", "2026-10-13"]),
    )


def _polluted_cache(tmp_path):
    cache = ParquetCache(tmp_path)
    prices = _cached_prices()
    prices.loc[pd.Timestamp("2026-10-12"), ["open", "high", "low", "close"]] = NAN
    cache.write("2330.TW", prices)
    return cache


def test_empty_day_is_filled_from_official_prices(monkeypatch, tmp_path):
    cache = _polluted_cache(tmp_path)
    monkeypatch.setattr("yfinance.download", lambda *a, **k: _yahoo(GOOD_1008, EMPTY_1012))
    provider = YFinanceProvider(cache=cache, auto_adjust=False, max_cache_age_days=0, official=lambda t: _official_prices())

    df = provider.get_ohlcv("2330.TW", date(2026, 10, 1), date(2026, 10, 12))

    assert df.loc["2026-10-12", "close"] == 2540.0
    assert cache.read("2330.TW").loc["2026-10-12", "volume"] == 13748000


def test_empty_day_is_not_filled_after_a_corporate_action(monkeypatch, tmp_path):
    # 之前一天的還原價和官方原始價對不上：之後有除權息，官方價格不能直接補
    cache = _polluted_cache(tmp_path)
    monkeypatch.setattr("yfinance.download", lambda *a, **k: _yahoo(GOOD_1008, EMPTY_1012))
    official = _official_prices(close_1008=2600.0)
    provider = YFinanceProvider(cache=cache, auto_adjust=False, max_cache_age_days=0, official=lambda t: official)

    df = provider.get_ohlcv("2330.TW", date(2026, 10, 1), date(2026, 10, 12))

    assert pd.isna(df.loc["2026-10-12", "close"])


def test_missing_day_is_added_from_official_prices(monkeypatch, tmp_path):
    # Yahoo 整天漏掉 10/12、快取也沒有：補上官方那一天
    cache = ParquetCache(tmp_path)
    monkeypatch.setattr("yfinance.download", lambda *a, **k: _yahoo(GOOD_1008, ("2026-10-13", 2500.0, 2510.0, 2490.0, 2490.0, 40545889)))
    provider = YFinanceProvider(cache=cache, auto_adjust=False, max_cache_age_days=0, official=lambda t: _official_prices())

    df = provider.get_ohlcv("2330.TW", date(2026, 10, 1), date(2026, 10, 13))

    assert list(df.index.date) == [date(2026, 10, 8), date(2026, 10, 12), date(2026, 10, 13)]
    assert df.loc["2026-10-12", "close"] == 2540.0


def test_cache_only_provider_never_downloads(tmp_path, monkeypatch):
    def refuse(*args, **kwargs):
        raise AssertionError("CacheOnlyProvider 不得下載")

    monkeypatch.setattr(provider_module, "_download", refuse)
    cache = ParquetCache(tmp_path)
    frame = pd.DataFrame(
        {"open": [1.0, 2.0], "high": [1.0, 2.0], "low": [1.0, 2.0], "close": [1.0, 2.0], "volume": [10.0, 20.0]},
        index=pd.DatetimeIndex(["2026-01-05", "2026-01-06"]),
    )
    cache.write("2330.TW", frame)
    provider = CacheOnlyProvider(cache)

    assert len(provider.get_ohlcv("2330.TW", date(2026, 1, 1), date(2026, 1, 31))) == 2
    with pytest.raises(DataProviderError):
        provider.get_ohlcv("2317.TW", date(2026, 1, 1), date(2026, 1, 31))  # 沒有快取檔
    with pytest.raises(DataProviderError):
        provider.get_ohlcv("2330.TW", date(2025, 1, 1), date(2025, 1, 31))  # 區間內沒有資料
