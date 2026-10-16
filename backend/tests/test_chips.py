"""融資融券與大戶持股（stockta/chips.py、GET /api/stocks/{ticker}/chips）：開放資料的欄位、衍生值與本站估算。

全部用 tmp_path 裡的假資料檔（格式同 twse-data 分支），不連網。融資成本的遞推逐步驗證：
起算、加碼、償還、買進多於餘額、餘額歸零後重新起算、缺收盤價。
"""

import json
from datetime import date
from pathlib import Path

import pytest

from stockta.chips import ESTIMATES, MARGIN_RATE, build_chips, holder_series, margin_series
from stockta.data.twse import LICENSE_NAME, LICENSE_URL, attribution

D1, D2, D3, D4, D5, D6 = (date(2026, 10, d) for d in (5, 6, 7, 8, 12, 13))


def _write(data_dir: Path, dataset: str, day: date, rows: list[dict]) -> None:
    path = data_dir / dataset.lower() / f"{day.year}" / f"{day.isoformat()}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {"meta": {"dataset": dataset, "date": day.isoformat()}, "rows": rows}
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")


def _cell(value) -> str:
    """官方表格把 0 留白；字串原樣放入（測試 '--' 之類的值）。"""
    if isinstance(value, str):
        return value
    return "" if value == 0 else str(value)


def _margin(code: str = "2330", *, buy=0, sell=0, redeem=0, prev=0, today=None, limit=6483092,
            s_buy=0, s_sell=0, s_redeem=0, s_prev=0, s_today=None, offset=0) -> dict:
    if today is None:
        today = prev + buy - sell - redeem
    if s_today is None:
        s_today = s_prev + s_sell - s_buy - s_redeem
    return {
        "股票代號": code, "股票名稱": "測試",
        "融資買進": _cell(buy), "融資賣出": _cell(sell), "融資現金償還": _cell(redeem),
        "融資前日餘額": _cell(prev), "融資今日餘額": _cell(today), "融資限額": _cell(limit),
        "融券買進": _cell(s_buy), "融券賣出": _cell(s_sell), "融券現券償還": _cell(s_redeem),
        "融券前日餘額": _cell(s_prev), "融券今日餘額": _cell(s_today), "融券限額": _cell(limit),
        "資券互抵": _cell(offset), "註記": "",
    }


def _price(code: str, day: date, close: str, volume: str = "1000") -> dict:
    roc = f"{day.year - 1911}{day:%m%d}"
    return {
        "Date": roc, "Code": code, "Name": "測試", "TradeVolume": volume, "TradeValue": "1",
        "OpeningPrice": close, "HighestPrice": close, "LowestPrice": close, "ClosingPrice": close,
        "Change": "0.0000", "Transaction": "1",
    }


def _day(data_dir: Path, day: date, margin: dict | None, close: str | None = None, volume: str = "1000") -> None:
    """一個交易日：融資融券一列，有給收盤價時再寫同一天的個股日成交資訊。"""
    if margin is not None:
        _write(data_dir, "MI_MARGN", day, [margin])
    if close is not None:
        _write(data_dir, "STOCK_DAY_ALL", day, [_price(margin["股票代號"] if margin else "2330", day, close, volume)])


def _tdcc(code: str, day: date, levels: dict[int, tuple[str, str]]) -> list[dict]:
    """集保分級 1–17；levels 給指定分級的（人數, 比例%），其餘分級填 1 人、0.01%。"""
    rows = []
    for level in range(1, 18):
        people, ratio = levels.get(level, ("1", "0.01"))
        rows.append({
            "資料日期": day.strftime("%Y%m%d"), "證券代號": code, "持股分級": str(level),
            "人數": people, "股數": "1000", "占集保庫存數比例%": ratio,
        })
    return rows


def _by_date(records: list[dict]) -> dict[str, dict]:
    return {r["date"]: r for r in records}


# --- 融資融券：欄位與衍生值 ---


