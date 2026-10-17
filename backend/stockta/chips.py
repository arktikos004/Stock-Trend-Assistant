"""融資融券與大戶持股：個股頁的籌碼面板（GET /api/stocks/{ticker}/chips）。

只用 twse-data 分支逐日累積的開放資料：證交所的融資融券餘額（MI_MARGN）與個股日成交資訊
（STOCK_DAY_ALL，收盤價與成交量），以及集保結算所的集保戶股權分散表（TDCC_OD_1-5，每週一份）。
融資成本與融資維持率是本站估算（見 next_cost），不是證交所公布的數字；輸出的 meta.estimates 列出這兩欄。

融資融券表的單位是張。表格把 0 留白：2026-10-06～10-15 收到的 9,091 列，「前日餘額＋買進−賣出−償還＝今日餘額」
在空白當 0 時每一列都成立，所以空白讀成 0；'--' 之類無法解析的值才是缺漏。
"""

from __future__ import annotations

import functools
from datetime import date
from pathlib import Path

from stockta.config import STOCK_POOL
from stockta.data.twse import DATASETS, LICENSE_NAME, LICENSE_URL, attribution, load_candles, parse_number
from stockta.screener import BIG_HOLDER_LEVEL, _dated_files, _rows

MARGIN_RATE = 0.6  # 維持率估算用的融資成數：上市股票的融資金額約為買進價款的 6 成
# 集保持股分級 12–15：400,001 股以上（分級界線見 holder_series）
OVER_400_LEVELS = ("12", "13", "14", "15")
ESTIMATES = ("margin_cost", "maintenance_pct")
ESTIMATE_LABEL = "本站估算"
SOURCE_DATASETS = ("MI_MARGN", "STOCK_DAY_ALL", "TDCC_OD_1-5")

_POOL_CODES = frozenset(t.removesuffix(".TW") for t in STOCK_POOL)


@functools.lru_cache(maxsize=4096)
def _code_rows(path: str, size: int, code_key: str, codes: frozenset[str]) -> dict[str, tuple[dict[str, str], ...]]:
    """一個資料檔裡指定代號的列。檔名＋大小當快取鍵：每天只解析新增的那個檔，不必每次請求重讀全部。"""
    found: dict[str, list[dict[str, str]]] = {}
    for row in _rows(Path(path)):
        code = row.get(code_key)
        if code in codes:
            found.setdefault(code, []).append(row)
    return {code: tuple(rows) for code, rows in found.items()}


def _dated_rows(data_dir: Path, dataset: str, code_key: str, code: str) -> list[tuple[date, tuple[dict[str, str], ...]]]:
    """某資料集每一份檔案裡這個代號的列，由舊到新；檔案裡沒有這個代號的日子略過。"""
    # 股票池的代號一起讀進快取：整個股票池共用同一次解析
    codes = _POOL_CODES if code in _POOL_CODES else frozenset({code})
    out = []
    for day, path in _dated_files(data_dir, dataset, date.max):
        rows = _code_rows(str(path), path.stat().st_size, code_key, codes).get(code)
        if rows:
            out.append((day, rows))
    return out


def _lots(row: dict[str, str], key: str) -> int | None:
    """融資融券表的張數：空白是 0，無法解析（'--' 等）或沒有這一欄是 None。"""
    text = row.get(key)
    if text is None:
        return None
    if not text.strip():
        return 0
    value = parse_number(text)
    return None if value is None else round(value)


def _minus(a: int | None, b: int | None) -> int | None:
    return None if a is None or b is None else a - b


def _ratio_pct(numerator: int | None, denominator: int | None) -> float | None:
    return round(numerator / denominator * 100, 4) if numerator is not None and denominator else None


def _round(value: float | None, digits: int = 2) -> float | None:
    return None if value is None else round(value, digits)


