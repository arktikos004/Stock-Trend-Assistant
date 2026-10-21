"""Point-in-time 成分股：回答「在 d 這一天，台灣 50 的成分股是哪 50 檔？」

**要解決的問題**：`config.STOCK_POOL` 是某一天的台灣 50 成分股快照，卻被拿來
訓練與回測 20 年。世芯-KY、緯穎、奇鋐這些近年才入榜的贏家，在 2010 年根本不在
指數裡——用今天的名單回測過去，等於預先知道誰會贏。這是倖存者偏誤的教科書形態。

**作法**：把指數的成分股**變動事件**（何時納入、何時剔除）存成可稽核的事件表，
再重放成任一日期的成分股集合。事件表的每一列都必須帶 `source_url`，
沒有出處的列不准進表——這份資料的價值完全建立在可查證上。

事件表旁邊還有兩個檔（都可省略，合成資料的測試就沒有）：
- `tw50_anchor.csv`：某一天完整的 50 檔名單。從它往回撤銷每一次異動，推出事件表起點的名單，
  不必另外找一份二十年前的完整名單。
- `tw50_reviews.csv`：每一次定期審核一列，沒有異動的季也要列。漏記一整次審核時，
  納入與剔除數相同、規模檢查抓不到，靠這份清單才抓得到。

異動在生效日**收盤後**才生效：生效日當天仍是舊名單，新名單從次日起算。
"""

from __future__ import annotations

import csv
from collections.abc import Collection
from dataclasses import dataclass
from datetime import date, timedelta
from functools import lru_cache
from pathlib import Path

import pandas as pd

from stockta.config import BACKEND_ROOT

UNIVERSE_DIR = BACKEND_ROOT / "data" / "universe"
EVENTS_PATH = UNIVERSE_DIR / "tw50_events.csv"
ANCHOR_NAME = "tw50_anchor.csv"
REVIEWS_NAME = "tw50_reviews.csv"

# 台灣 50 指數固定 50 檔。這不是我們的假設，是指數規則明訂的
# （Ground Rules v3.5 §6.3.5「A constant number of constituents will be maintained」），
# 所以拿它當一致性檢查是站得住腳的：任一時點重放出來若不是 50 檔，就是事件表有缺漏。
INDEX_SIZE = 50

# 定期審核的緩衝區（Ground Rules v3.5 §6.3.2 / §6.3.3）：
#   納入——市值排名「升到第 40 名或以上」
#   剔除——市值排名「掉到第 61 名或以下」
#
# **這兩個數字是本模組存在的理由。** 因為納入與剔除的門檻不同，排名 41~60 之間
# 是一段緩衝帶：同樣排在第 50 名，原本在裡面的留著、原本在外面的進不來。
# 也就是說**成分資格取決於前一期的狀態**，不是當期市值的函數。
#
# 直接後果：**不能靠「把當時的市值排序取前 50 名」來重建歷史成分股**——
# 那會在緩衝帶裡系統性地猜錯。要知道 d 當天誰在裡面，只能從某個已知狀態
# 逐次套用每一次審核的異動，也就是本模組做的事。
REVIEW_INSERT_RANK = 40
REVIEW_DELETE_RANK = 61

ADD = "add"
DROP = "drop"
SCHEDULED = "定期審核"
AD_HOC = "臨時調整"


class UniverseError(RuntimeError):
    """成分股事件表不自洽（順序矛盾、規模不符等）。"""


@dataclass(frozen=True)
class MembershipEvent:
    effective_date: date
    ticker: str
    action: str  # add | drop
    review: str  # 定期審核 | 臨時調整
    source_url: str
    name: str = ""  # 公司名稱，讓事件表用肉眼就能核對
    note: str = ""  # 備註：公告日、疑義、資料來源的細節

    @property
    def label(self) -> str:
        return f"{self.name}({self.ticker})" if self.name else self.ticker


@dataclass(frozen=True)
class Anchor:
    """某一天完整的成分股名單（as_of 當天收盤時）。"""

    as_of: date
    members: frozenset[str]


@dataclass(frozen=True)
class Review:
    """一次定期審核：生效日與異動檔數（納入數＝剔除數，可以是 0）。"""

    effective_date: date
    n_changes: int
    source_url: str
    note: str = ""


def _rows(path: Path) -> list[tuple[int, dict]]:
    with open(path, encoding="utf-8-sig", newline="") as handle:
        return [(line_no, row) for line_no, row in enumerate(csv.DictReader(handle), start=2) if any((v or "").strip() for v in row.values())]


