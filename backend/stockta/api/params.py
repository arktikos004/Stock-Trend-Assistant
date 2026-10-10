"""查詢參數的共用解析：日期格式錯誤或起訖顛倒時回 422 INVALID_RANGE，訊息說明是哪個參數錯。"""

from datetime import date

from stockta.api.errors import InvalidDateRangeError


def parse_iso_date(value: str, field: str) -> date:
    """YYYY-MM-DD → date；格式錯誤時丟 InvalidDateRangeError，訊息帶參數名稱與原值。"""
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise InvalidDateRangeError(f"日期格式需為 YYYY-MM-DD：{field}={value!r}") from exc


def require_ordered(start: date, end: date) -> None:
    """起日必須早於迄日。"""
    if start >= end:
        raise InvalidDateRangeError(f"起日需早於迄日：{start} ~ {end}")
