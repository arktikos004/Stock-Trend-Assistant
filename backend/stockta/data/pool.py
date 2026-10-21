"""全池個股與大盤指數的載入：每個價格入口共用。

這裡只負責抓資料。抓不到的個股略過（可用 on_skip 記下原因），大盤抓不到時 DataProviderError 照樣往外拋；
之後要回錯誤、印訊息後結束，還是整個停下，由呼叫端決定。
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from datetime import date

import pandas as pd

from stockta.config import MARKET_INDEX_TICKER, STOCK_POOL
from stockta.data.provider import DataProvider, DataProviderError


def print_skip(ticker: str, exc: DataProviderError) -> None:
    """命令列工具共用的略過訊息。"""
    print(f"[略過] {ticker}: {exc}")


def load_pool(
    provider: DataProvider,
    start: date,
    end: date,
    tickers: Iterable[str] | None = None,
    on_skip: Callable[[str, DataProviderError], None] | None = None,
) -> dict[str, pd.DataFrame]:
    """依 tickers（預設 STOCK_POOL）的順序逐檔抓 OHLCV；抓不到的略過。"""
    out: dict[str, pd.DataFrame] = {}
    for ticker in STOCK_POOL if tickers is None else tickers:
        try:
            out[ticker] = provider.get_ohlcv(ticker, start, end)
        except DataProviderError as exc:
            if on_skip is not None:
                on_skip(ticker, exc)
    return out


def load_market(provider: DataProvider, start: date, end: date) -> pd.DataFrame:
    """大盤指數（MARKET_INDEX_TICKER）的 OHLCV。"""
    return provider.get_ohlcv(MARKET_INDEX_TICKER, start, end)