def _require_source(path: Path, line_no: int, row: dict) -> str:
    source = (row.get("source_url") or "").strip()
    if not source:
        raise UniverseError(
            f"{path}:{line_no} 缺 source_url。沒有出處的列不准進表——"
            "這份資料的價值完全建立在可查證上。"
        )
    return source


def load_events(path: Path = EVENTS_PATH) -> list[MembershipEvent]:
    """讀取事件表，依生效日排序。缺檔時拋出明確錯誤。"""
    if not path.exists():
        raise FileNotFoundError(
            f"找不到成分股事件表 {path}。\n"
            "PIT universe 需要人工策展的事件表，來源與格式見 data/universe/README.md。"
        )

    events: list[MembershipEvent] = []
    for line_no, row in _rows(path):
        if not (row.get("ticker") or "").strip():
            continue  # 允許空行
        action = (row["action"] or "").strip().lower()
        if action not in (ADD, DROP):
            raise UniverseError(f"{path}:{line_no} action 必須是 add 或 drop，收到 {action!r}")
        events.append(
            MembershipEvent(
                effective_date=date.fromisoformat(row["effective_date"].strip()),
                ticker=row["ticker"].strip(),
                action=action,
                review=(row.get("review") or "").strip(),
                source_url=_require_source(path, line_no, row),
                name=(row.get("name") or "").strip(),
                note=(row.get("note") or "").strip(),
            )
        )

    events.sort(key=lambda e: (e.effective_date, e.ticker, e.action))
    return events


def load_anchor(path: Path = EVENTS_PATH) -> Anchor | None:
    """事件表旁的錨點名單（tw50_anchor.csv）；沒有這個檔時回 None。"""
    anchor_path = path.with_name(ANCHOR_NAME)
    if not anchor_path.exists():
        return None
    days: set[str] = set()
    tickers: list[str] = []
    for line_no, row in _rows(anchor_path):
        _require_source(anchor_path, line_no, row)
        days.add((row.get("as_of") or "").strip())
        tickers.append(row["ticker"].strip())
    if len(days) != 1:
        raise UniverseError(f"{anchor_path} 的 as_of 必須是同一天，收到 {sorted(days)}")
    if len(set(tickers)) != len(tickers):
        raise UniverseError(f"{anchor_path} 有重複的代號")
    return Anchor(as_of=date.fromisoformat(days.pop()), members=frozenset(tickers))


def load_reviews(path: Path = EVENTS_PATH) -> list[Review]:
    """事件表旁的定期審核清單（tw50_reviews.csv），依生效日排序；沒有這個檔時回空清單。"""
    reviews_path = path.with_name(REVIEWS_NAME)
    if not reviews_path.exists():
        return []
    reviews = [
        Review(
            effective_date=date.fromisoformat(row["effective_date"].strip()),
            n_changes=int(row["n_changes"]),
            source_url=_require_source(reviews_path, line_no, row),
            note=(row.get("note") or "").strip(),
        )
        for line_no, row in _rows(reviews_path)
    ]
    return sorted(reviews, key=lambda r: r.effective_date)


def _group_by_date(events: list[MembershipEvent]):
    """同一生效日的事件必須一起套用（同時有納入與剔除，中途規模不會是 50）。"""
    current_date: date | None = None
    bucket: list[MembershipEvent] = []
    for event in events:
        if event.effective_date != current_date:
            if bucket:
                yield current_date, bucket
            current_date, bucket = event.effective_date, []
        bucket.append(event)
    if bucket:
        yield current_date, bucket


def _apply(members: set[str], effective_date: date, group: list[MembershipEvent]) -> None:
    for event in group:
        if event.action == ADD:
            if event.ticker in members:
                raise UniverseError(f"{effective_date} {event.ticker} 已在成分股內卻又被納入——事件表重複")
            members.add(event.ticker)
        else:
            if event.ticker not in members:
                raise UniverseError(
                    f"{effective_date} {event.ticker} 不在成分股內卻被剔除——"
                    "事件表順序矛盾（可能漏了更早的納入事件）"
                )
            members.discard(event.ticker)


