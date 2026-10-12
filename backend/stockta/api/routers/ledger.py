"""預測存證鏈的狀態快照：GET /api/ledger。

每日排程在上鏈之後、部署之前把它匯出成 ledger.json；網站的存證狀態只讀這一份，不再另外讀 GitHub 上的鏈檔，
所以節數、待上鏈的列與最新一節的時間都來自同一個時間點。
「第幾節」從 1 起算，等於 chain.jsonl 的行數；鏈節本身的 seq 欄位從 0 起算（寫進雜湊，不能改）。
"""

import sqlite3
from datetime import date, datetime, timezone
from pathlib import Path

from fastapi import APIRouter

from stockta import ledger
from stockta.api.schemas import LedgerLinkInfo, LedgerSnapshot
from stockta.config import LEDGER_CHAIN_PATH, PREDICTIONS_DB_PATH

router = APIRouter(tags=["ledger"])


def _base_dates(db_path: Path, last_ids: dict[str, int]) -> tuple[set[str], set[str]]:
    """(已上鏈的列所屬的基準日, 尚未上鏈的列所屬的基準日)。"""
    chained: set[str] = set()
    pending: set[str] = set()
    if not Path(db_path).exists():
        return chained, pending
    conn = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)
    try:
        for table in ledger.TABLES:
            try:
                for bd, is_pending in conn.execute(f"SELECT DISTINCT base_date, id > ? FROM {table}", (last_ids.get(table, 0),)):
                    (pending if is_pending else chained).add(bd)
            except sqlite3.OperationalError:
                continue  # 尚未建表
    finally:
        conn.close()
    return chained, pending


def ledger_snapshot(db_path: Path, chain_path: Path, now: datetime | None = None) -> LedgerSnapshot:
    snapshot_at = (now or datetime.now(timezone.utc)).isoformat(timespec="seconds")
    if not Path(chain_path).exists():
        return LedgerSnapshot(snapshot_at=snapshot_at, available=False)
    chain = ledger.read_chain(Path(chain_path))
    report = ledger.verify(Path(db_path), chain)
    last_ids = {table: ((chain[-1].get("ranges") or {}).get(table) or {}).get("to_id", 0) for table in ledger.TABLES} if chain else {}
    chained_dates, pending_dates = _base_dates(db_path, last_ids)
    # 驗證截至：最早一個還有列沒上鏈的基準日之前（含當天以前的列都已上鏈）
    cutoff = min(pending_dates) if pending_dates else None
    covered = [d for d in chained_dates if cutoff is None or d < cutoff]
    head = None
    if chain:
        last = chain[-1]
        head = LedgerLinkInfo(
            number=len(chain),
            seq=last.get("seq", len(chain) - 1),
            recorded_at=last.get("recorded_at", ""),
            rows={table: ((last.get("ranges") or {}).get(table) or {}).get("rows", 0) for table in ledger.TABLES},
            hash=last.get("hash", ""),
            prev_hash=last.get("prev_hash", ""),
            run_id=last.get("run_id"),
        )
    return LedgerSnapshot(
        snapshot_at=snapshot_at,
        available=True,
        entries=report.entries,
        ok=not report.problems,
        problems=report.problems[:10],
        chained=report.chained,
        pending=report.pending,
        pending_base_dates=sorted(date.fromisoformat(d) for d in pending_dates),
        verified_through=date.fromisoformat(max(covered)) if covered and not report.problems else None,
        head=head,
        first_recorded_at=chain[0].get("recorded_at") if chain else None,
        first_note=chain[0].get("note") if chain else None,
    )


@router.get("/api/ledger", response_model=LedgerSnapshot)
def get_ledger() -> LedgerSnapshot:
    return ledger_snapshot(PREDICTIONS_DB_PATH, LEDGER_CHAIN_PATH)
