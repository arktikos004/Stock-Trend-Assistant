"""篩選器與綜合評分：規則見 docs/screener_prereg.md（版本 RULES_VERSION）。

**不是預測、也不是投資建議**：把相對強弱排序的模型輸出、內部價格的衍生值（報酬率、均線、突破前高）
與證交所、集保的開放資料，依預先聲明的固定規則整理成 0–100 的綜合評分與 T1／T2／T3 候選分層，
並公開每一個組成分數與權重。研究工作台用來把 49 檔縮成少數值得打開 K 線細看的股票。

每個來源只取基準日 D 當天或以前的資料（價格截到 D；開放資料取日期 ≤ D 的檔案）。
目前只在每日排程即時計算：開放資料的檔名日期是資料日，要做歷史重算時須改以收集時間判斷可得性。
"""

from __future__ import annotations

import json
import math
import statistics
from dataclasses import dataclass
from datetime import date
from pathlib import Path

import pandas as pd

from stockta.data.twse import parse_number

RULES_VERSION = "v1"
RULES_DOC = "docs/screener_prereg.md"

# 綜合評分的權重（預先聲明；改了要升版文件，tests/test_screener.py 會比對）
WEIGHTS: dict[str, float] = {"rank": 0.30, "momentum": 0.20, "valuation": 0.15, "revenue": 0.20, "chips": 0.15}
TIER_CAPS: dict[str, int] = {"T1": 10, "T2": 15, "T3": 15}
CONDITIONS = ("C1", "C2", "C3", "C4", "C5", "C6")

RANK_PCT_MIN = 0.60  # C1
VALUATION_MIN = 50.0  # C3
MOMENTUM_DAYS = (20, 60)
BREAKOUT_LOOKBACK = 60  # 突破前高：D 之前 60 個交易日（不含 D）的最高收盤價
MA_WINDOWS = (5, 20, 60)
MARGIN_WINDOW = 5  # 融資餘額變化率：往前第 5 個交易日
BIG_HOLDER_LEVEL = "15"  # 集保持股分級 15：1,000,001 股以上（千張大戶）
FINANCIAL_INDUSTRY = "金融保險業"  # 月營收含投資損益，與一般產業不可比：營收組成不計、C4 不適用


@dataclass(frozen=True)
class PriceSignals:
    ret20: float
    ret60: float
    breakout: bool
    ma_bullish: bool


def percentiles(values: dict[str, float | None], higher_is_better: bool = True) -> dict[str, float | None]:
    """股票池內的百分位：最差 0、最好 100，同值取平均名次；少於 2 檔有值時全部為 None。"""
    valid = {k: v for k, v in values.items() if v is not None and math.isfinite(v)}
    out: dict[str, float | None] = dict.fromkeys(values)
    if len(valid) < 2:
        return out
    ranks = pd.Series(valid).rank(method="average", ascending=higher_is_better)
    n = len(ranks)
    for key, r in ranks.items():
        out[key] = float((r - 1) / (n - 1) * 100)
    return out


def price_signals(close: pd.Series, as_of: date) -> PriceSignals | None:
    """只用 as_of 當天或以前的收盤價；不足 61 個交易日回 None。"""
    s = close[close.index <= pd.Timestamp(as_of)].dropna()
    if len(s) < BREAKOUT_LOOKBACK + 1:
        return None
    last = float(s.iloc[-1])
    ret20, ret60 = (last / float(s.iloc[-1 - n]) - 1 for n in MOMENTUM_DAYS)
    breakout = last > float(s.iloc[-1 - BREAKOUT_LOOKBACK : -1].max())
    ma5, ma20, ma60 = (float(s.iloc[-n:].mean()) for n in MA_WINDOWS)
    return PriceSignals(ret20=ret20, ret60=ret60, breakout=breakout, ma_bullish=ma5 > ma20 > ma60)


def _dated_files(data_dir: Path, dataset: str, as_of: date) -> list[tuple[date, Path]]:
    """twse-data 裡某資料集日期 ≤ as_of 的檔案，由舊到新。"""
    out = []
    for path in (Path(data_dir) / dataset.lower()).glob("*/*.json"):
        try:
            day = date.fromisoformat(path.stem)
        except ValueError:
            continue
        if day <= as_of:
            out.append((day, path))
    return sorted(out)


def _rows(path: Path) -> list[dict[str, str]]:
    return json.loads(path.read_text(encoding="utf-8"))["rows"]