def _seed_from_anchor(events: list[MembershipEvent], anchor: Anchor) -> frozenset[str]:
    """從錨點名單往回推：把錨點日之前的異動由新到舊逐次撤銷，得到事件表第一筆異動之前的名單。"""
    members = set(anchor.members)
    earlier = [e for e in events if e.effective_date < anchor.as_of]
    for effective_date, group in reversed(list(_group_by_date(earlier))):
        for event in group:
            if event.action == ADD:
                if event.ticker not in members:
                    raise UniverseError(
                        f"{effective_date} 納入 {event.label}，但從 {anchor.as_of} 的名單往回推時它不在名單內——事件表與錨點矛盾"
                    )
                members.discard(event.ticker)
            else:
                if event.ticker in members:
                    raise UniverseError(
                        f"{effective_date} 剔除 {event.label}，但從 {anchor.as_of} 的名單往回推時它已在名單內——事件表與錨點矛盾"
                    )
                members.add(event.ticker)
    return frozenset(members)


@lru_cache(maxsize=8)
def _timeline(path: Path = EVENTS_PATH) -> tuple[tuple[date, frozenset[str]], ...]:
    """[(起始日, 該日起的成分股集合)]，依日期遞增。新名單從生效日的次日起算（收盤後生效）。

    有錨點時，第一段是往回推出的起點名單，從涵蓋起日開始：第一次列出的定期審核，
    沒有審核清單時為第一筆異動的生效日。沒有錨點時從空集合往前重放（合成資料用）。
    """
    events = load_events(path)
    anchor = load_anchor(path)
    timeline: list[tuple[date, frozenset[str]]] = []
    members: set[str] = set()
    if anchor is not None:
        members = set(_seed_from_anchor(events, anchor))
        reviews = load_reviews(path)
        start = reviews[0].effective_date if reviews else (events[0].effective_date if events else anchor.as_of)
        timeline.append((start, frozenset(members)))
    for effective_date, group in _group_by_date(events):
        _apply(members, effective_date, group)
        timeline.append((effective_date + timedelta(days=1), frozenset(members)))
    return tuple(timeline)


def coverage_start(path: Path = EVENTS_PATH) -> date | None:
    """事件表能回答問題的最早日期。

    有錨點時是涵蓋起日；沒有錨點時是第一次湊滿 INDEX_SIZE 檔的那一段的起始日。
    在此之前重放出來的集合不完整，不該拿去做 PIT 回測——回傳 None 表示從未湊滿。
    """
    timeline = _timeline(path)
    if load_anchor(path) is not None:
        return timeline[0][0] if timeline else None
    for valid_from, members in timeline:
        if len(members) == INDEX_SIZE:
            return valid_from
    return None


def members_asof(when: date, path: Path = EVENTS_PATH) -> set[str]:
    """when 當天的成分股集合（生效日當天仍是舊名單）。早於涵蓋起日時拋出 UniverseError。"""
    start = coverage_start(path)
    if start is None or when < start:
        raise UniverseError(f"{when} 早於事件表能回答的最早日期（{start}）——在那之前的成分股不完整")
    result: frozenset[str] = frozenset()
    for valid_from, members in _timeline(path):
        if valid_from > when:
            break
        result = members
    return set(result)


def third_friday(year: int, month: int) -> date:
    """該月的第三個星期五。"""
    first = date(year, month, 1)
    # weekday(): Mon=0 … Fri=4
    first_friday = 1 + (4 - first.weekday()) % 7
    return date(year, month, first_friday + 14)


def review_effective_date(year: int, month: int, sessions: Collection[date] | None = None) -> date:
    """定期審核的生效日：當月第三個星期五；那天休市時提前到前一個交易日（例：2026-06-19 端午節，改 6/18）。

    sessions 是實際交易日；沒有給（或不涵蓋那段期間）時只能假設第三個星期五有開市。
    """
    friday = third_friday(year, month)
    if not sessions or friday in sessions:
        return friday
    earlier = [d for d in sessions if d < friday]
    return max(earlier) if earlier else friday


def last_review_effective(on: date) -> date:
    """on（含）之前最近一次定期審核的生效日。

    台灣 50 指數每年 3/6/9/12 月定期審核，於該月**第三個星期五收盤後**生效
    （FTSE 公告用語："after the close of business on Friday, 20 March 2026,
    i.e. on Monday, 23 March 2026"）。

    這個函式的用途是**讓過期的股票池藏不住**：成分股每季會變，把名單寫死在
    config 裡的那一刻起它就開始腐壞，而腐壞不會有任何錯誤訊息。
    """
    candidates = [
        third_friday(year, month)
        for year in (on.year, on.year - 1)
        for month in (3, 6, 9, 12)
    ]
    return max(d for d in candidates if d <= on)


