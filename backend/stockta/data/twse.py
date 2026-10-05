"""臺灣證券交易所開放資料：每日盤後資料的收集與讀取。

**為什麼要自己累積**：這份開放資料沒有查詢參數，`STOCK_DAY_ALL` 只給「最新一個
交易日」的全市場行情。錯過的日子補不回來（官網的歷史頁面禁止以程式下載；歷史資料
要向 Data E-Shop 購買），所以每天收盤後把當日檔案原樣存進 `twse-data` 分支，
一般 commit、不覆寫歷史。

**為什麼兩個出口都抓**：同一個資料集有兩個官方出口，換日的時間不同（2026-10-05 實測）：
政府資料開放平臺登錄的 CSV 當晚已是當日資料；OpenAPI 到當晚 21:00 仍是前一個交易日，
檔案在清晨約 05:20 才更新。只抓 OpenAPI，網站 K 線會永遠慢一天。所以每次兩邊各抓
一次、日期不同就各存一份：當天拿得到今日資料，前一天漏收時還能從 OpenAPI 補回來。

**為什麼可以公開**：這些資料由證交所授權政府資料開放平臺釋出，依「政府資料開放
授權條款第 1 版」可再散布，但必須顯名（見 ATTRIBUTION）。網站的 K 線只用這份資料；
訓練用的歷史價格（yfinance）僅內部研究、不對外提供。

收集只用標準函式庫：GitHub Actions 不必安裝整套後端就能跑，也不會因為別的相依
壞掉而漏收一天。讀取（load_candles）才用到 pandas。
"""

from __future__ import annotations

import argparse
import csv
import functools
import io
import json
import os
import sys
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

OPENAPI_BASE = "https://openapi.twse.com.tw/v1"

# 資料集 → (OpenAPI 路徑, 政府資料開放平臺登錄的 CSV 資源網址, 合理的最少列數)
# CSV 網址取自 data.gov.tw 的資料集頁面（授權皆為政府資料開放授權條款第 1 版）：
#   11549「盤後資訊 > 個股日成交資訊」、11555「盤後資訊 > 每日收盤行情-大盤統計資訊」
DATASETS: dict[str, tuple[str, str, int]] = {
    "STOCK_DAY_ALL": (
        "/exchangeReport/STOCK_DAY_ALL",
        "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=open_data",
        500,
    ),
    "MI_INDEX": (
        "/exchangeReport/MI_INDEX",
        "https://www.twse.com.tw/exchangeReport/MI_INDEX?response=open_data",
        50,
    ),
}
REQUIRED_DATASETS = ("STOCK_DAY_ALL",)

# CSV 的欄名 → OpenAPI 的欄名（兩者內容相同，存檔一律用 OpenAPI 的鍵；沒列到的欄名兩邊相同）
_CSV_TO_OPENAPI: dict[str, dict[str, str]] = {
    "STOCK_DAY_ALL": {
        "日期": "Date",
        "證券代號": "Code",
        "證券名稱": "Name",
        "成交股數": "TradeVolume",
        "成交金額": "TradeValue",
        "開盤價": "OpeningPrice",
        "最高價": "HighestPrice",
        "最低價": "LowestPrice",
        "收盤價": "ClosingPrice",
        "漲跌價差": "Change",
        "成交筆數": "Transaction",
    },
    "MI_INDEX": {
        "指數/報酬指數": "指數",
        "漲跌(+/-)": "漲跌",
        "漲跌百分比(%)": "漲跌百分比",
    },
}

LICENSE_NAME = "政府資料開放授權條款第1版"
LICENSE_URL = "https://data.gov.tw/license"
ATTRIBUTION = (
    "資料來源：臺灣證券交易所（政府資料開放平臺「盤後資訊 > 個股日成交資訊」"
    "「盤後資訊 > 每日收盤行情-大盤統計資訊」資料集）。"
    "此開放資料依政府資料開放授權條款（Open Government Data License）進行公眾釋出，"
    "使用者於遵守本條款各項規定之前提下，得利用之。政府資料開放授權條款：https://data.gov.tw/license"
)

_USER_AGENT = "Mozilla/5.0 (compatible; stock-trend-assistant/1.0; +https://stock.sekinv.com)"
_TIMEOUT_SECONDS = 30
_RETRIES = 3


class TwseError(RuntimeError):
    """證交所資料取得失敗或內容不合理。"""