def margin_changes(data_dir: Path, as_of: date) -> tuple[dict[str, float | None], int, date | None]:
    """融資餘額變化率（減少為負）、實際涵蓋的交易日數、最新一份的日期。

    起點＝往前第 MARGIN_WINDOW 份的融資今日餘額；不足時用最早一份的融資前日餘額（至少涵蓋 1 日）。
    """
    files = _dated_files(data_dir, "MI_MARGN", as_of)
    if not files:
        return {}, 0, None
    if len(files) > MARGIN_WINDOW:
        start_path, start_key, covered = files[-1 - MARGIN_WINDOW][1], "融資今日餘額", MARGIN_WINDOW
    else:
        start_path, start_key, covered = files[0][1], "融資前日餘額", len(files)
    start = {r["股票代號"]: parse_number(r[start_key]) for r in _rows(start_path)}
    changes: dict[str, float | None] = {}
    for r in _rows(files[-1][1]):
        code, today, base = r["股票代號"], parse_number(r["融資今日餘額"]), start.get(r["股票代號"])
        changes[code] = (today - base) / base if today is not None and base else None
    return changes, covered, files[-1][0]


def big_holder_changes(data_dir: Path, as_of: date) -> tuple[dict[str, float | None], list[date]]:
    """千張大戶持股比例的週變化（百分點）與用到的週別；只有一週資料時沒有變化可算。"""
    files = _dated_files(data_dir, "TDCC_OD_1-5", as_of)
    if len(files) < 2:
        return {}, [day for day, _ in files[-1:]]

    def ratios(path: Path) -> dict[str, float | None]:
        return {r["證券代號"]: parse_number(r["占集保庫存數比例%"]) for r in _rows(path) if r["持股分級"] == BIG_HOLDER_LEVEL}

    prev, cur = ratios(files[-2][1]), ratios(files[-1][1])
    changes = {
        code: (ratio - prev[code]) if ratio is not None and prev.get(code) is not None else None
        for code, ratio in cur.items()
    }
    return changes, [files[-2][0], files[-1][0]]


def _latest(data_dir: Path, dataset: str, as_of: date) -> tuple[date | None, list[dict[str, str]]]:
    files = _dated_files(data_dir, dataset, as_of)
    return (files[-1][0], _rows(files[-1][1])) if files else (None, [])


def _mean(values: list[float | None]) -> float | None:
    present = [v for v in values if v is not None]
    return statistics.fmean(present) if present else None


def _round(value: float | None, digits: int = 1) -> float | None:
    return None if value is None else round(value, digits)


def _condition(passed: bool | None) -> str:
    """True→pass、False→fail、None→missing（應該有卻沒有的資料一律視為不符合）。"""
    return "missing" if passed is None else "pass" if passed else "fail"


