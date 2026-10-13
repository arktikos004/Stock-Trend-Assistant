"""OHLCV 資料存取介面。

訓練管線與 API 都只依賴 DataProvider 這個介面，不直接呼叫 yfinance——
這是本專案唯一與不穩定外部服務（yfinance 爬 Yahoo 非官方介面，會限流、會改版）
的接觸點，測試一律注入假的 DataProvider 實作，不打真實網路。
"""

from __future__ import annotations

import abc
from collections.abc import Callable
from datetime import date, timedelta

import pandas as pd

from stockta.data.cache import ParquetCache

_OHLCV_COLUMNS = ["open", "high", "low", "close", "volume"]


class DataProviderError(RuntimeError):
    """資料來源無法提供資料（連網失敗且無可用快取，或指定區間內無資料）。"""


class DataProvider(abc.ABC):
    @abc.abstractmethod
    def get_ohlcv(self, ticker: str, start: date, end: date) -> pd.DataFrame:
        """回傳欄位為 open/high/low/close/volume、以日期為索引（遞增排序）的 DataFrame。"""
        raise NotImplementedError


class YFinanceProvider(DataProvider):
    """以 yfinance 為資料源，內建 parquet 快取與連網失敗降級。

    策略：快取夠新則直接用快取；否則嘗試下載最新資料並與快取合併回存；
    下載失敗時退回舊快取（若涵蓋所需區間），只有兩者皆不可用才拋出例外。
    合併後若有交易日的價格是空值或整天缺漏，用 official（預設為證交所盤後資料）補上（_fill_gaps）。
    """

    def __init__(
        self,
        cache: ParquetCache,
        auto_adjust: bool,
        max_cache_age_days: float = 1.0,
        official: Callable[[str], pd.DataFrame | None] | None = None,
    ):
        self._cache = cache
        self._auto_adjust = auto_adjust
        self._max_cache_age_days = max_cache_age_days
        self._official = official if official is not None else _twse_candles

    def get_ohlcv(self, ticker: str, start: date, end: date) -> pd.DataFrame:
        cached = self._cache.read(ticker)

        if cached is not None and self._cache.is_fresh(ticker, self._max_cache_age_days):
            sliced = _slice(cached, start, end)
            if sliced is not None:
                return sliced

        try:
            fresh = _download(ticker, start, end, self._auto_adjust)
        except Exception as exc:
            sliced = _slice(cached, start, end) if cached is not None else None
            if sliced is not None:
                return sliced
            raise DataProviderError(f"無法取得 {ticker} 的資料，且無可用快取") from exc

        merged = _merge(cached, fresh) if cached is not None else fresh
        merged = _fill_gaps(merged, self._official(ticker))
        self._cache.write(ticker, merged)

        sliced = _slice(merged, start, end)
        if sliced is None:
            raise DataProviderError(f"{ticker} 在 {start}–{end} 區間內無資料")
        return sliced


def _download(ticker: str, start: date, end: date, auto_adjust: bool) -> pd.DataFrame:
    import yfinance as yf

    df = yf.download(
        ticker,
        start=start,
        end=end + timedelta(days=1),  # yfinance 的 end 是不含端點，+1 天才含 end 當天
        auto_adjust=auto_adjust,
        progress=False,
    )
    if df.empty:
        raise DataProviderError(f"yfinance 回傳 {ticker} 空資料")

    if isinstance(df.columns, pd.MultiIndex):
        df = df.droplevel(1, axis=1)
    df = df.rename(columns=str.lower)[_OHLCV_COLUMNS]
    # Yahoo 偶爾回傳價格全空、只有成交量的列（例如開盤前查詢時的前一個交易日）。
    # 這種列不能進快取：_merge 以新下載的為準，會把快取裡同一天的正確價格蓋成空值
    df = df.dropna(subset=["open", "high", "low", "close"])
    if df.empty:
        raise DataProviderError(f"yfinance 回傳 {ticker} 的價格全為空值")
    return df.sort_index()


def _twse_candles(ticker: str) -> pd.DataFrame | None:
    """證交所盤後資料裡這檔上市股票的日 K（未還原權值）；不是上市股票或沒有資料目錄時回 None。"""
    if not ticker.endswith(".TW"):
        return None
    from stockta.config import TWSE_DATA_DIR
    from stockta.data.twse import load_candles

    if not TWSE_DATA_DIR.exists():
        return None
    frame = load_candles(TWSE_DATA_DIR, ticker.removesuffix(".TW"))
    return frame if not frame.empty else None


def _fill_gaps(df: pd.DataFrame, official: pd.DataFrame | None) -> pd.DataFrame:
    """價格是空值或整天缺漏的交易日，用官方日 K 補上（Yahoo 曾把 2026-10-12 的台股價格全給成空值）。

    Yahoo 的價格經過還原權值，只有之後沒有除權息時才等於官方的原始成交價：
    補的那天之前最近一個兩邊都有價格的交易日，收盤價一致才補；對不上就不補，維持原樣。
    """
    if official is None or official.empty or df.empty:
        return df
    prices = ["open", "high", "low", "close"]
    span = official.loc[(official.index >= df.index.min()) & (official.index <= df.index.max())]
    gaps = [d for d in span.index if d not in df.index or df.loc[d, prices].isna().any()]
    if not gaps:
        return df
    good = df.dropna(subset=prices)
    out = df.copy()
    for day in gaps:
        prior = [d for d in good.index if d < day and d in official.index]
        if not prior or abs(good.loc[prior[-1], "close"] / official.loc[prior[-1], "close"] - 1) > 5e-4:
            continue
        out.loc[day, _OHLCV_COLUMNS] = official.loc[day, _OHLCV_COLUMNS].to_numpy(dtype=float)
    return out.sort_index()


def _merge(old: pd.DataFrame, new: pd.DataFrame) -> pd.DataFrame:
    combined = pd.concat([old, new])
    return combined[~combined.index.duplicated(keep="last")].sort_index()


def _slice(df: pd.DataFrame, start: date, end: date) -> pd.DataFrame | None:
    sliced = df.loc[pd.Timestamp(start) : pd.Timestamp(end)]
    return sliced if not sliced.empty else None