def roc_to_date(roc: str) -> date:
    """民國日期字串 → 西元日期：'1151002' → 2026-10-02。"""
    roc = roc.strip()
    if not roc.isdigit() or len(roc) < 6:
        raise TwseError(f"無法解析的民國日期：{roc!r}")
    return date(int(roc[:-4]) + 1911, int(roc[-4:-2]), int(roc[-2:]))


def parse_number(text: str | None) -> float | None:
    """'2,505.00' → 2505.0；當日無成交的 '--'、空字串等一律回傳 None。"""
    if text is None:
        return None
    cleaned = text.strip().replace(",", "")
    if not cleaned or set(cleaned) <= {"-"}:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def _get(url: str) -> bytes:
    last_error: Exception | None = None
    for attempt in range(1, _RETRIES + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
            with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
                return response.read()
        except Exception as exc:  # 連線重設、逾時、HTTP 錯誤都重試
            last_error = exc
            if attempt < _RETRIES:
                time.sleep(5 * attempt)
    raise TwseError(f"下載失敗：{url}（{last_error}）")


def rows_from_csv(text: str, dataset: str = "STOCK_DAY_ALL") -> list[dict[str, str]]:
    """開放資料 CSV → 與 OpenAPI 相同鍵名的列（值保留原字串）。"""
    names = _CSV_TO_OPENAPI[dataset]
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    rows = []
    for raw in reader:
        # 欄數比表頭多的列，DictReader 會把多出來的值放在 None 鍵底下——略過
        rows.append({names.get(k.strip(), k.strip()): (v or "").strip() for k, v in raw.items() if k is not None})
    return rows


def _date_key(rows: list[dict[str, str]]) -> str:
    """STOCK_DAY_ALL 用 'Date'、MI_INDEX 用 '日期'。"""
    return "Date" if "Date" in rows[0] else "日期"


def validate_rows(dataset: str, rows: list[dict[str, str]]) -> date:
    """檢查列數與日期一致，回傳資料日期。"""
    minimum = DATASETS[dataset][2]
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        raise TwseError(f"{dataset} 的內容不是資料列（可能是錯誤頁）")
    if len(rows) < minimum:
        raise TwseError(f"{dataset} 只有 {len(rows)} 列（至少應有 {minimum} 列）")
    key = _date_key(rows)
    dates = {r.get(key, "") for r in rows}
    if len(dates) != 1:
        raise TwseError(f"{dataset} 混有多個日期：{sorted(dates)[:5]}")
    day = roc_to_date(dates.pop())
    if dataset == "STOCK_DAY_ALL" and not any(r.get("Code") == "2330" for r in rows):
        raise TwseError("STOCK_DAY_ALL 缺少 2330，內容可疑")
    return day


def fetch_available(
    dataset: str, *, outlet_errors: list[str] | None = None
) -> list[tuple[date, list[dict[str, str]], str]]:
    """兩個出口各抓一次，回傳目前拿得到的交易日：[(日期, 列, 實際來源網址), ...]，由舊到新。

    兩邊日期不同（通常是 CSV 已換成今日、OpenAPI 還是前一個交易日）就各回一份；
    同一天則只回 OpenAPI 那份。其中一邊失敗不影響另一邊，兩邊都失敗才丟 TwseError；
    各出口失敗的原因會加進 outlet_errors（有給的話），讓呼叫端在只剩一邊時可以示警。
    """
    path, csv_url, _ = DATASETS[dataset]
    openapi_url = OPENAPI_BASE + path
    found: dict[date, tuple[date, list[dict[str, str]], str]] = {}
    errors: list[str] = outlet_errors if outlet_errors is not None else []
    # OpenAPI 排後面：同一天兩邊都有時，由它覆蓋 CSV 那份
    for url, parse in (
        (csv_url, lambda body: rows_from_csv(body.decode("utf-8-sig"), dataset)),
        (openapi_url, lambda body: json.loads(body.decode("utf-8"))),
    ):
        try:
            rows = parse(_get(url))
            day = validate_rows(dataset, rows)
        except (TwseError, ValueError) as exc:
            errors.append(str(exc) if url in str(exc) else f"{url}: {exc}")
            continue
        found[day] = (day, rows, url)
    if not found:
        raise TwseError("；".join(errors))
    return [found[day] for day in sorted(found)]


def file_for(data_dir: Path, dataset: str, day: date) -> Path:
    return data_dir / dataset.lower() / f"{day.year}" / f"{day.isoformat()}.json"


def store(data_dir: Path, dataset: str, day: date, rows: list[dict[str, str]], source_url: str) -> Path | None:
    """寫入當日檔；已存在則不覆寫（官方資料只收一次，之後不動）並回傳 None。"""
    path = file_for(data_dir, dataset, day)
    if path.exists():
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "dataset": dataset,
            "date": day.isoformat(),
            "source_url": source_url,
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "license": LICENSE_NAME,
            "license_url": LICENSE_URL,
            "attribution": ATTRIBUTION,
        },
        "rows": rows,
    }
    path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8")
    return path