def test_one_day_of_margin_fields_increments_usage_short_ratio_and_lots(tmp_path):
    # 2330 在 2026-10-06 的實際數字（MI_MARGN、STOCK_DAY_ALL）
    _day(
        tmp_path, D2,
        _margin(buy=1125, sell=740, redeem=20, prev=30135, today=30500, s_buy=4, s_sell=7, s_prev=46, s_today=49),
        close="2585.00", volume="19953802",
    )
    [day] = margin_series(tmp_path, "2330")
    assert day["date"] == "2026-10-06"
    assert (day["margin_buy"], day["margin_sell"], day["margin_redeem"]) == (1125, 740, 20)
    assert (day["margin_balance"], day["margin_change"], day["margin_limit"]) == (30500, 365, 6483092)
    assert day["margin_usage_pct"] == pytest.approx(30500 / 6483092 * 100, abs=1e-4)
    assert (day["short_sell"], day["short_buy"], day["short_redeem"]) == (7, 4, 0)  # 空白＝0
    assert (day["short_balance"], day["short_change"]) == (49, 3)
    assert day["short_margin_pct"] == pytest.approx(49 / 30500 * 100, abs=1e-4)
    assert day["offset"] == 0
    assert day["close"] == 2585.0
    assert day["volume_lots"] == 19954  # 19,953,802 股 ÷ 1000，四捨五入


def test_volume_lots_round_half_up(tmp_path):
    _day(tmp_path, D2, _margin(buy=1, today=1), close="10.00", volume="2500")
    assert margin_series(tmp_path, "2330")[0]["volume_lots"] == 3


def test_unparsable_values_are_missing_and_ratios_skip_zero_denominators(tmp_path):
    _day(tmp_path, D2, _margin(prev="--", today=500, limit=0, s_today=5), close="--")
    _day(tmp_path, D3, _margin(prev=500, today=0, limit="", s_prev=5, s_today=5))
    first, second = margin_series(tmp_path, "2330")
    assert first["margin_change"] is None  # 前日餘額 '--'
    assert first["margin_usage_pct"] is None  # 限額 0
    assert first["close"] is None and first["volume_lots"] is None  # 當天沒有成交
    assert second["margin_usage_pct"] is None  # 限額空白（＝0）
    assert second["short_margin_pct"] is None  # 融資餘額 0：券資比不計
    assert second["margin_change"] == -500


# --- 融資成本與維持率（本站估算）---


def test_cost_starts_at_close_then_adds_buys_keeps_cost_on_repayment_and_restarts(tmp_path):
    _day(tmp_path, D1, _margin(buy=100, today=100), close="10.00")  # 起算：當天收盤價
    _day(tmp_path, D2, _margin(buy=50, sell=30, prev=100), close="13.00")  # 餘額 120：舊 70 張＋新買 50 張
    _day(tmp_path, D3, _margin(sell=10, redeem=10, prev=120), close="9.00")  # 只有賣出與償還：成本不變
    _day(tmp_path, D4, _margin(buy=50, sell=140, prev=100), close="12.00")  # 買 50 張但餘額只剩 10：全部算新買
    _day(tmp_path, D5, _margin(sell=10, prev=10), close="11.00")  # 餘額歸零：成本不計
    _day(tmp_path, D6, _margin(buy=40, prev=0), close="15.00")  # 重新起算
    days = _by_date(margin_series(tmp_path, "2330"))

    assert days["2026-10-05"]["margin_cost"] == 10.0
    assert days["2026-10-05"]["maintenance_pct"] == pytest.approx(100 / MARGIN_RATE, abs=0.01)
    assert days["2026-10-06"]["margin_cost"] == pytest.approx((10 * 70 + 13 * 50) / 120)  # 11.25
    assert days["2026-10-06"]["maintenance_pct"] == pytest.approx(13 / (11.25 * MARGIN_RATE) * 100, abs=0.01)
    assert days["2026-10-07"]["margin_cost"] == pytest.approx(11.25)
    assert days["2026-10-07"]["maintenance_pct"] == pytest.approx(9 / (11.25 * MARGIN_RATE) * 100, abs=0.01)
    assert days["2026-10-08"]["margin_cost"] == 12.0  # 不是 (11.25×0 + 12×50) ÷ 10 = 60
    assert days["2026-10-12"]["margin_cost"] is None and days["2026-10-12"]["maintenance_pct"] is None
    assert days["2026-10-13"]["margin_cost"] == 15.0  # 不沿用歸零前的成本

    meta = build_chips(tmp_path, "2330.TW")["meta"]
    assert meta["cost_start"] == "2026-10-13" and meta["margin_start"] == "2026-10-05"


