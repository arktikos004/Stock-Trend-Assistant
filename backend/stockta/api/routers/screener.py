"""篩選器與綜合評分：GET /api/screener（規則見 docs/screener_prereg.md）。

研究用的候選清單，不是預測、也不是投資建議。排序組成直接取 /api/rank 的即時結果；
動能與技術條件用同一個價格快取（只輸出衍生值）；評價、營收、籌碼讀 twse-data 累積的開放資料。
只提供即時（最近一個已收盤交易日）：開放資料自 2026-10 才開始累積，沒有可重算的歷史。
"""

from datetime import timedelta

from fastapi import APIRouter, Request

from stockta.api.routers.rank import rank as rank_endpoint
from stockta.api.schemas import ScreenerResponse
from stockta.config import INDICATOR_WARMUP_DAYS, STOCK_POOL, TWSE_DATA_DIR, WINDOW_LENGTH_DAYS
from stockta.data.calendar import calendar_lookback_days
from stockta.data.provider import DataProvider, DataProviderError
from stockta.screener import build_screener

router = APIRouter(tags=["screener"])


@router.get("/api/screener", response_model=ScreenerResponse)
def screener(request: Request) -> ScreenerResponse:
    ranked = rank_endpoint(request, date_param=None)
    as_of = ranked.base_date
    provider: DataProvider = request.app.state.data_provider
    start = as_of - timedelta(days=calendar_lookback_days(WINDOW_LENGTH_DAYS, INDICATOR_WARMUP_DAYS))
    closes = {}
    for ticker in STOCK_POOL:
        try:
            closes[ticker] = provider.get_ohlcv(ticker, start, as_of)["close"]
        except DataProviderError:
            continue  # 價格缺漏：動能與技術條件從缺，條件算不符合
    result = build_screener(
        as_of=as_of,
        names=dict(STOCK_POOL),
        rank_pct={r.ticker: r.percentile for r in ranked.results},
        closes=closes,
        data_dir=getattr(request.app.state, "twse_dir", TWSE_DATA_DIR),
    )
    return ScreenerResponse(**result, is_mock=ranked.is_mock)