def pool_staleness(as_of: date, today: date | None = None) -> tuple[int, date]:
    """股票池自 as_of 之後錯過了幾次定期審核。回傳 (錯過次數, 最近一次生效日)。"""
    today = today or date.today()
    missed = 0
    cursor = last_review_effective(today)
    latest = cursor
    while cursor > as_of:
        missed += 1
        cursor = last_review_effective(cursor - timedelta(days=1))
    return missed, latest


def all_tickers_ever(path: Path = EVENTS_PATH) -> set[str]:
    """曾經在指數內出現過的所有代號——含已下市與被併購者。

    這是抓價格資料時該用的清單：只抓現存成分股，倖存者偏誤就從資料源頭進來了。
    有錨點時也包含錨點名單（往回推出的起點名單只由它與事件組成）。
    """
    anchor = load_anchor(path)
    return {event.ticker for event in load_events(path)} | (set(anchor.members) if anchor else set())


def membership_frame(dates, path: Path = EVENTS_PATH) -> pd.DataFrame:
    """逐日成分股寬表（index=日期、columns=代號、值為 bool）。

    features/market.py 算市場寬度、ml/cross_sectional.py 取當日中位數時使用——
    兩者目前都用今天的股票池計算整段歷史，那本身就是被污染的特徵。
    """
    index = pd.DatetimeIndex(dates)
    tickers = sorted(all_tickers_ever(path))
    rows = [
        [ticker in members_asof(stamp.date(), path) for ticker in tickers] for stamp in index
    ]
    return pd.DataFrame(rows, index=index, columns=tickers, dtype=bool)


def _market_sessions() -> list[date]:
    """實際交易日（本機 ^TWII 快取）；沒有快取時回空清單。"""
    from stockta.config import DATA_CACHE_DIR
    from stockta.data.cache import ParquetCache
    from stockta.data.calendar import market_sessions

    return market_sessions(ParquetCache(DATA_CACHE_DIR))


