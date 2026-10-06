"""證交所與集保開放資料：日期換算、數字解析、CSV 正規化、兩個出口都收、只收一次、讀回 K 線。

這份資料錯過一天就補不回來，存檔邏輯若默默覆寫或寫錯日期，損失無法回復——
所以把「已存在不覆寫」「日期一致」「兩個出口日期不同時兩天都收」「內容沒有日期時只信下載檔名」釘死。全部不連網。
"""

import json
import re
from datetime import date
from pathlib import Path

import pytest

from stockta.data import twse
from stockta.data.twse import (
    DATASETS,
    TwseError,
    attribution,
    fetch_available,
    filename_day,
    load_candles,
    parse_day,
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


def _serve(monkeypatch, *, csv: bytes | None, openapi: bytes | None, csv_filename: str | None = None) -> None:
    """把下載換成假的：依網址回傳指定內容，None 代表該出口連不上；CSV 可附下載檔名（Content-Disposition）。"""

    def fake_get(url: str) -> tuple[bytes, str | None]:
        from_openapi = url.startswith(twse.OPENAPI_BASE)
        body = openapi if from_openapi else csv
        if body is None:
            raise TwseError(f"下載失敗：{url}")
        return body, None if from_openapi else csv_filename

    monkeypatch.setattr(twse, "_get", fake_get)


def _csv(header: str, rows: list[str]) -> bytes:
    return ("﻿" + "\n".join([header, *rows]) + "\n").encode("utf-8")


_MARGN_HEADER = (
    "股票代號,股票名稱,融資買進,融資賣出,融資現金償還,融資前日餘額,融資今日餘額,融資限額,"
    "融券買進,融券賣出,融券現券償還,融券前日餘額,融券今日餘額,融券限額,資券互抵,註記"
)


def _margin_csv(n: int = 600) -> bytes:
    codes = ["2330"] + [f"{9000 + i}" for i in range(n - 1)]
    return _csv(_MARGN_HEADER, [f'"{c}","股票{c}","1","2","0","100","99","500","","","","3","3","500","","X "' for c in codes])


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


def test_parse_day_accepts_roc_and_gregorian():
    """證交所用民國（1151006），集保用西元（20261002）。"""
    assert parse_day("1151006") == date(2026, 10, 6)
    assert parse_day(" 20261002 ") == date(2026, 10, 2)
    assert parse_day("990104") == date(2010, 1, 4)
    for bad in ("2026-10-02", "", "20261399"):
        with pytest.raises((TwseError, ValueError)):
            parse_day(bad)


def test_filename_day_reads_the_platform_csv_name():
    assert filename_day("MI_MARGN_ALL_20261005.csv") == date(2026, 10, 5)
    assert filename_day("STOCK_DAY_ALL_20261006.csv") == date(2026, 10, 6)
    assert filename_day("TDCC_OD_1-5.csv") is None
    assert filename_day("MI_MARGN_ALL_20261399.csv") is None
    assert filename_day(None) is None


def test_undated_dataset_takes_its_date_from_the_csv_filename(monkeypatch):
    """融資融券餘額的內容沒有日期：日期只能取自平臺 CSV 的下載檔名，而且不抓沒有日期的 OpenAPI。"""
    assert all(not url.startswith(twse.OPENAPI_BASE) for url in DATASETS["MI_MARGN"].outlets)
    _serve(monkeypatch, csv=_margin_csv(), openapi=None, csv_filename="MI_MARGN_ALL_20261005.csv")
    [(day, rows, url)] = fetch_available("MI_MARGN")
    assert day == date(2026, 10, 5)
    assert url.endswith("selectType=ALL")
    assert rows[0]["股票代號"] == "2330" and rows[0]["註記"] == "X"  # 值去掉補白


def test_undated_dataset_without_a_filename_date_is_refused(monkeypatch):
    """判定不了是哪一天就不收：寫錯日期的檔案永遠不會被覆寫，比漏收一天更糟。"""
    _serve(monkeypatch, csv=_margin_csv(), openapi=None, csv_filename=None)
    errors: list[str] = []
    with pytest.raises(TwseError, match="檔名"):
        fetch_available("MI_MARGN", outlet_errors=errors)
    assert len(errors) == 1


def test_validate_rejects_future_dates():
    rows = _market("1151007")
    assert validate_rows("STOCK_DAY_ALL", rows, today=date(2026, 10, 7)) == date(2026, 10, 7)
    with pytest.raises(TwseError, match="未來"):
        validate_rows("STOCK_DAY_ALL", rows, today=date(2026, 10, 6))
    with pytest.raises(TwseError, match="未來"):
        validate_rows("MI_MARGN", [{"股票代號": "2330"}] * 600, filename_date=date(2026, 10, 9), today=date(2026, 10, 6))


def test_bwibbu_csv_rows_use_openapi_keys(monkeypatch):
    header = "日期,股票代號,股票名稱,本益比,殖利率(%),股價淨值比"
    codes = ["2330"] + [f"{9000 + i}" for i in range(599)]
    body = _csv(header, [f'"1151006","{c}","股票{c}","","3.17","0.82"' for c in codes])
    assert rows_from_csv(body.decode("utf-8-sig"), "BWIBBU_ALL")[0] == {
        "Date": "1151006",
        "Code": "2330",
        "Name": "股票2330",
        "PEratio": "",
        "DividendYield": "3.17",
        "PBratio": "0.82",
    }
    _serve(monkeypatch, csv=body, openapi=None)
    assert [day for day, _, _ in fetch_available("BWIBBU_ALL")] == [date(2026, 10, 6)]


def test_monthly_revenue_is_dated_by_its_report_date(monkeypatch):
    """月營收一個月才換一次：以出表日期存檔，兩個出口同一天只留一份。"""
    header = "出表日期,資料年月,公司代號,公司名稱,產業別,營業收入-當月營收"
    codes = ["2330"] + [f"{9000 + i}" for i in range(599)]
    rows = [{"出表日期": "1150917", "資料年月": "11508", "公司代號": c, "公司名稱": "x", "產業別": "y", "營業收入-當月營收": "1"} for c in codes]
    body = _csv(header, [",".join(f'"{r[k]}"' for k in r) for r in rows])
    _serve(monkeypatch, csv=body, openapi=json.dumps(rows, ensure_ascii=False).encode("utf-8"))
    [(day, _, url)] = fetch_available("t187ap05_L")
    assert day == date(2026, 9, 17) and url.startswith(twse.OPENAPI_BASE)


def test_tdcc_keeps_four_digit_codes_and_strips_padding(monkeypatch):
    """集保的代號右邊補空白，而且混有權證、債券等代號：只留 4 碼的股票與 ETF。"""
    header = "資料日期,證券代號,持股分級,人數,股數,占集保庫存數比例%"
    codes = ["2330  ", "0050  ", "000218", "YY0080", "910861"] + [f"{1000 + i}  " for i in range(700)]
    lines = [f"20261002,{c},{level},1,1,0.01" for c in codes for level in range(1, 18)]
    _serve(monkeypatch, csv=_csv(header, lines), openapi=None)
    [(day, rows, _)] = fetch_available("TDCC_OD_1-5")
    assert day == date(2026, 10, 2)
    kept = {r["證券代號"] for r in rows}
    assert {"2330", "0050"} <= kept and not kept & {"000218", "YY0080", "910861"}
    assert all(re.fullmatch(r"\d{4}", code) for code in kept)
    assert len(rows) == 17 * 702


def test_attribution_names_the_provider_and_the_dataset(tmp_path):
    """政府資料開放授權條款要求顯名：提供機關＋資料集名稱＋授權條款，每個檔案各自寫清楚。"""
    path = store(tmp_path, "TDCC_OD_1-5", date(2026, 10, 2), [{"證券代號": "2330"}], "https://example.invalid/tdcc")
    meta = json.loads(path.read_text(encoding="utf-8"))["meta"]
    assert "臺灣集中保管結算所" in meta["attribution"] and "集保戶股權分散表" in meta["attribution"]
    assert meta["dataset_url"] == "https://data.gov.tw/dataset/11452"
    assert path.relative_to(tmp_path).as_posix() == "tdcc_od_1-5/2026/2026-10-02.json"
    for name, spec in DATASETS.items():
        text = attribution(name)
        assert spec.provider in text and f"「{spec.title}」" in text and "https://data.gov.tw/license" in text


def test_cli_warns_but_succeeds_when_an_optional_dataset_fails(monkeypatch, tmp_path, capsys):
    """月營收、融資券等抓不到不影響 K 線：排程算成功，但要示警。"""
    _serve(monkeypatch, csv=_csv_body("1151005"), openapi=_openapi_body("1151005"))
    monkeypatch.setenv("GITHUB_ACTIONS", "true")
    assert twse.main(["fetch", "--out", str(tmp_path), "--datasets", "STOCK_DAY_ALL", "MI_MARGN"]) == 0
    captured = capsys.readouterr()
    result = json.loads(captured.out)
    assert result["STOCK_DAY_ALL"]["days"][0]["written"] == "stock_day_all/2026/2026-10-05.json"
    assert "error" in result["MI_MARGN"]
    assert "::warning title=證交所資料::MI_MARGN" in captured.err


def test_every_dataset_is_disclosed_in_data_sources():
    """新增資料集時一併更新 DATA_SOURCES.md：資料集代號與政府資料開放平臺的編號都要列出。"""
    text = (Path(__file__).resolve().parents[2] / "DATA_SOURCES.md").read_text(encoding="utf-8")
    for name, spec in DATASETS.items():
        assert f"`{name}`" in text, name
        assert str(spec.gov_id) in text, name


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
