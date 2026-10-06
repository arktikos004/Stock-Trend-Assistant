"""篩選器與綜合評分（docs/screener_prereg.md v1）：百分位、價格衍生值、開放資料的 as-of、條件、分層與權重。

規則是預先聲明的：這裡把文件寫的每一條釘死——程式改了規則而文件沒升版，測試就會失敗。
洩漏測試：基準日之後的價格與檔案不得影響結果。全部不連網。
"""

import json
import re
from datetime import date, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
import pytest

from stockta import screener
from stockta.screener import (
    RULES_VERSION,
    WEIGHTS,
    big_holder_changes,
    build_screener,
    margin_changes,
    percentiles,
    price_signals,
)

AS_OF = date(2026, 10, 6)


def _closes(values, end: date = AS_OF) -> pd.Series:
    idx = pd.bdate_range(end=pd.Timestamp(end), periods=len(values))
    return pd.Series(np.asarray(values, dtype=float), index=idx)


def _write(data_dir: Path, dataset: str, day: date, rows: list[dict]) -> None:
    path = data_dir / dataset.lower() / f"{day.year}" / f"{day.isoformat()}.json"
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps({"meta": {"dataset": dataset, "date": day.isoformat()}, "rows": rows}, ensure_ascii=False), encoding="utf-8")


def _margin(code: str, before: float, today: float) -> dict:
    return {"股票代號": code, "融資前日餘額": f"{before:,.0f}", "融資今日餘額": f"{today:,.0f}"}


def _tdcc(code: str, ratio: float) -> list[dict]:
    return [
        {"資料日期": "x", "證券代號": code, "持股分級": "15", "人數": "1", "股數": "1", "占集保庫存數比例%": f"{ratio:.2f}"},
        {"資料日期": "x", "證券代號": code, "持股分級": "17", "人數": "9", "股數": "9", "占集保庫存數比例%": "100.00"},
    ]


def test_percentiles_best_is_100_and_ties_share_the_average():
    assert percentiles({"a": 1.0, "b": 2.0, "c": 3.0}) == {"a": 0.0, "b": 50.0, "c": 100.0}
    assert percentiles({"a": 1.0, "b": 2.0, "c": 3.0}, higher_is_better=False) == {"a": 100.0, "b": 50.0, "c": 0.0}
    assert percentiles({"a": 1.0, "b": 1.0, "c": 3.0}) == {"a": 25.0, "b": 25.0, "c": 100.0}
    assert percentiles({"a": 1.0, "b": None, "c": float("nan")}) == {"a": None, "b": None, "c": None}


def test_price_signals_breakout_ma_and_returns():
    rising = _closes(np.linspace(100, 160, 80))
    s = price_signals(rising, AS_OF)
    assert s.breakout and s.ma_bullish
    assert s.ret20 == pytest.approx(rising.iloc[-1] / rising.iloc[-21] - 1)
    assert s.ret60 == pytest.approx(rising.iloc[-1] / rising.iloc[-61] - 1)

    falling = _closes(np.linspace(160, 100, 80))
    s = price_signals(falling, AS_OF)
    assert not s.breakout and not s.ma_bullish and s.ret60 < 0
    assert price_signals(_closes(np.linspace(100, 160, 60)), AS_OF) is None  # 不足 61 個交易日


@pytest.mark.leakage
def test_price_signals_ignore_prices_after_the_base_date():
    rng = np.random.default_rng(7)
    past = _closes(100 + rng.normal(0, 1, 120).cumsum())
    future_idx = pd.bdate_range(start=pd.Timestamp(AS_OF) + timedelta(days=1), periods=30)
    with_future = pd.concat([past, pd.Series(np.full(30, 999.0), index=future_idx)])
    assert price_signals(with_future, AS_OF) == price_signals(past, AS_OF)


