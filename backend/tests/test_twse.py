"""證交所每日資料：日期換算、數字解析、備援 CSV 正規化、只收一次、讀回 K 線。

這份資料錯過一天就補不回來，存檔邏輯若默默覆寫或寫錯日期，損失無法回復——
所以把「已存在不覆寫」「日期一致」這兩條釘死。全部不連網。
"""

import json
from datetime import date

import pytest

from stockta.data.twse import (
    TwseError,
    load_candles,
    parse_number,
    roc_to_date,
    rows_from_csv,
    store,
    stored_days,
    validate_rows,
)


def _row(code: str, roc: str = "1151002", close: str = "2500.00", volume: str = "15792206") -> dict[str, str]:
    return {
        "Date": roc,
        "Code": code,
        "Name": f"股票{code}",
        "TradeVolume": volume,
        "TradeValue": "1",
        "OpeningPrice": "2505.00",
        "HighestPrice": "2515.00",
        "LowestPrice": "2495.00",
        "ClosingPrice": close,
        "Change": "-10.0000",
        "Transaction": "65783",
    }


def _market(roc: str = "1151002", n: int = 600) -> list[dict[str, str]]:
    return [_row("2330", roc)] + [_row(f"{9000 + i}", roc) for i in range(n - 1)]


def test_roc_to_date():
    assert roc_to_date("1151002") == date(2026, 10, 2)
    assert roc_to_date("990104") == date(2010, 1, 4)
    with pytest.raises(TwseError):
        roc_to_date("2026-10-02")


@pytest.mark.parametrize(
    ("text", "expected"),
    [("2,505.00", 2505.0), ("-10.0000", -10.0), ("--", None), ("", None), (None, None), ("X0.00", None)],
)
def test_parse_number(text, expected):
    assert parse_number(text) == expected


def test_csv_fallback_uses_openapi_keys():
    text = (
        "﻿日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數\n"
        '"1151002","2330","台積電","15792206","39508159297","2505.00","2515.00","2495.00","2500.00","-10.0000","65783"\n'
    )
    rows = rows_from_csv(text)
    assert rows == [
        {
            "Date": "1151002",
            "Code": "2330",
            "Name": "台積電",
            "TradeVolume": "15792206",
            "TradeValue": "39508159297",
            "OpeningPrice": "2505.00",
            "HighestPrice": "2515.00",
            "LowestPrice": "2495.00",
            "ClosingPrice": "2500.00",
            "Change": "-10.0000",
            "Transaction": "65783",
        }
    ]


def test_validate_rejects_mixed_dates_and_short_payloads():
    assert validate_rows("STOCK_DAY_ALL", _market()) == date(2026, 10, 2)
    mixed = _market()
    mixed[5] = _row("9999", roc="1151001")
    with pytest.raises(TwseError, match="多個日期"):
        validate_rows("STOCK_DAY_ALL", mixed)
    with pytest.raises(TwseError, match="至少"):
        validate_rows("STOCK_DAY_ALL", _market(n=10))
    without_tsmc = [_row(f"{9000 + i}") for i in range(600)]
    with pytest.raises(TwseError, match="2330"):
        validate_rows("STOCK_DAY_ALL", without_tsmc)


def test_store_writes_once_and_never_overwrites(tmp_path):
    day = date(2026, 10, 2)
    first = store(tmp_path, "STOCK_DAY_ALL", day, _market(), "https://example.invalid/a")
    assert first is not None and first.name == "2026-10-02.json"
    original = first.read_text(encoding="utf-8")

    again = store(tmp_path, "STOCK_DAY_ALL", day, _market(n=700), "https://example.invalid/b")
    assert again is None
    assert first.read_text(encoding="utf-8") == original

    meta = json.loads(original)["meta"]
    assert meta["license_url"] == "https://data.gov.tw/license"
    assert "政府資料開放授權條款" in meta["attribution"]
    assert stored_days(tmp_path) == [day]


def test_load_candles_skips_untraded_days(tmp_path):
    store(tmp_path, "STOCK_DAY_ALL", date(2026, 10, 1), _market("1151001"), "u")
    halted = _market("1151002")
    halted[0] = _row("2330", "1151002", close="--")
    store(tmp_path, "STOCK_DAY_ALL", date(2026, 10, 2), halted, "u")
    store(tmp_path, "STOCK_DAY_ALL", date(2026, 10, 5), _market("1151005"), "u")

    candles = load_candles(tmp_path, "2330")
    assert list(candles.columns) == ["open", "high", "low", "close", "volume"]
    assert [d.date() for d in candles.index] == [date(2026, 10, 1), date(2026, 10, 5)]
    assert candles["close"].iloc[0] == 2500.0
    assert candles.index.is_monotonic_increasing