def test_cost_waits_for_a_close_and_restarts_when_new_buys_have_no_close(tmp_path):
    _day(tmp_path, D1, _margin(buy=100, today=100))  # 沒有行情：無法起算
    _day(tmp_path, D2, _margin(prev=100, today=100), close="10.00")  # 起算日
    _day(tmp_path, D3, _margin(sell=10, prev=100))  # 沒有收盤價但也沒有新買進：成本沿用，維持率不計
    _day(tmp_path, D4, _margin(buy=20, prev=90), close="--")  # 有新買進卻沒有收盤價：無法估算
    _day(tmp_path, D5, _margin(buy=5, prev=110), close="11.00")  # 以當天收盤價重新起算
    days = _by_date(margin_series(tmp_path, "2330"))

    assert days["2026-10-05"]["margin_cost"] is None
    assert days["2026-10-06"]["margin_cost"] == 10.0
    assert days["2026-10-07"]["margin_cost"] == 10.0 and days["2026-10-07"]["maintenance_pct"] is None
    assert days["2026-10-08"]["margin_cost"] is None
    assert days["2026-10-12"]["margin_cost"] == 11.0
    assert build_chips(tmp_path, "2330.TW")["meta"]["cost_start"] == "2026-10-12"


def test_missing_margin_days_are_skipped_without_breaking_the_recursion(tmp_path):
    _day(tmp_path, D1, _margin(buy=100, today=100), close="10.00")
    _write(tmp_path, "STOCK_DAY_ALL", D2, [_price("2330", D2, "20.00")])  # 這天漏收融資融券
    _day(tmp_path, D3, _margin(buy=100, prev=150), close="12.00")  # 前日餘額 150 ≠ 上一份的 100
    days = margin_series(tmp_path, "2330")
    assert [d["date"] for d in days] == ["2026-10-05", "2026-10-07"]
    assert days[1]["margin_change"] == 100  # 增減取同一份的今日 − 前日餘額
    assert days[1]["margin_cost"] == pytest.approx((10 * 150 + 12 * 100) / 250)


# --- 集保戶股權分散：千張大戶與 400 張以上 ---


def test_big_holder_levels_and_weekly_change(tmp_path):
    # 2330 的實際數字：2026-10-02、2026-10-08 兩週
    _write(tmp_path, "TDCC_OD_1-5", date(2026, 10, 2), _tdcc("2330", date(2026, 10, 2), {
        11: ("1312", "1.42"), 12: ("582", "1.09"), 13: ("339", "0.90"), 14: ("224", "0.77"),
        15: ("1485", "84.77"), 16: ("2", "0.00"), 17: ("3010913", "100.00"),
    }))
    _write(tmp_path, "TDCC_OD_1-5", date(2026, 10, 8), _tdcc("2330", date(2026, 10, 8), {
        11: ("1312", "1.42"), 12: ("579", "1.08"), 13: ("336", "0.89"), 14: ("229", "0.79"),
        15: ("1482", "84.78"), 16: ("1", "0.00"), 17: ("3007088", "100.00"),
    }))
    first, second = holder_series(tmp_path, "2330")

    assert first["date"] == "2026-10-02" and first["big_pct"] == 84.77 and first["big_holders"] == 1485
    assert first["over400_pct"] == 87.53 and first["over400_holders"] == 2630  # 分級 12–15，不含 11、16、17
    assert first["big_pct_change"] is None and first["over400_holders_change"] is None  # 第一週沒有變化可算

    assert (second["big_pct"], second["big_holders"]) == (84.78, 1482)
    assert (second["over400_pct"], second["over400_holders"]) == (87.54, 2626)
    assert second["big_pct_change"] == 0.01 and second["big_holders_change"] == -3
    assert second["over400_pct_change"] == 0.01 and second["over400_holders_change"] == -4


def test_unparsable_or_missing_levels_leave_gaps(tmp_path):
    week1 = _tdcc("2330", date(2026, 10, 2), {13: ("339", "--"), 15: ("1485", "84.77")})
    week2 = [r for r in _tdcc("2330", date(2026, 10, 8), {15: ("1482", "84.78")}) if r["持股分級"] != "15"]
    _write(tmp_path, "TDCC_OD_1-5", date(2026, 10, 2), week1)
    _write(tmp_path, "TDCC_OD_1-5", date(2026, 10, 8), week2)
    first, second = holder_series(tmp_path, "2330")
    assert first["over400_pct"] is None and first["over400_holders"] == 1 + 339 + 1 + 1485
    assert first["big_pct"] == 84.77
    assert second["big_pct"] is None and second["big_pct_change"] is None  # 缺分級 15 那一列
    assert second["over400_pct"] is None and second["over400_pct_change"] is None


# --- 整份輸出 ---


def test_no_files_and_unknown_tickers_give_empty_series(tmp_path):
    out = build_chips(tmp_path, "2330.TW")
    assert out["margin"] == [] and out["holders"] == []
    assert out["meta"]["margin_start"] is None and out["meta"]["cost_start"] is None
    assert out["meta"]["holders_start"] is None

    _day(tmp_path, D2, _margin(buy=1, today=1), close="10.00")
    assert build_chips(tmp_path, "9999.TW")["margin"] == []  # 資料裡沒有這個代號


