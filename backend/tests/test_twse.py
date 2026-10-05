"""證交所每日資料：日期換算、數字解析、CSV 正規化、兩個出口都收、只收一次、讀回 K 線。

這份資料錯過一天就補不回來，存檔邏輯若默默覆寫或寫錯日期，損失無法回復——
所以把「已存在不覆寫」「日期一致」「兩個出口日期不同時兩天都收」釘死。全部不連網。
"""

import json
from datetime import date

import pytest

from stockta.data import twse
from stockta.data.twse import (
    TwseError,
    fetch_available,
    load_candles,
    parse_number,
    roc_to_date,
    rows_from_csv,
    store,
    stored_days,
    validate_rows,
)

_KEYS = (
    "Date",
    "Code",
    "Name",
    "TradeVolume",
    "TradeValue",
    "OpeningPrice",
    "HighestPrice",
    "LowestPrice",
    "ClosingPrice",
    "Change",
    "Transaction",
)
_CSV_HEADER = "日期,證券代號,證券名稱,成交股數,成交金額,開盤價,最高價,最低價,收盤價,漲跌價差,成交筆數"


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


def _openapi_body(roc: str) -> bytes:
    return json.dumps(_market(roc), ensure_ascii=False).encode("utf-8")


def _csv_body(roc: str) -> bytes:
    lines = [_CSV_HEADER] + [",".join(f'"{row[k]}"' for k in _KEYS) for row in _market(roc)]
    return ("﻿" + "\n".join(lines) + "\n").encode("utf-8")


def _serve(monkeypatch, *, csv: bytes | None, openapi: bytes | None) -> None:
    """把下載換成假的：依網址回傳指定內容，None 代表該出口連不上。"""

    def fake_get(url: str) -> bytes:
        body = openapi if url.startswith(twse.OPENAPI_BASE) else csv
        if body is None:
            raise TwseError(f"下載失敗：{url}")
        return body

    monkeypatch.setattr(twse, "_get", fake_get)


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


def test_csv_rows_use_openapi_keys():
    text = (
        "﻿" + _CSV_HEADER + "\n"
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


def test_mi_index_csv_rows_use_openapi_keys():
    """指數的 CSV 欄名帶括號說明（OpenAPI 沒有）；日期欄兩邊都叫「日期」，不能被換成 Date。"""
    text = (
        "日期,指數/報酬指數,收盤指數,漲跌(+/-),漲跌點數,漲跌百分比(%),特殊處理註記\n"
        '"1151005","發行量加權股價指數","49712.04","+","1,236.30","2.55",""\n'
    )
    assert rows_from_csv(text, "MI_INDEX") == [
        {
            "日期": "1151005",
            "指數": "發行量加權股價指數",
            "收盤指數": "49712.04",
            "漲跌": "+",
            "漲跌點數": "1,236.30",
            "漲跌百分比": "2.55",
            "特殊處理註記": "",
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
    with pytest.raises(TwseError, match="不是資料列"):
        validate_rows("STOCK_DAY_ALL", {"stat": "很抱歉，沒有符合條件的資料"})


def test_fetch_available_returns_both_days_when_csv_is_ahead(monkeypatch):
    """實測到的情況：晚上 CSV 已是今日、OpenAPI 還是前一個交易日。兩天都要回，今天的不能等到明天。"""
    _serve(monkeypatch, csv=_csv_body("1151005"), openapi=_openapi_body("1151002"))
    found = fetch_available("STOCK_DAY_ALL")
    assert [day for day, _, _ in found] == [date(2026, 10, 2), date(2026, 10, 5)]
    assert found[0][2].startswith(twse.OPENAPI_BASE)
    assert found[1][2].endswith("response=open_data")
    assert found[1][1][0] == _row("2330", "1151005")  # CSV 的列已換成 OpenAPI 的鍵


def test_fetch_available_same_day_keeps_one_copy(monkeypatch):
    _serve(monkeypatch, csv=_csv_body("1151002"), openapi=_openapi_body("1151002"))
    found = fetch_available("STOCK_DAY_ALL")
    assert [(day, url.startswith(twse.OPENAPI_BASE)) for day, _, url in found] == [(date(2026, 10, 2), True)]


def test_fetch_available_survives_one_outlet_failing(monkeypatch):
    _serve(monkeypatch, csv=_csv_body("1151005"), openapi=None)
    assert [day for day, _, _ in fetch_available("STOCK_DAY_ALL")] == [date(2026, 10, 5)]

    _serve(monkeypatch, csv=b"<html>busy</html>", openapi=_openapi_body("1151002"))
    assert [day for day, _, _ in fetch_available("STOCK_DAY_ALL")] == [date(2026, 10, 2)]

    _serve(monkeypatch, csv=None, openapi=b"not json")
    with pytest.raises(TwseError) as failure:
        fetch_available("STOCK_DAY_ALL")
    assert "open_data" in str(failure.value) and twse.OPENAPI_BASE in str(failure.value)


def test_cli_stores_every_available_day_once(monkeypatch, tmp_path, capsys):
    argv = ["fetch", "--out", str(tmp_path), "--datasets", "STOCK_DAY_ALL"]
    _serve(monkeypatch, csv=_csv_body("1151005"), openapi=_openapi_body("1151002"))

    assert twse.main(argv) == 0
    result = json.loads(capsys.readouterr().out)["STOCK_DAY_ALL"]
    assert [day["written"] for day in result["days"]] == [
        "stock_day_all/2026/2026-10-02.json",
        "stock_day_all/2026/2026-10-05.json",
    ]
    assert result["outlet_errors"] == []
    assert stored_days(tmp_path) == [date(2026, 10, 2), date(2026, 10, 5)]

    assert twse.main(argv) == 0  # 再跑一次：兩天都已存在，不覆寫
    assert [day["written"] for day in json.loads(capsys.readouterr().out)["STOCK_DAY_ALL"]["days"]] == [None, None]

    _serve(monkeypatch, csv=None, openapi=None)
    assert twse.main(argv) == 1  # 個股行情兩個出口都拿不到才算失敗
    assert "error" in json.loads(capsys.readouterr().out)["STOCK_DAY_ALL"]


def test_cli_warns_when_only_one_outlet_answers(monkeypatch, tmp_path, capsys):
    """CSV 抓不到時仍算成功（OpenAPI 隔天會補上），但要示警，否則 K 線慢一天沒人知道。"""
    argv = ["fetch", "--out", str(tmp_path), "--datasets", "STOCK_DAY_ALL"]
    _serve(monkeypatch, csv=None, openapi=_openapi_body("1151002"))
    monkeypatch.setenv("GITHUB_ACTIONS", "true")

    assert twse.main(argv) == 0
    captured = capsys.readouterr()
    result = json.loads(captured.out)["STOCK_DAY_ALL"]  # 示警走 stderr，stdout 仍是完整的 JSON
    assert [day["date"] for day in result["days"]] == ["2026-10-02"]
    assert len(result["outlet_errors"]) == 1 and "open_data" in result["outlet_errors"][0]
    assert captured.err.startswith("::warning title=證交所資料::STOCK_DAY_ALL") and "open_data" in captured.err


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
