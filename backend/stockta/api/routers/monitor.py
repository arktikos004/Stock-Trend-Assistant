"""模型監控與例外報表：GET /api/monitor（規則見 docs/monitor_prereg.md）。

逐日線上 Rank IC 與線上報告共用同一段定義（ml/report_rank_predictions.daily_ic）；
分位遷移直接讀 predictions.db 存證的排序分數；52 週新高新低用同一個價格快取（只輸出旗標與比率）；
存證鏈以 ledger.verify 對 predictions.db 逐節重算。判定規則都在 stockta/monitor.py（純函式）。
"""

import json
import sqlite3
from datetime import date, timedelta
from pathlib import Path

from fastapi import APIRouter, Request

from stockta import ledger
from stockta.api.schemas import LedgerStatus, ModelHealth, MonitorDay, MonitorResponse, QuintileMove, QuintileMoves, Week52Extreme
from stockta.config import ARTIFACTS_CS_DIR, DATA_CACHE_DIR, LEDGER_CHAIN_PATH, PREDICTIONS_DB_PATH, STOCK_POOL
from stockta.data.cache import ParquetCache
from stockta.data.calendar import last_completed_trading_day
from stockta.data.provider import DataProvider, DataProviderError
from stockta.ml.report_rank_predictions import collect_matured, cs_production_version, daily_ic
from stockta.monitor import MIGRATION_SESSIONS, RULES_DOC, RULES_VERSION, model_health, quintile_moves, week52

router = APIRouter(tags=["monitor"])


def _rank_rows(db_path: Path, version: str | None) -> list[tuple]:
    """(ticker, base_date, score, source)；資料庫或表不存在時回空清單。"""
    if not Path(db_path).exists():
        return []
    conn = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)
    try:
        return conn.execute(
            "SELECT ticker, base_date, score, source FROM rank_predictions WHERE model_version=? ORDER BY base_date, ticker",
            (version,),
        ).fetchall()
    except sqlite3.OperationalError:
        return []  # 尚未建表
    finally:
        conn.close()


def _backtest_ic() -> float | None:
    try:
        return float(json.loads((ARTIFACTS_CS_DIR / "summary.json").read_text(encoding="utf-8"))["test_rank_ic"])
    except (OSError, KeyError, ValueError):
        return None


def _ledger_status(db_path: Path, chain_path: Path) -> LedgerStatus:
    if not Path(chain_path).exists():
        return LedgerStatus(available=False)
    chain = ledger.read_chain(Path(chain_path))
    report = ledger.verify(Path(db_path), chain)
    return LedgerStatus(
        available=True,
        entries=report.entries,
        chained=report.chained,
        pending=report.pending,
        ok=not report.problems,
        problems=report.problems[:10],
        last_recorded_at=chain[-1].get("recorded_at") if chain else None,
    )


@router.get("/api/monitor", response_model=MonitorResponse)
def get_monitor(request: Request) -> MonitorResponse:
    version = cs_production_version()
    rows = _rank_rows(PREDICTIONS_DB_PATH, version)

    dates, scores, rets, sources, pending = collect_matured(rows, ParquetCache(DATA_CACHE_DIR))
    per_day = daily_ic(dates, scores, rets, sources)
    health = model_health([(d.date(), ic) for d, _n, ic, _src in per_day if ic is not None], _backtest_ic())
    model = ModelHealth(
        version=version,
        n_live_days=sum(1 for _d, _n, ic, src in per_day if ic is not None and src == "live"),
        pending_rows=pending,
        daily=[MonitorDay(day=d.date(), ic=ic, n=n, source=src) for d, n, ic, src in per_day],
        **health,
    )

    base_dates = sorted({bd for _t, bd, _s, _src in rows})
    as_of = date.fromisoformat(base_dates[-1]) if base_dates else last_completed_trading_day()
    moves = QuintileMoves(from_date=None, to_date=None, n=0, moves=[])
    if len(base_dates) > MIGRATION_SESSIONS:
        to_d, from_d = base_dates[-1], base_dates[-1 - MIGRATION_SESSIONS]
        now = {t: s for t, bd, s, _src in rows if bd == to_d}
        before = {t: s for t, bd, s, _src in rows if bd == from_d}
        moves = QuintileMoves(
            from_date=date.fromisoformat(from_d),
            to_date=date.fromisoformat(to_d),
            n=len(set(now) & set(before)),
            moves=[QuintileMove(name=STOCK_POOL.get(m["ticker"], ""), **m) for m in quintile_moves(now, before)],
        )

    provider: DataProvider = request.app.state.data_provider
    highs: list[Week52Extreme] = []
    lows: list[Week52Extreme] = []
    for ticker, name in STOCK_POOL.items():
        try:
            close = provider.get_ohlcv(ticker, as_of - timedelta(days=400), as_of)["close"]
        except DataProviderError:
            continue
        w = week52(close, as_of)
        if w and w["new_high"]:
            highs.append(Week52Extreme(ticker=ticker, name=name, to_high=w["to_high"]))
        if w and w["new_low"]:
            lows.append(Week52Extreme(ticker=ticker, name=name, to_high=w["to_high"]))

    return MonitorResponse(
        base_date=as_of,
        rules_version=RULES_VERSION,
        rules_doc=RULES_DOC,
        model=model,
        quintile_moves=moves,
        new_highs=highs,
        new_lows=lows,
        ledger=_ledger_status(PREDICTIONS_DB_PATH, LEDGER_CHAIN_PATH),
    )
