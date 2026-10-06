"""臺灣證券交易所（與集保結算所）開放資料：收集與讀取。

**為什麼要自己累積**：這些開放資料沒有查詢參數，只給「最新一期」：`STOCK_DAY_ALL`
是最新一個交易日的全市場行情，月營收是最新一個月，集保股權分散表是最新一週。錯過的
那一期補不回來（官網的歷史頁面禁止以程式下載；歷史資料要向 Data E-Shop 購買），
所以每天收盤後把當期檔案原樣存進 `twse-data` 分支，一般 commit、不覆寫歷史。

**為什麼兩個出口都抓**：同一個資料集有兩個官方出口，換日的時間不同（2026-10-05 實測）：
政府資料開放平臺登錄的 CSV 當晚已是當日資料；OpenAPI 到當晚 21:00 仍是前一個交易日，
檔案在清晨約 05:20 才更新。只抓 OpenAPI，網站 K 線會永遠慢一天。所以每次兩邊各抓
一次、日期不同就各存一份：當天拿得到今日資料，前一天漏收時還能從 OpenAPI 補回來。

**資料日期從哪來**：多數資料集的每一列都帶日期（證交所用民國、集保用西元）。融資融券餘額
與外資持股的內容沒有日期，只有平臺 CSV 的下載檔名帶日期（`MI_MARGN_ALL_20261005.csv`，
2026-10-06 實測與 OpenAPI 前一日的內容相同）；這幾個只抓 CSV、日期取自檔名，OpenAPI
那份判定不了是哪一天，不收。

**為什麼可以公開**：這些資料由證交所、集保結算所授權政府資料開放平臺釋出，依「政府資料
開放授權條款第 1 版」可再散布，但必須顯名（每個檔案的 `meta.attribution`，見 attribution()）。
網站的 K 線只用這份資料；訓練用的歷史價格（yfinance）僅內部研究、不對外提供。

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
import re
import sys
import time
import urllib.request
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

OPENAPI_BASE = "https://openapi.twse.com.tw/v1"
_TWSE_SITE = "https://www.twse.com.tw"
_TWSE = "臺灣證券交易所"
_TDCC = "臺灣集中保管結算所"
_TAIPEI = timezone(timedelta(hours=8))  # 台灣沒有日光節約時間；不用 zoneinfo，Windows 免裝 tzdata


@dataclass(frozen=True)
class Dataset:
    """一個開放資料集：顯名資訊、出口與內容檢查規則。

    出口網址取自政府資料開放平臺的資料集頁面（data.gov.tw/dataset/<gov_id>，授權皆為
    政府資料開放授權條款第 1 版）與證交所 OpenAPI。OpenAPI 回 JSON，其餘出口回 CSV。
    """

    title: str  # 政府資料開放平臺上的資料集名稱（顯名用）
    gov_id: int  # 政府資料開放平臺的資料集編號
    outlets: tuple[str, ...]  # 依序抓；同一天兩個出口都有時，排後面的那份覆蓋前面的
    min_rows: int  # 合理的最少列數：少於此數多半是錯誤頁或還沒產生完
    date_key: str | None  # 列裡的日期欄；None＝內容沒有日期，日期取自 CSV 的下載檔名
    provider: str = _TWSE
    csv_keys: dict[str, str] = field(default_factory=dict)  # CSV 欄名 → OpenAPI 欄名（沒列到的兩邊相同）
    code_key: str | None = None  # 證券代號欄
    must_have: str | None = None  # 一定要出現的代號：缺了代表內容可疑
    keep_codes: str | None = None  # 只留代號完全符合此正規式的列


DATASETS: dict[str, Dataset] = {
    "STOCK_DAY_ALL": Dataset(
        title="盤後資訊 > 個股日成交資訊",
        gov_id=11549,
        outlets=(
            f"{_TWSE_SITE}/exchangeReport/STOCK_DAY_ALL?response=open_data",
            f"{OPENAPI_BASE}/exchangeReport/STOCK_DAY_ALL",
        ),
        min_rows=500,
        date_key="Date",
        csv_keys={
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
        code_key="Code",
        must_have="2330",
    ),
    "MI_INDEX": Dataset(
        title="盤後資訊 > 每日收盤行情-大盤統計資訊",
        gov_id=11555,
        outlets=(
            f"{_TWSE_SITE}/exchangeReport/MI_INDEX?response=open_data",
            f"{OPENAPI_BASE}/exchangeReport/MI_INDEX",
        ),
        min_rows=50,
        date_key="日期",
        csv_keys={"指數/報酬指數": "指數", "漲跌(+/-)": "漲跌", "漲跌百分比(%)": "漲跌百分比"},
    ),
    "BWIBBU_ALL": Dataset(
        title="盤後資訊 > 個股日本益比、殖利率及股價淨值比（依代碼查詢）",
        gov_id=11547,
        outlets=(
            f"{_TWSE_SITE}/exchangeReport/BWIBBU_ALL?response=open_data",
            f"{OPENAPI_BASE}/exchangeReport/BWIBBU_ALL",
        ),
        min_rows=500,
        date_key="Date",
        csv_keys={
            "日期": "Date",
            "股票代號": "Code",
            "股票名稱": "Name",
            "本益比": "PEratio",
            "殖利率(%)": "DividendYield",
            "股價淨值比": "PBratio",
        },
        code_key="Code",
        must_have="2330",
    ),
    "MI_MARGN": Dataset(
        title="融資融券與可借券賣出額度 > 融資融券餘額",
        gov_id=11680,
        outlets=(f"{_TWSE_SITE}/exchangeReport/MI_MARGN?response=open_data&selectType=ALL",),
        min_rows=500,
        date_key=None,
        code_key="股票代號",
        must_have="2330",
    ),
    "MI_QFIIS_cat": Dataset(
        title="三大法人 > 外資及陸資投資類股持股比率表",
        gov_id=11655,
        outlets=(f"{_TWSE_SITE}/fund/MI_QFIIS_cat?response=open_data",),
        min_rows=20,
        date_key=None,
        csv_keys={
            "產業別": "IndustryCat",
            "家數": "Numbers",
            "總發行股數": "ShareNumber",
            "僑外資及陸資持有總股數": "ForeignMainlandAreaShare",
            "僑外資及陸資持股比率": "Percentage",
        },
    ),
    "MI_QFIIS_sort_20": Dataset(
        title="三大法人 > 外資及陸資持股前 20 名彙總表",
        gov_id=11656,
        outlets=(f"{_TWSE_SITE}/fund/MI_QFIIS_sort_20?response=open_data",),
        min_rows=20,
        date_key=None,
        csv_keys={
            "排行": "Rank",
            "證券代號": "Code",
            "證券名稱": "Name",
            "發行股數": "ShareNumber",
            "外資及陸資尚可投資股數": "AvailableShare",
            "全體外資及陸資持有股數": "SharesHeld",
            "全體外資及陸資尚可投資比率": "AvailableInvestPer",
            "全體外資及陸資持股比率": "SharesHeldPer",
            "法令投資上限比率": "Upperlimit",
        },
        code_key="Code",
    ),
    "t187ap05_L": Dataset(
        title="上市公司每月營業收入彙總表",
        gov_id=18420,
        outlets=(
            "https://mopsfin.twse.com.tw/opendata/t187ap05_L.csv",
            f"{OPENAPI_BASE}/opendata/t187ap05_L",
        ),
        min_rows=500,
        date_key="出表日期",
        code_key="公司代號",
        must_have="2330",
    ),
    "TDCC_OD_1-5": Dataset(
        title="集保戶股權分散表",
        gov_id=11452,
        provider=_TDCC,
        outlets=("https://opendata.tdcc.com.tw/getOD.ashx?id=1-5",),
        min_rows=10_000,
        date_key="資料日期",
        code_key="證券代號",
        must_have="2330",
        keep_codes=r"\d{4}",  # 4 碼的股票與 ETF；權證、債券、受益憑證等約占三成，不收
    ),
}
REQUIRED_DATASETS = ("STOCK_DAY_ALL",)

LICENSE_NAME = "政府資料開放授權條款第1版"
LICENSE_URL = "https://data.gov.tw/license"

_USER_AGENT = "Mozilla/5.0 (compatible; stock-trend-assistant/1.0; +https://stock.sekinv.com)"
_TIMEOUT_SECONDS = 30
_RETRIES = 3
_FILENAME_DATE = re.compile(r"_(\d{8})\.csv$")


class TwseError(RuntimeError):
    """證交所資料取得失敗或內容不合理。"""


def attribution(dataset: str) -> str:
    """政府資料開放授權條款要求的顯名聲明：提供機關、資料集名稱與授權條款。"""
    spec = DATASETS[dataset]
    return (
        f"資料來源：{spec.provider}（政府資料開放平臺「{spec.title}」資料集）。"
        "此開放資料依政府資料開放授權條款（Open Government Data License）進行公眾釋出，"
        f"使用者於遵守本條款各項規定之前提下，得利用之。政府資料開放授權條款：{LICENSE_URL}"
    )


def roc_to_date(roc: str) -> date:
    """民國日期字串 → 西元日期：'1151002' → 2026-10-02。"""
    roc = roc.strip()
    if not roc.isdigit() or len(roc) < 6:
        raise TwseError(f"無法解析的民國日期：{roc!r}")
    return date(int(roc[:-4]) + 1911, int(roc[-4:-2]), int(roc[-2:]))


def parse_day(text: str) -> date:
    """資料裡的日期 → 西元日期：民國 '1151002'、西元 '20261002' 都接受（民國年不會有 8 碼）。"""
    text = text.strip()
    if text.isdigit() and len(text) == 8:
        return date(int(text[:4]), int(text[4:6]), int(text[6:]))
    return roc_to_date(text)


def filename_day(filename: str | None) -> date | None:
    """平臺 CSV 的下載檔名帶資料日：'MI_MARGN_ALL_20261005.csv' → 2026-10-05；沒有或不合理就是 None。"""
    match = _FILENAME_DATE.search(filename or "")
    if not match:
        return None
    try:
        return parse_day(match.group(1))
    except ValueError:
        return None


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


def _get(url: str) -> tuple[bytes, str | None]:
    """下載，回傳（內容, 下載檔名）；檔名取自 Content-Disposition，沒有就是 None。"""
    last_error: Exception | None = None
    for attempt in range(1, _RETRIES + 1):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": _USER_AGENT})
            with urllib.request.urlopen(request, timeout=_TIMEOUT_SECONDS) as response:
                return response.read(), response.headers.get_filename()
        except Exception as exc:  # 連線重設、逾時、HTTP 錯誤都重試
            last_error = exc
            if attempt < _RETRIES:
                time.sleep(5 * attempt)
    raise TwseError(f"下載失敗：{url}（{last_error}）")


def rows_from_csv(text: str, dataset: str = "STOCK_DAY_ALL") -> list[dict[str, str]]:
    """開放資料 CSV → 與 OpenAPI 相同鍵名的列（值保留原字串，只去掉前後空白）。"""
    names = DATASETS[dataset].csv_keys
    reader = csv.DictReader(io.StringIO(text.lstrip("\ufeff")))
    rows = []
    for raw in reader:
        # 欄數比表頭多的列，DictReader 會把多出來的值放在 None 鍵底下——略過
        rows.append({names.get(k.strip(), k.strip()): (v or "").strip() for k, v in raw.items() if k is not None})
    return rows


def _parse(dataset: str, url: str, body: bytes) -> list[dict[str, str]]:
    """出口的原始內容 → 列：OpenAPI 是 JSON，其餘是平臺登錄的 CSV；有代號篩選的資料集只留符合的列。"""
    if url.startswith(OPENAPI_BASE):
        rows = json.loads(body.decode("utf-8"))
    else:
        rows = rows_from_csv(body.decode("utf-8-sig"), dataset)
    spec = DATASETS[dataset]
    if spec.keep_codes and isinstance(rows, list):
        pattern = re.compile(spec.keep_codes)
        rows = [r for r in rows if isinstance(r, dict) and pattern.fullmatch(str(r.get(spec.code_key, "")))]
    return rows


def validate_rows(
    dataset: str,
    rows: list[dict[str, str]],
    *,
    filename_date: date | None = None,
    today: date | None = None,
) -> date:
    """檢查列數、日期一致且不在未來，回傳資料日期。內容沒有日期的資料集用下載檔名的日期。"""
    spec = DATASETS[dataset]
    if not isinstance(rows, list) or not all(isinstance(r, dict) for r in rows):
        raise TwseError(f"{dataset} 的內容不是資料列（可能是錯誤頁）")
    if len(rows) < spec.min_rows:
        raise TwseError(f"{dataset} 只有 {len(rows)} 列（至少應有 {spec.min_rows} 列）")
    if spec.date_key is None:
        if filename_date is None:
            raise TwseError(f"{dataset} 的內容沒有日期，下載檔名也沒有，判定不了是哪一天的資料")
        day = filename_date
    else:
        dates = {r.get(spec.date_key, "") for r in rows}
        if len(dates) != 1:
            raise TwseError(f"{dataset} 混有多個日期：{sorted(dates)[:5]}")
        day = parse_day(dates.pop())
    if spec.must_have and not any(r.get(spec.code_key) == spec.must_have for r in rows):
        raise TwseError(f"{dataset} 缺少 {spec.must_have}，內容可疑")
    if day > (today or datetime.now(_TAIPEI).date()):
        raise TwseError(f"{dataset} 的資料日 {day} 在未來，內容可疑")
    return day


def fetch_available(
    dataset: str, *, outlet_errors: list[str] | None = None
) -> list[tuple[date, list[dict[str, str]], str]]:
    """每個出口各抓一次，回傳目前拿得到的資料日：[(日期, 列, 實際來源網址), ...]，由舊到新。

    兩邊日期不同（通常是 CSV 已換成今日、OpenAPI 還是前一個交易日）就各回一份；
    同一天則只回排在後面的出口（OpenAPI）那份。其中一邊失敗不影響另一邊，全部失敗才丟 TwseError；
    各出口失敗的原因會加進 outlet_errors（有給的話），讓呼叫端在只剩一邊時可以示警。
    """
    found: dict[date, tuple[date, list[dict[str, str]], str]] = {}
    errors: list[str] = outlet_errors if outlet_errors is not None else []
    for url in DATASETS[dataset].outlets:
        try:
            body, filename = _get(url)
            rows = _parse(dataset, url, body)
            day = validate_rows(dataset, rows, filename_date=filename_day(filename))
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
    """寫入當期檔；已存在則不覆寫（官方資料只收一次，之後不動）並回傳 None。"""
    path = file_for(data_dir, dataset, day)
    if path.exists():
        return None
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "dataset": dataset,
            "date": day.isoformat(),
            "source_url": source_url,
            "dataset_url": f"https://data.gov.tw/dataset/{DATASETS[dataset].gov_id}",
            "fetched_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            "license": LICENSE_NAME,
            "license_url": LICENSE_URL,
            "attribution": attribution(dataset),
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
    prefix = "::warning title=證交所資料::" if os.environ.get("GITHUB_ACTIONS") == "true" else "警告："
    for dataset in args.datasets:
        outlet_errors: list[str] = []
        try:
            available = fetch_available(dataset, outlet_errors=outlet_errors)
        except TwseError as exc:
            summary[dataset] = {"error": str(exc)}
            if dataset in REQUIRED_DATASETS:
                failed_required = True
            else:  # K 線以外的資料集抓不到不算排程失敗，但要看得到
                print(f"{prefix}{dataset} 這次抓不到（下次排程再試）——{' '.join(str(exc).split())}", file=sys.stderr)
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
        for problem in outlet_errors:
            print(f"{prefix}{dataset} 有一個出口抓不到——{' '.join(problem.split())}", file=sys.stderr)
    print(json.dumps(summary, ensure_ascii=False))
    return 1 if failed_required else 0


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="python -m stockta.data.twse", description=__doc__.splitlines()[0])
    sub = parser.add_subparsers(dest="command", required=True)
    fetch_parser = sub.add_parser("fetch", help="抓各出口目前提供的資料日並存檔（已存在則略過）")
    fetch_parser.add_argument("--out", required=True, help="資料目錄（twse-data 分支的工作目錄）")
    fetch_parser.add_argument("--datasets", nargs="+", default=list(DATASETS), choices=list(DATASETS))
    args = parser.parse_args(argv)
    if args.command == "fetch":
        return _cmd_fetch(args)
    return 2


if __name__ == "__main__":
    sys.exit(main())