def test_margin_change_uses_five_sessions_or_the_earliest_previous_balance(tmp_path):
    days = list(pd.bdate_range(end=pd.Timestamp(AS_OF), periods=7).date)
    _write(tmp_path, "MI_MARGN", days[0], [_margin("2330", 1000, 1100)])
    changes, covered, latest = margin_changes(tmp_path, days[0])
    assert covered == 1 and latest == days[0] and changes["2330"] == pytest.approx(0.10)

    for i, day in enumerate(days[1:], start=1):
        _write(tmp_path, "MI_MARGN", day, [_margin("2330", 1100 + 10 * (i - 1), 1100 + 10 * i)])
    changes, covered, latest = margin_changes(tmp_path, AS_OF)
    assert covered == 5 and latest == AS_OF
    assert changes["2330"] == pytest.approx((1160 - 1110) / 1110)  # 往前第 5 份的今日餘額


def test_big_holder_change_needs_two_weeks(tmp_path):
    _write(tmp_path, "TDCC_OD_1-5", date(2026, 10, 2), _tdcc("2330", 84.77))
    changes, weeks = big_holder_changes(tmp_path, AS_OF)
    assert changes == {} and weeks == [date(2026, 10, 2)]
    _write(tmp_path, "TDCC_OD_1-5", date(2026, 9, 25), _tdcc("2330", 84.50))
    changes, weeks = big_holder_changes(tmp_path, AS_OF)
    assert changes["2330"] == pytest.approx(0.27) and weeks == [date(2026, 9, 25), date(2026, 10, 2)]


def _pool(tmp_path: Path, n: int = 6):
    """n 檔：股票 0 各方面最好、越後面越差；最後一檔是金融股（營收不計）。"""
    names = {f"{1000 + i}.TW": f"股{i}" for i in range(n)}
    codes = [t.removesuffix(".TW") for t in names]
    rank = {t: 1 - i / (n - 1) for i, t in enumerate(names)}
    closes = {t: _closes(np.linspace(100, 160 - 15 * i, 80)) for i, t in enumerate(names)}
    _write(tmp_path, "BWIBBU_ALL", AS_OF, [
        {"Date": "1151006", "Code": c, "Name": c, "PEratio": "" if i == n - 2 else f"{10 + 5 * i}", "DividendYield": f"{5 - 0.5 * i:.2f}", "PBratio": f"{1 + 0.5 * i:.2f}"}
        for i, c in enumerate(codes)
    ])
    _write(tmp_path, "t187ap05_L", date(2026, 9, 17), [
        {"出表日期": "1150917", "資料年月": "11508", "公司代號": c, "產業別": "金融保險業" if i == n - 1 else "半導體業",
         "營業收入-去年同月增減(%)": f"{30 - 10 * i}", "累計營業收入-前期比較增減(%)": f"{25 - 10 * i}"}
        for i, c in enumerate(codes)
    ])
    _write(tmp_path, "MI_MARGN", AS_OF, [_margin(c, 1000, 1000 - 20 + 10 * i) for i, c in enumerate(codes)])
    return names, rank, closes


def test_components_composite_conditions_and_tiers(tmp_path):
    names, rank, closes = _pool(tmp_path)
    out = build_screener(as_of=AS_OF, names=names, rank_pct=rank, closes=closes, data_dir=tmp_path)
    by = {s["ticker"]: s for s in out["stocks"]}

    best = by["1000.TW"]
    assert best["components"]["rank"] == 100.0
    assert best["components"]["chips"] == 100.0  # 只有融資一項（大戶只有 0 週）
    assert best["conditions"] == {"C1": "pass", "C2": "pass", "C3": "pass", "C4": "pass", "C5": "pass", "C6": "pass"}
    assert best["tier"] == "T1" and best["composite"] == 100.0

    loss = by["1004.TW"]  # 本益比空白：盈餘殖利率視為最低
    assert loss["metrics"]["pe"] is None and loss["metrics"]["earnings_yield"] == 0.0

    fin = by["1005.TW"]  # 金融保險業：營收從缺、C4 不適用；綜合評分在其他組成間重新正規化
    assert fin["components"]["revenue"] is None and fin["conditions"]["C4"] == "na"
    present = {k: v for k, v in fin["components"].items() if v is not None}
    expected = sum(WEIGHTS[k] * v for k, v in present.items()) / sum(WEIGHTS[k] for k in present)
    assert fin["composite"] == pytest.approx(expected, abs=0.1)  # 輸出的組成分數已四捨五入到 0.1
    assert "revenue" in fin["missing"]

    assert out["rules_version"] == RULES_VERSION and out["base_date"] == AS_OF.isoformat()
    assert out["sources"]["margin_days"] == 1 and out["sources"]["revenue_month"] == "2026-08"
    tiers = [s["tier"] for s in out["stocks"]]
    order = {"T1": 0, "T2": 1, "T3": 2, None: 3}
    assert tiers == sorted(tiers, key=order.get)  # 依分層、再依綜合評分排序