def test_codes_outside_the_stock_pool_are_read_too(tmp_path):
    _day(tmp_path, D2, _margin("1234", buy=10, today=10), close="10.00")
    assert margin_series(tmp_path, "1234")[0]["margin_balance"] == 10


def test_new_files_are_picked_up_after_the_first_read(tmp_path):
    _day(tmp_path, D2, _margin(buy=10, today=10), close="10.00")
    assert len(margin_series(tmp_path, "2330")) == 1
    _day(tmp_path, D3, _margin(buy=10, prev=10), close="10.00")
    assert [d["date"] for d in margin_series(tmp_path, "2330")] == ["2026-10-06", "2026-10-07"]


def test_meta_names_sources_licence_estimates_and_dates(tmp_path):
    _day(tmp_path, D2, _margin(buy=10, today=10), close="10.00")
    _day(tmp_path, D3, _margin(buy=10, prev=10), close="10.00")
    _write(tmp_path, "TDCC_OD_1-5", date(2026, 10, 2), _tdcc("2330", date(2026, 10, 2), {}))
    meta = build_chips(tmp_path, "2330.TW")["meta"]

    sources = {s["dataset"]: s for s in meta["sources"]}
    assert {k: sources[k]["gov_id"] for k in sources} == {"MI_MARGN": 11680, "STOCK_DAY_ALL": 11549, "TDCC_OD_1-5": 11452}
    for key, source in sources.items():
        assert source["attribution"] == attribution(key)
        assert source["dataset_url"] == f"https://data.gov.tw/dataset/{source['gov_id']}"
        assert source["source_urls"] and all(u.startswith("https://") for u in source["source_urls"])
    assert sources["TDCC_OD_1-5"]["provider"] == "臺灣集中保管結算所"
    assert (meta["license"], meta["license_url"]) == (LICENSE_NAME, LICENSE_URL)
    assert meta["estimates"] == list(ESTIMATES) == ["margin_cost", "maintenance_pct"]
    assert meta["estimate_label"] == "本站估算" and meta["margin_rate"] == MARGIN_RATE
    assert (meta["margin_start"], meta["margin_end"], meta["cost_start"]) == ("2026-10-06", "2026-10-07", "2026-10-06")
    assert (meta["holders_start"], meta["holders_end"]) == ("2026-10-02", "2026-10-02")


# --- API ---


def test_chips_endpoint_returns_the_series(client, tmp_path):
    _day(tmp_path, D2, _margin(buy=100, today=100, s_sell=5, s_today=5), close="10.00", volume="2000000")
    _day(tmp_path, D3, _margin(buy=50, sell=30, prev=100, s_prev=5, s_today=5), close="13.00")
    _write(tmp_path, "TDCC_OD_1-5", date(2026, 10, 2), _tdcc("2330", date(2026, 10, 2), {15: ("10", "80.00")}))
    client.app.state.twse_dir = tmp_path

    r = client.get("/api/stocks/2330.TW/chips")
    assert r.status_code == 200
    body = r.json()
    assert body["ticker"] == "2330.TW"
    assert [d["date"] for d in body["margin"]] == ["2026-10-06", "2026-10-07"]
    last = body["margin"][-1]
    assert last["margin_balance"] == 120 and last["margin_change"] == 20 and last["short_margin_pct"] == pytest.approx(5 / 120 * 100, abs=1e-4)
    assert last["margin_cost"] == 11.25 and body["margin"][0]["volume_lots"] == 2000
    assert body["holders"][0]["big_pct"] == 80.0
    assert body["meta"]["estimates"] == ["margin_cost", "maintenance_pct"]


def test_chips_endpoint_without_data_is_empty_not_an_error(client, tmp_path):
    client.app.state.twse_dir = tmp_path
    r = client.get("/api/stocks/2317.TW/chips")
    assert r.status_code == 200
    assert r.json()["margin"] == [] and r.json()["holders"] == []


def test_chips_endpoint_validates_the_ticker(client):
    r = client.get("/api/stocks/9999.TW/chips")
    assert r.status_code == 404 and r.json()["error"]["code"] == "TICKER_NOT_FOUND"
    r = client.get("/api/stocks/not-a-ticker/chips")
    assert r.status_code == 422 and r.json()["error"]["code"] == "INVALID_TICKER_FORMAT"
