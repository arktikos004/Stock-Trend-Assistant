"""預測存證的雜湊鏈：讓第三方能用公開資料自行驗證「預測紀錄沒有被回改」。

CLI（只用 Python 標準函式庫：這個檔案可以單獨下載執行，不必安裝本專案）：
    python -m stockta.ledger append --db predictions.db --chain chain.jsonl   # 把新寫入的資料列上鏈
    python -m stockta.ledger verify --db predictions.db --chain chain.jsonl   # 用公開資料逐節重算比對

**要解決的問題**：predictions.db 隨 state 分支每天公開，但 state 是每次強制覆寫的單一 commit，
外人無法確認舊的資料列沒被改過。鏈檔放在只用一般 commit、從不強制推送的 ledger 分支，
GitHub 上的 commit 時間就是公開的時間戳：某一節出現之後，它涵蓋的資料列只要改了任何一個位元，驗證就會失敗。

**單位是資料列 id 區間，不是交易日**：排程有自癒補寫機制，同一個基準日的資料列可能分幾次寫入；
兩張表的 id 都是 AUTOINCREMENT（用過的 id 不會再發），「上一節記到的 id 之後新增的列」才是穩定的單位。
程式裡沒有任何 UPDATE 或 DELETE（實際走勢是產生報告時另外算的，不寫回這兩張表），所以整列內容都進雜湊。
id 本來就有空號（重複寫入被 INSERT OR IGNORE 忽略時，SQLite 也會用掉一個 id）：只雜湊實際存在的列，
之後若有列被塞進空號，該節的列數與雜湊都會對不上。

**正規化**（寫死；改了就是另一條鏈）：
- 表依 predictions、rank_predictions 的順序，表內依 id 遞增；每列一行 JSON 陣列：表名＋下方 TABLES 的固定欄位順序，
  UTF-8、不轉義非 ASCII 字元、分隔符無空白（","、":"），行尾 "\\n"
- 浮點數（confidence、score）寫成 IEEE-754 binary64 大端序的 16 位十六進位：與語言、版本無關，逐位元精確
- 鏈節的 hash＝鏈節去掉 hash 欄位後，以 sort_keys、同樣分隔符序列化的 SHA-256；prev_hash 串起前一節，第一節為 64 個 0

**回補要誠實**：第一節涵蓋上鏈之前就已存在的資料列，只能證明它們自第一節的 commit 時間起沒有被修改，
不能證明更早；第一節的 note 欄位寫明這一點。
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sqlite3
import struct
from collections import Counter
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

# 表與欄位的順序是正規化的一部分
TABLES: dict[str, tuple[str, ...]] = {
    "predictions": ("id", "ticker", "base_date", "signal", "confidence", "model_version", "created_at"),
    "rank_predictions": ("id", "ticker", "base_date", "score", "model_version", "source", "created_at"),
}
FLOAT_COLUMNS = frozenset({"confidence", "score"})
GENESIS_PREV = "0" * 64
GENESIS_NOTE = "第一節涵蓋上鏈之前就已存在的資料列：只能證明它們自本節的 commit 時間起沒有被修改，不能證明更早。"
_SEP = (",", ":")


class LedgerError(RuntimeError):
    """現有的鏈與資料庫對不上：不得在上面追加新節，否則等於替被改過的資料背書。"""


@dataclass
class Report:
    entries: int
    chained: dict[str, int]  # 各表已上鏈的列數
    pending: dict[str, int]  # 最後一節之後才新增、尚未上鏈的列數（不是錯誤）
    problems: list[str]


def float_hex(value: float) -> str:
    """IEEE-754 binary64、大端序的十六進位，例：0.5 → 3fe0000000000000。"""
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise TypeError(f"浮點欄位不是數值：{value!r}")
    return struct.pack(">d", float(value)).hex()


def canonical_row(table: str, row: tuple) -> bytes:
    """一列資料的正規化位元組（含行尾 \\n）。型別不符就拒絕，不猜。"""
    values: list = [table]
    for column, value in zip(TABLES[table], row, strict=True):
        if column in FLOAT_COLUMNS:
            values.append(float_hex(value))
        elif column == "id":
            if isinstance(value, bool) or not isinstance(value, int):
                raise TypeError(f"{table}.id 不是整數：{value!r}")
            values.append(value)
        else:
            if not isinstance(value, str):
                raise TypeError(f"{table}.{column} 不是字串：{value!r}")
            values.append(value)
    return (json.dumps(values, ensure_ascii=False, separators=_SEP) + "\n").encode("utf-8")


def entry_hash(entry: dict) -> str:
    body = {k: v for k, v in entry.items() if k != "hash"}
    return hashlib.sha256(json.dumps(body, ensure_ascii=False, sort_keys=True, separators=_SEP).encode("utf-8")).hexdigest()


def read_chain(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def _connect(db_path: Path) -> sqlite3.Connection:
    return sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)


def _has_table(conn: sqlite3.Connection, table: str) -> bool:
    return conn.execute("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", (table,)).fetchone() is not None


def _max_id(conn: sqlite3.Connection, table: str) -> int:
    if not _has_table(conn, table):
        return 0
    return conn.execute(f"SELECT COALESCE(MAX(id), 0) FROM {table}").fetchone()[0]


def _count_after(conn: sqlite3.Connection, table: str, after_id: int) -> int:
    if not _has_table(conn, table):
        return 0
    return conn.execute(f"SELECT COUNT(*) FROM {table} WHERE id > ?", (after_id,)).fetchone()[0]


def digest_ranges(conn: sqlite3.Connection, spans: dict[str, tuple[int, int]]) -> tuple[str, dict[str, dict]]:
    """各表 id 在 (after_id, to_id] 的資料列：回傳 (正規化內容的 SHA-256, 各表的區間與計數)。"""
    digest = hashlib.sha256()
    summary: dict[str, dict] = {}
    for table, columns in TABLES.items():
        after_id, to_id = spans[table]
        rows = []
        if _has_table(conn, table):
            rows = conn.execute(
                f"SELECT {', '.join(columns)} FROM {table} WHERE id > ? AND id <= ? ORDER BY id", (after_id, to_id)
            ).fetchall()
        for row in rows:
            digest.update(canonical_row(table, row))
        info: dict = {"after_id": after_id, "to_id": to_id, "rows": len(rows)}
        if "source" in columns:
            # live＝當日收盤後即時記錄；pit＝事後以固定權重重建的歷史基準日。兩者分開計數
            at = columns.index("source")
            info["sources"] = dict(sorted(Counter(row[at] for row in rows).items()))
        summary[table] = info
    return digest.hexdigest(), summary


def verify(db_path: Path, chain: list[dict]) -> Report:
    """以資料庫逐節重算：串接、鏈節 hash、id 區間的連續性、列數與來源計數、資料列雜湊。"""
    problems: list[str] = []
    prev = GENESIS_PREV
    after = {table: 0 for table in TABLES}
    chained = {table: 0 for table in TABLES}
    conn = _connect(db_path)
    try:
        for i, entry in enumerate(chain):
            label = f"第 {i} 節"
            if entry.get("seq") != i:
                problems.append(f"{label}：seq 應為 {i}，實為 {entry.get('seq')!r}")
            if entry.get("prev_hash") != prev:
                problems.append(f"{label}：prev_hash 與前一節的 hash 不符（鏈節被刪除、調換或改寫）")
            if entry_hash(entry) != entry.get("hash"):
                problems.append(f"{label}：hash 與鏈節內容不符（鏈節被改過）")
            ranges = entry.get("ranges") or {}
            spans: dict[str, tuple[int, int]] = {}
            for table in TABLES:
                span = ranges.get(table) or {}
                if span.get("after_id") != after[table]:
                    problems.append(f"{label}：{table} 應接在 id {after[table]} 之後，實為 {span.get('after_id')!r}")
                to_id = span.get("to_id")
                if isinstance(to_id, bool) or not isinstance(to_id, int) or to_id < after[table]:
                    problems.append(f"{label}：{table} 的 to_id 無效：{to_id!r}")
                    to_id = after[table]
                spans[table] = (after[table], to_id)
            digest, summary = digest_ranges(conn, spans)
            for table in TABLES:
                if summary[table] != ranges.get(table):
                    problems.append(f"{label}：{table} 的區間或計數不符（鏈上 {ranges.get(table)}，資料庫 {summary[table]}）")
            if digest != entry.get("rows_sha256"):
                problems.append(f"{label}：資料列的雜湊不符（區間內有資料列被修改、刪除或插入）")
            prev = entry.get("hash")
            for table in TABLES:
                after[table] = spans[table][1]
                chained[table] += summary[table]["rows"]
        pending = {table: _count_after(conn, table, after[table]) for table in TABLES}
    finally:
        conn.close()
    return Report(entries=len(chain), chained=chained, pending=pending, problems=problems)


def append(db_path: Path, chain_path: Path, now: datetime | None = None, run_id: str | None = None) -> dict | None:
    """先驗證現有的鏈，再把最後一節之後新增的資料列串成新的一節；沒有新的列就不新增（回傳 None）。"""
    chain = read_chain(chain_path)
    report = verify(db_path, chain)
    if report.problems:
        raise LedgerError("現有的鏈與資料庫對不上，拒絕追加：\n" + "\n".join(report.problems))
    last = {table: chain[-1]["ranges"][table]["to_id"] if chain else 0 for table in TABLES}
    conn = _connect(db_path)
    try:
        spans = {table: (last[table], max(last[table], _max_id(conn, table))) for table in TABLES}
        if all(to_id == after_id for after_id, to_id in spans.values()):
            return None
        digest, summary = digest_ranges(conn, spans)
    finally:
        conn.close()

    entry: dict = {
        "seq": len(chain),
        "recorded_at": (now or datetime.now(timezone.utc)).astimezone(timezone.utc).isoformat(timespec="seconds"),
        "ranges": summary,
        "rows_sha256": digest,
        "prev_hash": chain[-1]["hash"] if chain else GENESIS_PREV,
    }
    if run_id:
        entry["run_id"] = run_id
    if not chain:
        entry["note"] = GENESIS_NOTE
    entry["hash"] = entry_hash(entry)

    line = (json.dumps(entry, ensure_ascii=False, separators=_SEP) + "\n").encode("utf-8")
    # 檔案若被手動編輯過、少了最後的行尾，新的一節不能黏在上一行
    if chain_path.is_file() and chain_path.stat().st_size and not chain_path.read_bytes().endswith(b"\n"):
        line = b"\n" + line
    chain_path.parent.mkdir(parents=True, exist_ok=True)
    with chain_path.open("ab") as f:
        f.write(line)
    return entry


def _describe(entry: dict) -> str:
    parts = []
    for table, span in entry["ranges"].items():
        detail = f"{span['rows']} 列"
        if span.get("sources"):
            detail += "：" + "、".join(f"{k} {v}" for k, v in span["sources"].items())
        parts.append(f"{table} id {span['after_id']}→{span['to_id']}（{detail}）")
    return "；".join(parts)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="預測存證的雜湊鏈：上鏈與驗證")
    parser.add_argument("command", choices=["append", "verify"])
    parser.add_argument("--db", type=Path, required=True, help="predictions.db（state 分支公開的那一份）")
    parser.add_argument("--chain", type=Path, required=True, help="鏈檔 chain.jsonl（ledger 分支）")
    parser.add_argument("--run-id", help="append 用：GitHub Actions 的 run id，寫進鏈節供對照")
    args = parser.parse_args(argv)

    if not args.db.is_file():
        parser.error(f"找不到資料庫：{args.db}")

    if args.command == "append":
        try:
            entry = append(args.db, args.chain, run_id=args.run_id)
        except LedgerError as exc:
            print(exc)
            return 1
        if entry is None:
            print("最後一節之後沒有新的資料列，不新增鏈節。")
        else:
            print(f"新增第 {entry['seq']} 節：{_describe(entry)}；hash {entry['hash'][:16]}…")
        return 0

    if not args.chain.is_file():
        parser.error(f"找不到鏈檔：{args.chain}")
    report = verify(args.db, read_chain(args.chain))
    if report.problems:
        print(f"驗證失敗，共 {len(report.problems)} 處：")
        for problem in report.problems:
            print(f"  - {problem}")
        return 1
    chained = "、".join(f"{t} {n} 列" for t, n in report.chained.items())
    pending = "、".join(f"{t} {n} 列" for t, n in report.pending.items())
    print(f"驗證通過：{report.entries} 節，已上鏈 {chained}；最後一節之後新增、尚未上鏈：{pending}。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
