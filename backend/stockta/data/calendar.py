"""推論基準日與暖機期計算。

台股 13:30 收盤；盤中呼叫預測 API 若以「今天」為基準，會拿到未完成的當日 K 棒，
同一天內同一支股票會算出不同特徵與不同預測結果。所有推論都必須以
last_completed_trading_day() 的回傳值為錨點，不可直接用 date.today()。
"""

from datetime import date, datetime, time, timedelta

from stockta.config import (
    HISTORY_YEARS,
    INDICATOR_WARMUP_DAYS,
    MARKET_CLOSE_HOUR,
    MARKET_CLOSE_MINUTE,
    MARKET_INDEX_TICKER,
    MARKET_REGIME_WINDOW_DAYS,
    TAIPEI_TZ,
    WINDOW_LENGTH_DAYS,
)
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


# ── 抓取視窗（日曆天）：每個價格載入入口往前抓多少、往後多抓多少，都在這裡 ──

# 一個視窗加指標暖機：即時推論（/prediction、/indicators、即時排序、篩選器）
FEATURE_LOOKBACK_DAYS = calendar_lookback_days(WINDOW_LENGTH_DAYS, INDICATOR_WARMUP_DAYS)
# 歷史重算（?date=、history、排序回補）為市場情境 rolling 多抓的暖機
REPLAY_CONTEXT_EXTRA_DAYS = 40
# 每日紀錄為市場情境 rolling 多抓的暖機
RECORD_CONTEXT_EXTRA_DAYS = 60
# 市場情境服務：regime 欄位的暖機（MARKET_REGIME_WINDOW_DAYS）再加 rolling 餘裕
SERVICE_CONTEXT_EXTRA_DAYS = 60
SERVICE_LOOKBACK_DAYS = (
    calendar_lookback_days(WINDOW_LENGTH_DAYS, INDICATOR_WARMUP_DAYS + MARKET_REGIME_WINDOW_DAYS) + SERVICE_CONTEXT_EXTRA_DAYS
)
# 歷史查詢在迄日之後多抓：邊界附近的預測才算得出實際 5 日走勢（否則末幾日被當成未到期）
SCAN_FETCH_AHEAD_DAYS = 20
HISTORY_FETCH_AHEAD_DAYS = 21
# 回測與門檻校準：在起點之前多抓的歷史（特徵暖機加一個視窗）
REPORT_WARMUP_DAYS = 730
# 52 週新高新低
WEEK52_FETCH_DAYS = 400
# 訓練、walk-forward 與資料擷取：近 HISTORY_YEARS 年
HISTORY_DAYS = HISTORY_YEARS * 365


def feature_fetch_start(end: date) -> date:
    """即時推論的抓取起日：一個視窗加指標暖機。"""
    return end - timedelta(days=FEATURE_LOOKBACK_DAYS)


def replay_fetch_start(as_of: date) -> date:
    """歷史重算的抓取起日：一個視窗、指標暖機，再加市場情境的暖機。"""
    return as_of - timedelta(days=FEATURE_LOOKBACK_DAYS + REPLAY_CONTEXT_EXTRA_DAYS)


def record_fetch_start(end: date) -> date:
    """每日紀錄的抓取起日（全池與大盤）。"""
    return end - timedelta(days=FEATURE_LOOKBACK_DAYS + RECORD_CONTEXT_EXTRA_DAYS)


def history_fetch_start(end: date) -> date:
    """訓練與資料擷取的抓取起日：近 HISTORY_YEARS 年。"""
    return end - timedelta(days=HISTORY_DAYS)


def backfill_sessions(sessions, days: int, not_before: date) -> list:
    """記錄預測時要回補的交易日：最近 days 個交易日，但不早於 not_before（換股票池的生效日）。

    sessions 是依日期排序的交易日索引（市場情境的 DatetimeIndex）。
    """
    recent = list(sessions[-days:]) if days > 0 else []
    return [d for d in recent if d.date() >= not_before]
