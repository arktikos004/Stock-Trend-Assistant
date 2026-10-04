"""臺灣證券交易所 OpenAPI：每日盤後資料的收集與讀取。

**為什麼要自己累積**：證交所 OpenAPI 的端點全都沒有查詢參數，`STOCK_DAY_ALL`
只回「最新一個交易日」的全市場行情。錯過一天就永遠補不回來（官網的歷史頁面禁止
以程式下載；歷史資料要向 Data E-Shop 購買），所以每天收盤後把當日檔案原樣存進
`twse-data` 分支，一般 commit、不覆寫歷史。

**為什麼可以公開**：這些資料由證交所授權政府資料開放平臺釋出，依「政府資料開放
授權條款第 1 版」可再散布，但必須顯名（見 ATTRIBUTION）。網站的 K 線只用這份資料；
訓練用的歷史價格（yfinance）僅內部研究、不對外提供。

收集只用標準函式庫：GitHub Actions 不必安裝整套後端就能跑，也不會因為別的相依
壞掉而漏收一天。讀取（load_candles）才用到 pandas。
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import time
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

OPENAPI_BASE = "https://openapi.twse.com.tw/v1"

# 資料集 → (OpenAPI 路徑, 備援 CSV 網址或 None, 合理的最少列數)
# 備援網址是政府資料開放平臺「盤後資訊 > 個股日成交資訊」登錄的資源網址，同樣是官方開放資料。
DATASETS: dict[str, tuple[str, str | None, int]] = {
    "STOCK_DAY_ALL": (
        "/exchangeReport/STOCK_DAY_ALL",
        "https://www.twse.com.tw/exchangeReport/STOCK_DAY_ALL?response=open_data",
        500,
    ),
    "MI_INDEX": ("/exchangeReport/MI_INDEX", None, 50),
}
REQUIRED_DATASETS = ("STOCK_DAY_ALL",)

# 備援 CSV 的中文欄名 → OpenAPI 的英文欄名（兩者內容相同，存檔一律用 OpenAPI 的鍵）
_CSV_TO_OPENAPI = {
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
}

LICENSE_NAME = "政府資料開放授權條款第1版"
LICENSE_URL = "https://data.gov.tw/license"
ATTRIBUTION = (
    "資料來源：臺灣證券交易所 OpenAPI（政府資料開放平臺「盤後資訊 > 個股日成交資訊」等資料集）。"
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


def rows_from_csv(text: str) -> list[dict[str, str]]:
    """備援 CSV → 與 OpenAPI 相同鍵名的列。"""
    reader = csv.DictReader(io.StringIO(text.lstrip("﻿")))
    rows = []
    for raw in reader:
        rows.append({_CSV_TO_OPENAPI.get(k.strip(), k.strip()): (v or "").strip() for k, v in raw.items()})
    return rows


def _date_key(rows: list[dict[str, str]]) -> str:
    """STOCK_DAY_ALL 用 'Date'、MI_INDEX 用 '日期'。"""
    return "Date" if "Date" in rows[0] else "日期"


def validate_rows(dataset: str, rows: list[dict[str, str]]) -> date:
    """檢查列數與日期一致，回傳資料日期。"""
    minimum = DATASETS[dataset][2]
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


def fetch(dataset: str) -> tuple[date, list[dict[str, str]], str]:
    """取得資料集的最新一日：先打 OpenAPI，失敗再用備援 CSV。回傳 (日期, 列, 實際來源網址)。"""
    path, fallback, _ = DATASETS[dataset]
    errors: list[str] = []
    url = OPENAPI_BASE + path
    try:
        rows = json.loads(_get(url).decode("utf-8"))
        return validate_rows(dataset, rows), rows, url
    except (TwseError, ValueError) as exc:
        errors.append(f"{url}: {exc}")
    if fallback:
        try:
            rows = rows_from_csv(_get(fallback).decode("utf-8-sig"))
            return validate_rows(dataset, rows), rows, fallback
        except (TwseError, ValueError) as exc:
            errors.append(f"{fallback}: {exc}")
    raise TwseError("；".join(errors))


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


def load_candles(data_dir: Path, code: str):
    """單一股票（代號不含 .TW）的日 K：欄位 open/high/low/close/volume，索引為日期。

    **未還原權值**——證交所公告的是當日實際成交價，除權息日會有跳空，圖表需註明。
    當日無成交（價格為 '--'）的日子略過。
    """
    import pandas as pd

    records = []
    for path in sorted((data_dir / "stock_day_all").glob("*/*.json")):
        payload = json.loads(path.read_text(encoding="utf-8"))
        for row in payload["rows"]:
            if row.get("Code") != code:
                continue
            values = [parse_number(row.get(k)) for k in ("OpeningPrice", "HighestPrice", "LowestPrice", "ClosingPrice")]
            volume = parse_number(row.get("TradeVolume"))
            if any(v is None for v in values) or volume is None:
                break
            records.append((pd.Timestamp(payload["meta"]["date"]), *values, volume))
            break
    frame = pd.DataFrame(records, columns=["date", "open", "high", "low", "close", "volume"])
    return frame.set_index("date").sort_index()


def _cmd_fetch(args: argparse.Namespace) -> int:
    data_dir = Path(args.out)
    summary: dict[str, object] = {}
    failed_required = False
    for dataset in args.datasets:
        try:
            day, rows, source_url = fetch(dataset)
        except TwseError as exc:
            summary[dataset] = {"error": str(exc)}
            failed_required |= dataset in REQUIRED_DATASETS
            continue
        written = store(data_dir, dataset, day, rows, source_url)
        summary[dataset] = {
            "date": day.isoformat(),
            "rows": len(rows),
            "source_url": source_url,
            "written": written.relative_to(data_dir).as_posix() if written else None,
        }
    print(json.dumps(summary, ensure_ascii=False))
    return 1 if failed_required else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m stockta.data.twse", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    fetch_parser = sub.add_parser("fetch", help="抓最新一日並存檔（已存在則略過）")
    fetch_parser.add_argument("--out", required=True, help="資料目錄（twse-data 分支的工作目錄）")
    fetch_parser.add_argument("--datasets", nargs="+", default=list(DATASETS), choices=list(DATASETS))
    args = parser.parse_args(argv)
    if args.command == "fetch":
        return _cmd_fetch(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