def _prices(data_dir: Path, code: str) -> dict[date, tuple[float, int]]:
    """證交所每日收盤價與成交張數（成交股數 ÷ 1000，四捨五入）；當天沒有成交的日子不在裡面。"""
    frame = load_candles(data_dir, code)
    return {ts.date(): (float(close), int((volume + 500) // 1000)) for ts, close, volume in zip(frame.index, frame["close"], frame["volume"])}


def next_cost(prev: float | None, balance: int | None, bought: int | None, close: float | None) -> float | None:
    """融資成本（本站估算）往後推一個交易日。

    今日餘額裡前一天留下的部分（今日餘額 − 今日融資買進，小於 0 以 0 計）沿用前一天的成本，其餘以今日收盤價計：
    成本ₜ ＝〔成本ₜ₋₁ ×（餘額ₜ − 買進ₜ）＋ 收盤ₜ × 買進ₜ〕÷ 餘額ₜ。買進多於餘額（當天買了又賣掉）時餘額全部以收盤價計。
    還沒有成本時（第一天、餘額歸零之後、無法估算之後）以當天收盤價起算；餘額 ≤ 0 或缺漏時回 None。
    有新的融資買進卻沒有收盤價時也回 None：下一個有收盤價的日子重新起算。
    """
    if balance is None or balance <= 0:
        return None
    if prev is None:
        return close
    if bought == 0:
        return prev
    if bought is None or close is None:
        return None
    kept = max(balance - bought, 0)
    return (prev * kept + close * (balance - kept)) / balance


def margin_series(data_dir: Path, code: str) -> list[dict]:
    """逐日融資融券（由舊到新），併入同一天證交所的收盤價與成交張數，並估算融資成本與維持率。

    漏收的交易日沒有這一天的列：增減取同一份的今日 − 前日餘額，成本估算直接接到下一個有資料的日子。
    """
    rows = _dated_rows(data_dir, "MI_MARGN", "股票代號", code)
    prices = _prices(data_dir, code) if rows else {}
    records = []
    cost: float | None = None
    for day, found in rows:
        row = found[0]
        close, volume_lots = prices.get(day, (None, None))
        margin_balance, short_balance = _lots(row, "融資今日餘額"), _lots(row, "融券今日餘額")
        margin_buy = _lots(row, "融資買進")
        cost = next_cost(cost, margin_balance, margin_buy, close)
        records.append(
            {
                "date": day.isoformat(),
                "close": close,
                "volume_lots": volume_lots,
                "margin_buy": margin_buy,
                "margin_sell": _lots(row, "融資賣出"),
                "margin_redeem": _lots(row, "融資現金償還"),
                "margin_balance": margin_balance,
                "margin_change": _minus(margin_balance, _lots(row, "融資前日餘額")),
                "margin_limit": _lots(row, "融資限額"),
                "margin_usage_pct": _ratio_pct(margin_balance, _lots(row, "融資限額")),
                "short_sell": _lots(row, "融券賣出"),
                "short_buy": _lots(row, "融券買進"),
                "short_redeem": _lots(row, "融券現券償還"),
                "short_balance": short_balance,
                "short_change": _minus(short_balance, _lots(row, "融券前日餘額")),
                "short_margin_pct": _ratio_pct(short_balance, margin_balance),
                "offset": _lots(row, "資券互抵"),
                "margin_cost": _round(cost),
                "maintenance_pct": _round(close / (cost * MARGIN_RATE) * 100) if close is not None and cost else None,
            }
        )
    return records


def _level_sum(by_level: dict[str, dict[str, str]], levels: tuple[str, ...], key: str) -> float | None:
    """幾個持股分級的某一欄相加；任何一級缺列或無法解析就是 None。"""
    values = [parse_number(by_level[level].get(key)) if level in by_level else None for level in levels]
    return None if any(v is None for v in values) else sum(values)


def _change(now: float | None, before: float | None) -> float | None:
    """百分比的變化（百分點）；四捨五入到小數 2 位，避免 84.78 − 84.77 這類浮點尾數。"""
    return None if now is None or before is None else round(now - before, 2)


def holder_series(data_dir: Path, code: str) -> list[dict]:
    """逐週集保股權分散（由舊到新）：千張大戶與 400 張以上的持股比例、人數，以及和前一份週資料相比的變化。

    持股分級 12–15 是 400,001–600,000、600,001–800,000、800,001–1,000,000、1,000,001 股以上（16 是差異數調整、
    17 是合計）。2026-10-02、10-08 兩週的資料逐列驗過：每一級的「股數 ÷ 人數」都落在該級的區間內，
    單一持有人剛好 1,000,000 股的列在分級 14、600,000 股在 12。比例照集保公布的數字（小數 2 位），400 張以上是四級相加。
    """
    records: list[dict] = []
    for day, rows in _dated_rows(data_dir, "TDCC_OD_1-5", "證券代號", code):
        by_level = {row.get("持股分級"): row for row in rows}
        big_pct = _level_sum(by_level, (BIG_HOLDER_LEVEL,), "占集保庫存數比例%")
        big_holders = _level_sum(by_level, (BIG_HOLDER_LEVEL,), "人數")
        over_pct = _level_sum(by_level, OVER_400_LEVELS, "占集保庫存數比例%")
        over_holders = _level_sum(by_level, OVER_400_LEVELS, "人數")
        prev = records[-1] if records else {}
        record = {
            "date": day.isoformat(),
            "big_pct": _round(big_pct),
            "big_holders": None if big_holders is None else round(big_holders),
            "over400_pct": _round(over_pct),
            "over400_holders": None if over_holders is None else round(over_holders),
        }
        record |= {
            "big_pct_change": _change(record["big_pct"], prev.get("big_pct")),
            "big_holders_change": _minus(record["big_holders"], prev.get("big_holders")),
            "over400_pct_change": _change(record["over400_pct"], prev.get("over400_pct")),
            "over400_holders_change": _minus(record["over400_holders"], prev.get("over400_holders")),
        }
        records.append(record)
    return records


def _cost_start(margin: list[dict]) -> str | None:
    """目前這段融資成本估算的起算日：最後一段連續有成本的第一天。"""
    start = None
    for record in reversed(margin):
        if record["margin_cost"] is None:
            break
        start = record["date"]
    return start


def _source(dataset: str) -> dict:
    spec = DATASETS[dataset]
    return {
        "dataset": dataset,
        "title": spec.title,
        "provider": spec.provider,
        "gov_id": spec.gov_id,
        "dataset_url": f"https://data.gov.tw/dataset/{spec.gov_id}",
        "source_urls": list(spec.outlets),
        "attribution": attribution(dataset),
    }


def build_chips(data_dir: Path, ticker: str) -> dict:
    """一檔股票的籌碼資料（JSON 可序列化；結構見 api/schemas.ChipsResponse）。沒有資料時序列是空的。"""
    code = ticker.removesuffix(".TW")
    margin = margin_series(data_dir, code)
    holders = holder_series(data_dir, code)
    return {
        "ticker": ticker,
        "margin": margin,
        "holders": holders,
        "meta": {
            "margin_start": margin[0]["date"] if margin else None,
            "margin_end": margin[-1]["date"] if margin else None,
            "cost_start": _cost_start(margin),
            "holders_start": holders[0]["date"] if holders else None,
            "holders_end": holders[-1]["date"] if holders else None,
            "estimates": list(ESTIMATES),
            "estimate_label": ESTIMATE_LABEL,
            "margin_rate": MARGIN_RATE,
            "sources": [_source(dataset) for dataset in SOURCE_DATASETS],
            "license": LICENSE_NAME,
            "license_url": LICENSE_URL,
        },
    }