def test_missing_data_counts_as_a_miss(tmp_path):
    names, rank, closes = _pool(tmp_path)
    del closes["1000.TW"]  # 價格不足：動能從缺，C2、C6 視為不符合
    out = build_screener(as_of=AS_OF, names=names, rank_pct=rank, closes=closes, data_dir=tmp_path)
    best = next(s for s in out["stocks"] if s["ticker"] == "1000.TW")
    assert best["components"]["momentum"] is None
    assert best["conditions"]["C2"] == "missing" and best["conditions"]["C6"] == "missing"
    assert best["tier"] == "T3"


def test_tier_caps_do_not_backfill(monkeypatch, tmp_path):
    names, rank, closes = _pool(tmp_path)
    monkeypatch.setattr(screener, "TIER_CAPS", {"T1": 1, "T2": 1, "T3": 1})
    rank = {t: 0.9 for t in names}  # 讓多檔進同一層
    out = build_screener(as_of=AS_OF, names=names, rank_pct=rank, closes=closes, data_dir=tmp_path)
    for tier in ("T1", "T2", "T3"):
        assert sum(s["tier"] == tier for s in out["stocks"]) <= 1
    over = [s for s in out["stocks"] if s["over_cap"]]
    assert all(s["tier"] is None for s in over)


@pytest.mark.leakage
def test_files_after_the_base_date_are_ignored(tmp_path):
    names, rank, closes = _pool(tmp_path)
    before = build_screener(as_of=AS_OF, names=names, rank_pct=rank, closes=closes, data_dir=tmp_path)
    later = AS_OF + timedelta(days=1)
    codes = [t.removesuffix(".TW") for t in names]
    _write(tmp_path, "BWIBBU_ALL", later, [{"Date": "1151007", "Code": c, "Name": c, "PEratio": "1", "DividendYield": "9", "PBratio": "9"} for c in codes])
    _write(tmp_path, "MI_MARGN", later, [_margin(c, 1, 999) for c in codes])
    _write(tmp_path, "TDCC_OD_1-5", later, [r for c in codes for r in _tdcc(c, 1.0)])
    _write(tmp_path, "t187ap05_L", later, [{"出表日期": "1151007", "資料年月": "11509", "公司代號": c, "產業別": "x", "營業收入-去年同月增減(%)": "-99", "累計營業收入-前期比較增減(%)": "-99"} for c in codes])
    after = build_screener(as_of=AS_OF, names=names, rank_pct=rank, closes=closes, data_dir=tmp_path)
    assert after == before


def test_weights_and_version_match_the_preregistration():
    """程式的權重與版本必須和 docs/screener_prereg.md 寫的一致：改規則要先升版文件。"""
    doc = (Path(__file__).resolve().parents[2] / "docs" / "screener_prereg.md").read_text(encoding="utf-8")
    assert f"（{RULES_VERSION}）" in doc.splitlines()[0]
    label = {"rank": "排序", "momentum": "動能", "valuation": "評價", "revenue": "營收", "chips": "籌碼"}
    for key, weight in WEIGHTS.items():
        assert re.search(rf"^\| {label[key]} \| {round(weight * 100)}% \|$", doc, re.M), key
    assert sum(WEIGHTS.values()) == pytest.approx(1.0)
    assert screener.TIER_CAPS == {"T1": 10, "T2": 15, "T3": 15}
