"""推論基準日與暖機期計算。

台股 13:30 收盤；盤中呼叫預測 API 若以「今天」為基準，會拿到未完成的當日 K 棒，
同一天內同一支股票會算出不同特徵與不同預測結果。所有推論都必須以
last_completed_trading_day() 的回傳值為錨點，不可直接用 date.today()。
"""

from datetime import date, datetime, time, timedelta

from stockta.config import MARKET_CLOSE_HOUR, MARKET_CLOSE_MINUTE, MARKET_INDEX_TICKER, TAIPEI_TZ
from stockta.data.cache import ParquetCache


def last_completed_trading_day(now: datetime | None = None) -> date:
    """回傳最後一個已收盤、可信賴用於特徵計算的交易日。

    週末不算交易日；國定假日不在此處理——yfinance 本身不會回傳休市日的資料，
    下游以「資料是否存在」為準，此函式只保證不會落在未來或未收盤的當日。
    """
    now = now.astimezone(TAIPEI_TZ) if now is not None else datetime.now(TAIPEI_TZ)
    close_time = time(MARKET_CLOSE_HOUR, MARKET_CLOSE_MINUTE)
    candidate = now.date() if now.time() >= close_time else now.date() - timedelta(days=1)
    while candidate.weekday() >= 5:  # 5=Sat, 6=Sun
        candidate -= timedelta(days=1)
    return candidate


def market_sessions(cache: ParquetCache) -> list[date]:
    """實際交易日：快取裡大盤指數有 K 棒的日子（連假、颱風假不在裡面）；沒有快取時回空清單。"""
    market = cache.read(MARKET_INDEX_TICKER)
    return [] if market is None else [ts.date() for ts in market.index]


def warmup_lookback_days(
    window_length_days: int,
    indicator_warmup_days: int,
    buffer_days: int = 10,
) -> int:
    """推論時需回溯抓取的交易日數 = 滑動視窗長度 + 指標暖機期 + 緩衝。

    緩衝是為了吸收假日造成的交易日密度落差（用日曆天數抓取，但視窗以交易日計）。
    """
    return window_length_days + indicator_warmup_days + buffer_days


# 台股一年約 245 個交易日 / 365 個日曆天，取 1.6 倍換算並保留餘裕
_TRADING_TO_CALENDAR_RATIO = 1.6


def calendar_lookback_days(
    window_length_days: int,
    indicator_warmup_days: int,
    buffer_days: int = 10,
) -> int:
    """推論抓取起日的回溯「日曆天數」（get_ohlcv 以日曆日期指定區間）。"""
    trading_days = warmup_lookback_days(window_length_days, indicator_warmup_days, buffer_days)
    return int(trading_days * _TRADING_TO_CALENDAR_RATIO) + 1


def backfill_sessions(sessions, days: int, not_before: date) -> list:
    """記錄預測時要回補的交易日：最近 days 個交易日，但不早於 not_before（換股票池的生效日）。

    sessions 是依日期排序的交易日索引（市場情境的 DatetimeIndex）。
    """
    recent = list(sessions[-days:]) if days > 0 else []
    return [d for d in recent if d.date() >= not_before]