def stored_days(data_dir: Path, dataset: str = "STOCK_DAY_ALL") -> list[date]:
    root = data_dir / dataset.lower()
    if not root.exists():
        return []
    return sorted(date.fromisoformat(p.stem) for p in root.glob("*/*.json"))


def _files(data_dir: Path) -> list[Path]:
    return sorted(Path(data_dir).glob("stock_day_all/*/*.json"))


@functools.lru_cache(maxsize=4)
def _candle_table(signature: tuple[tuple[str, int], ...]):
    """全部交易日、全部股票的日 K 長表（code, date, OHLCV）。

    以檔案清單＋大小當快取鍵：每天新增一個檔就自動重讀，否則 API 每次請求都要解析所有檔案。
    """
    import pandas as pd

    records = []
    for name, _size in signature:
        payload = json.loads(Path(name).read_text(encoding="utf-8"))
        day = pd.Timestamp(payload["meta"]["date"])
        for row in payload["rows"]:
            values = [parse_number(row.get(k)) for k in ("OpeningPrice", "HighestPrice", "LowestPrice", "ClosingPrice")]
            volume = parse_number(row.get("TradeVolume"))
            if any(v is None for v in values) or volume is None:
                continue  # 當日無成交
            records.append((row.get("Code"), day, *values, volume))
    return pd.DataFrame(records, columns=["code", "date", "open", "high", "low", "close", "volume"])


def load_candles(data_dir: Path, code: str):
    """單一股票（代號不含 .TW）的日 K：欄位 open/high/low/close/volume，索引為日期。

    **未還原權值**——證交所公告的是當日實際成交價，除權息日會有跳空，圖表需註明。
    當日無成交（價格為 '--'）的日子略過；資料目錄不存在時回傳空表。
    """
    signature = tuple((str(p), p.stat().st_size) for p in _files(data_dir))
    table = _candle_table(signature)
    frame = table.loc[table["code"] == code, ["date", "open", "high", "low", "close", "volume"]]
    return frame.set_index("date").sort_index()


def candle_span(data_dir: Path) -> tuple[date, date] | None:
    """已累積的第一個與最後一個交易日；沒有資料時回傳 None。"""
    days = stored_days(Path(data_dir))
    return (days[0], days[-1]) if days else None


def _cmd_fetch(args: argparse.Namespace) -> int:
    data_dir = Path(args.out)
    summary: dict[str, object] = {}
    failed_required = False
    for dataset in args.datasets:
        outlet_errors: list[str] = []
        try:
            available = fetch_available(dataset, outlet_errors=outlet_errors)
        except TwseError as exc:
            summary[dataset] = {"error": str(exc)}
            failed_required |= dataset in REQUIRED_DATASETS
            continue
        days = []
        for day, rows, source_url in available:
            written = store(data_dir, dataset, day, rows, source_url)
            days.append(
                {
                    "date": day.isoformat(),
                    "rows": len(rows),
                    "source_url": source_url,
                    "written": written.relative_to(data_dir).as_posix() if written else None,
                }
            )
        summary[dataset] = {"days": days, "outlet_errors": outlet_errors}
        # 只剩一個出口不算失敗，但要看得到：CSV 抓不到時，今日資料得等 OpenAPI 隔天清晨才有
        prefix = "::warning title=證交所資料::" if os.environ.get("GITHUB_ACTIONS") == "true" else "警告："
        for problem in outlet_errors:
            print(f"{prefix}{dataset} 有一個出口抓不到——{' '.join(problem.split())}", file=sys.stderr)
    print(json.dumps(summary, ensure_ascii=False))
    return 1 if failed_required else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m stockta.data.twse", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    fetch_parser = sub.add_parser("fetch", help="抓兩個出口目前提供的交易日並存檔（已存在則略過）")
    fetch_parser.add_argument("--out", required=True, help="資料目錄（twse-data 分支的工作目錄）")
    fetch_parser.add_argument("--datasets", nargs="+", default=list(DATASETS), choices=list(DATASETS))
    args = parser.parse_args(argv)
    if args.command == "fetch":
        return _cmd_fetch(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