def build_screener(
    *,
    as_of: date,
    names: dict[str, str],
    rank_pct: dict[str, float],
    closes: dict[str, pd.Series],
    data_dir: Path,
) -> dict:
    """全池的組成分數、綜合評分、條件與分層（JSON 可序列化；結構見 api/schemas.ScreenerResponse）。"""
    tickers = list(names)
    code = {t: t.removesuffix(".TW") for t in tickers}
    signals = {t: price_signals(closes[t], as_of) if t in closes else None for t in tickers}

    val_day, val_rows = _latest(data_dir, "BWIBBU_ALL", as_of)
    valuation = {r.get("Code"): r for r in val_rows}
    rev_day, rev_rows = _latest(data_dir, "t187ap05_L", as_of)
    revenue = {r.get("公司代號"): r for r in rev_rows}
    margin, margin_days, margin_day = margin_changes(data_dir, as_of)
    holders, holder_weeks = big_holder_changes(data_dir, as_of)

    metrics: dict[str, dict] = {}
    for t in tickers:
        c, s, v, r = code[t], signals[t], valuation.get(code[t]), revenue.get(code[t])
        pe = parse_number(v.get("PEratio")) if v else None
        pb = parse_number(v.get("PBratio")) if v else None
        industry = (r or {}).get("產業別", "")
        financial = industry == FINANCIAL_INDUSTRY
        metrics[t] = {
            "rank_pct": rank_pct.get(t),
            "ret20": s.ret20 if s else None,
            "ret60": s.ret60 if s else None,
            "breakout": s.breakout if s else None,
            "ma_bullish": s.ma_bullish if s else None,
            "pe": pe if pe and pe > 0 else None,
            # 本益比空白（虧損或無法計算）時盈餘殖利率視為最低；整列都沒有時才算缺資料
            "earnings_yield": (1 / pe if pe and pe > 0 else 0.0) if v else None,
            "dividend_yield": parse_number(v.get("DividendYield")) if v else None,
            "pb": pb if pb and pb > 0 else None,
            "book_to_price": 1 / pb if pb and pb > 0 else None,
            "revenue_yoy": None if financial or not r else parse_number(r.get("營業收入-去年同月增減(%)")),
            "revenue_cum_yoy": None if financial or not r else parse_number(r.get("累計營業收入-前期比較增減(%)")),
            "margin_change": margin.get(c),
            "big_holder_change": holders.get(c),
            "_industry": industry,
            "_financial": financial,
        }

    def pct(key: str, higher_is_better: bool = True) -> dict[str, float | None]:
        return percentiles({t: metrics[t][key] for t in tickers}, higher_is_better)

    p = {
        key: pct(key, higher)
        for key, higher in (
            ("ret20", True),
            ("ret60", True),
            ("earnings_yield", True),
            ("dividend_yield", True),
            ("book_to_price", True),
            ("revenue_yoy", True),
            ("revenue_cum_yoy", True),
            ("margin_change", False),
            ("big_holder_change", True),
        )
    }
    ret60 = [m["ret60"] for m in metrics.values() if m["ret60"] is not None]
    median60 = statistics.median(ret60) if ret60 else None

    stocks = []
    for t in tickers:
        m = metrics[t]
        components = {
            "rank": None if m["rank_pct"] is None else m["rank_pct"] * 100,
            "momentum": _mean([p["ret20"][t], p["ret60"][t]]),
            "valuation": _mean([p["earnings_yield"][t], p["dividend_yield"][t], p["book_to_price"][t]]),
            "revenue": None if m["_financial"] else _mean([p["revenue_yoy"][t], p["revenue_cum_yoy"][t]]),
            "chips": _mean([p["margin_change"][t], p["big_holder_change"][t]]),
        }
        present = {k: v for k, v in components.items() if v is not None}
        composite = sum(WEIGHTS[k] * v for k, v in present.items()) / sum(WEIGHTS[k] for k in present) if present else None
        conditions = {
            "C1": _condition(None if m["rank_pct"] is None else m["rank_pct"] >= RANK_PCT_MIN),
            "C2": _condition(None if m["ret60"] is None or median60 is None else m["ret60"] > median60),
            "C3": _condition(None if components["valuation"] is None else components["valuation"] >= VALUATION_MIN),
            "C4": "na" if m["_financial"] else _condition(None if m["revenue_yoy"] is None else m["revenue_yoy"] > 0),
            "C5": _condition(None if m["margin_change"] is None else m["margin_change"] <= 0),
            "C6": _condition(None if m["breakout"] is None else m["breakout"] or m["ma_bullish"]),
        }
        misses = sum(state in ("fail", "missing") for state in conditions.values())
        stocks.append(
            {
                "ticker": t,
                "name": names[t],
                "industry": m["_industry"],
                "composite": _round(composite),
                "components": {k: _round(v) for k, v in components.items()},
                "missing": [k for k, v in components.items() if v is None],
                "metrics": {
                    k: (_round(v, 6) if isinstance(v, float) else v) for k, v in m.items() if not k.startswith("_")
                },
                "conditions": conditions,
                "misses": misses,
                "tier": {0: "T1", 1: "T2", 2: "T3"}.get(misses),
                "over_cap": False,
            }
        )

    # 層內依綜合評分由高到低（同分依代號）；超過上限的不列入、也不移到下一層，不足不補位
    order = {"T1": 0, "T2": 1, "T3": 2, None: 3}
    stocks.sort(key=lambda s: (order[s["tier"]], -(s["composite"] if s["composite"] is not None else -1), s["ticker"]))
    taken = dict.fromkeys(TIER_CAPS, 0)
    for s in stocks:
        tier = s["tier"]
        if tier is None:
            continue
        if taken[tier] >= TIER_CAPS[tier]:
            s["tier"], s["over_cap"] = None, True
        else:
            taken[tier] += 1
    stocks.sort(key=lambda s: (order[s["tier"]], -(s["composite"] if s["composite"] is not None else -1), s["ticker"]))

    revenue_month = None
    if rev_rows:
        ym = rev_rows[0].get("資料年月", "")
        if ym.isdigit() and len(ym) >= 4:
            revenue_month = f"{int(ym[:-2]) + 1911}-{ym[-2:]}"
    price_days = [s.index.max().date() for s in closes.values() if len(s)]
    return {
        "base_date": as_of.isoformat(),
        "rules_version": RULES_VERSION,
        "rules_doc": RULES_DOC,
        "weights": WEIGHTS,
        "tier_caps": TIER_CAPS,
        "sources": {
            "prices": min(max(price_days), as_of).isoformat() if price_days else None,
            "valuation": val_day.isoformat() if val_day else None,
            "revenue": rev_day.isoformat() if rev_day else None,
            "revenue_month": revenue_month,
            "margin": margin_day.isoformat() if margin_day else None,
            "margin_days": margin_days,
            "big_holder_weeks": [d.isoformat() for d in holder_weeks],
        },
        "counts": {tier: sum(s["tier"] == tier for s in stocks) for tier in TIER_CAPS},
        "stocks": stocks,
    }
