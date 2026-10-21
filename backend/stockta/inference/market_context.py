"""API 端市場情境服務：^TWII 走 DataProvider（快取＋網路降級），
市場寬度只讀本地 parquet 快取（單檔預測不為整個股票池連網）。

寬度依賴全池快取的新鮮度——每日排程 record_predictions 會刷新全池；
若快取落後大盤（例如排程沒跑），拋 DataProviderError 提示，而不是
默默用舊寬度或讓 base_date 悄悄倒退。以 end 日期記憶化，同日多次請求零成本。
"""

from __future__ import annotations

from datetime import date, timedelta

import pandas as pd

from stockta.config import MARKET_INDEX_TICKER
from stockta.data.cache import ParquetCache
from stockta.data.calendar import SERVICE_LOOKBACK_DAYS
from stockta.data.provider import DataProvider, DataProviderError
from stockta.features.market import build_market_context


class MarketContextService:
    def __init__(self, provider: DataProvider, cache: ParquetCache, pool: list[str]):
        self._provider = provider
        self._cache = cache
        self._pool = pool
        # context 要涵蓋個股特徵的整段回溯，加上 regime 欄位（MA200、一年回撤、波動百分位）的暖機：
        # 回溯不夠時 build_market_context 的 dropna 會把整段 context 清空、推論直接失敗（實驗 #9）
        self._lookback_days = SERVICE_LOOKBACK_DAYS
        self._memo: dict[date, pd.DataFrame] = {}

    def get(self, end: date) -> pd.DataFrame:
        if end in self._memo:
            return self._memo[end]
        start = end - timedelta(days=self._lookback_days)

        market = self._provider.get_ohlcv(MARKET_INDEX_TICKER, start, end)

        pool_ohlcv: dict[str, pd.DataFrame] = {}
        for ticker in self._pool:
            df = self._cache.read(ticker)
            if df is None:
                continue
            sliced = df.loc[pd.Timestamp(start) : pd.Timestamp(end)]
            if not sliced.empty:
                pool_ohlcv[ticker] = sliced

        context = build_market_context(market, pool_ohlcv)
        if context.empty or context.index[-1] < market.index[-1]:
            raise DataProviderError(
                "市場寬度資料落後大盤（股票池快取過舊或不足），"
                "請先執行 python -m stockta.ml.record_predictions 或 python -m stockta.data.fetch"
            )
        self._memo[end] = context
        return context