def _next_quarter(day: date) -> tuple[int, int]:
    month = day.month + 3
    return (day.year + (month - 1) // 12, (month - 1) % 12 + 1)


def _check_reviews(events: list[MembershipEvent], reviews: list[Review], anchor: Anchor | None) -> list[str]:
    """審核清單：每季一次、不跳季，每次的納入數與剔除數都等於清單寫的檔數。"""
    problems: list[str] = []
    for review in reviews:
        if review.effective_date.month not in (3, 6, 9, 12):
            problems.append(f"{review.effective_date}：定期審核只在 3、6、9、12 月")
    for prev, cur in zip(reviews, reviews[1:], strict=False):
        expected = _next_quarter(prev.effective_date)
        if (cur.effective_date.year, cur.effective_date.month) != expected:
            problems.append(
                f"{prev.effective_date} 之後的下一次定期審核應在 {expected[0]}-{expected[1]:02d}，"
                f"清單接著是 {cur.effective_date}——漏列了審核"
            )
    if anchor is not None and reviews:
        latest = last_review_effective(anchor.as_of)
        if (reviews[-1].effective_date.year, reviews[-1].effective_date.month) != (latest.year, latest.month):
            problems.append(f"審核清單只到 {reviews[-1].effective_date}，錨點（{anchor.as_of}）之前最近一次審核在 {latest:%Y-%m}")

    by_date: dict[date, list[MembershipEvent]] = {}
    for event in events:
        if event.review == SCHEDULED:
            by_date.setdefault(event.effective_date, []).append(event)
    listed = {review.effective_date for review in reviews}
    for day in sorted(set(by_date) - listed):
        problems.append(f"{day}：事件表有定期審核的異動，審核清單卻沒有列這一次")
    for review in reviews:
        group = by_date.get(review.effective_date, [])
        adds = sum(e.action == ADD for e in group)
        if adds != review.n_changes or len(group) - adds != review.n_changes:
            problems.append(
                f"{review.effective_date}：審核清單寫 {review.n_changes} 檔異動，"
                f"事件表是納入 {adds}、剔除 {len(group) - adds}"
            )
    return problems


def validate(path: Path = EVENTS_PATH, sessions: Collection[date] | None = None) -> list[str]:
    """檢查事件表自洽性，回傳問題描述（空 list = 通過）。

    最強的一條是規模檢查：台灣 50 永遠是 50 檔，重放後不是 50 檔就是事件表有缺漏。
    沒有錨點時刻意允許事件表起點之前的「暖身期」（成分股還沒湊滿），只檢查湊滿之後。
    sessions 是實際交易日，省略時讀本機 ^TWII 快取（沒有快取就只用第三個星期五的規則）。
    """
    problems: list[str] = []

    # 先做便宜的逐列檢查，再做需要完整重放的檢查。順序相反的話，重放一旦因為
    # 資料不全而中斷，後面所有問題就都看不到了——一次只能修一個問題最令人洩氣。
    try:
        events = load_events(path)
        anchor = load_anchor(path)
        reviews = load_reviews(path)
    except (UniverseError, FileNotFoundError) as exc:
        return [str(exc)]

    days = set(_market_sessions() if sessions is None else sessions)
    span = (min(days), max(days)) if days else None

    def covered(day: date) -> bool:
        return span is not None and span[0] <= day <= span[1]

    # 定期審核的生效日必是第三個星期五（休市則前一個交易日）；臨時調整必落在交易日。
    # 對不上就是抄錯了——財經報導把生效日寫差一天是常見的錯，靠肉眼看不出來。
    seen_dates: set[date] = set()
    for event in events:
        day = event.effective_date
        if day in seen_dates:
            continue
        seen_dates.add(day)
        if event.review == SCHEDULED:
            friday = third_friday(day.year, day.month)
            expected = review_effective_date(day.year, day.month, days if covered(friday) else None)
            if day != expected:
                problems.append(
                    f"{day}：定期審核的生效日應為當月第三個星期五，遇休市提前到前一個交易日"
                    f"（{expected}），對不上——請回查原始公告"
                )
        elif event.review == AD_HOC and covered(day) and day not in days:
            problems.append(f"{day}：臨時調整的生效日不是交易日——請回查原始公告")

    if reviews:
        problems += _check_reviews(events, reviews, anchor)

    try:
        timeline = _timeline(path)
    except UniverseError as exc:
        return [*problems, str(exc)]

    if not timeline:
        return [*problems, "事件表是空的"]

    if anchor is not None:
        if len(anchor.members) != INDEX_SIZE:
            problems.append(f"錨點名單 {len(anchor.members)} 檔，應為 {INDEX_SIZE} 檔")
        start = timeline[0][0]
        early = sorted({e.effective_date for e in events if e.effective_date < start})
        if early:
            problems.append(f"{early[0]} 起有 {len(early)} 天的異動早於涵蓋起日 {start}——先把那幾次定期審核列進 {REVIEWS_NAME}")
        for valid_from, members in timeline:
            if len(members) != INDEX_SIZE:
                problems.append(f"{valid_from} 起：成分股 {len(members)} 檔，應為 {INDEX_SIZE} 檔")
        return problems

    started = False
    for valid_from, members in timeline:
        if len(members) == INDEX_SIZE:
            started = True
        elif started:
            problems.append(
                f"{valid_from} 起：成分股 {len(members)} 檔，應為 {INDEX_SIZE} 檔"
                f"（{'少' if len(members) < INDEX_SIZE else '多'}"
                f" {abs(len(members) - INDEX_SIZE)} 檔）"
            )

    if not started:
        problems.append(
            f"事件表從未湊滿 {INDEX_SIZE} 檔（最多 "
            f"{max(len(m) for _, m in timeline)} 檔）——起始成分股名單可能不完整"
        )
    return problems


def main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="PIT 成分股事件表")
    parser.add_argument("command", choices=["validate", "asof", "coverage"])
    parser.add_argument("--date", help="asof 查詢日期（YYYY-MM-DD）")
    args = parser.parse_args()

    if args.command == "validate":
        problems = validate()
        if not problems:
            events = load_events()
            start = coverage_start()
            print(
                f"事件表自洽：{len(events)} 個事件、"
                f"涵蓋 {len(all_tickers_ever())} 個曾入榜代號、"
                f"可回答日期起自 {start}"
            )
            return
        print(f"發現 {len(problems)} 個問題：")
        for line in problems[:40]:
            print(f"  - {line}")
        raise SystemExit(1)

    if args.command == "coverage":
        print(f"可回答的最早日期：{coverage_start()}")
        print(f"曾入榜代號數：{len(all_tickers_ever())}")
        return

    if not args.date:
        raise SystemExit("asof 需要 --date")
    members = members_asof(date.fromisoformat(args.date))
    print(f"{args.date} 成分股 {len(members)} 檔：")
    print("  " + "、".join(sorted(members)))


if __name__ == "__main__":
    main()
