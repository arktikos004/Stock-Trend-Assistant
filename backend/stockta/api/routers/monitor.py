"""模型監控與例外報表：GET /api/monitor（規則見 docs/monitor_prereg.md）；
簡單因子對照與可成交性：GET /api/monitor/baselines（規則見 docs/baseline_prereg.md）。

逐日線上 Rank IC 與線上報告共用同一段定義（ml/report_rank_predictions.daily_ic）；
分位遷移直接讀 predictions.db 存證的排序分數；52 週新高新低用同一個價格快取（只輸出旗標與比率）；
存證鏈以 ledger.verify 對 predictions.db 逐節重算。判定規則都在 stockta/monitor.py 與 stockta/baselines.py（純函式）。
另外把逐日 IC 分成三組（即時記錄、事後重建或補寫、預測窗口開始前已串入存證鏈）各自統計，只影響呈現，
狀態判定照預先聲明用全部的到期日（stockta/evidence.py）。即時記錄只收在預測窗口開始前寫入的 live 列；
排程晚跑、窗口開始後才寫入的 live 列和事後重建歸在同一組。
"""

import json
import sqlite3
from collections import defaultdict
from collections.abc import Callable, Sequence
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta
from pathlib import Path

import numpy as np
import pandas as pd
from fastapi import APIRouter, Request

from stockta import baselines, evidence, ledger
from stockta.api.schemas import (
    BaselinesResponse,
    DaysNeeded,
    FactorComparison,
    IcGroup,
    LedgerStatus,
    ModelHealth,
    MonitorDay,
    MonitorResponse,
    QuintileMove,
    QuintileMoves,
    QuintileReturns,
    TradableIc,
    Week52Extreme,
)
from stockta.config import ARTIFACTS_CS_DIR, CS_PRODUCTION_MODEL, DATA_CACHE_DIR, LEDGER_CHAIN_PATH, PREDICTIONS_DB_PATH, STOCK_POOL, stock_name
from stockta.data.cache import ParquetCache
from stockta.data.calendar import WEEK52_FETCH_DAYS, last_completed_trading_day, market_sessions
from stockta.data.provider import DataProvider, DataProviderError
from stockta.ml.online import collect_matured, cs_production_version, daily_ic
from stockta.monitor import MIGRATION_SESSIONS, RULES_DOC, RULES_VERSION, model_health, quintile_moves, week52

router = APIRouter(tags=["monitor"])


@dataclass(frozen=True)
class _RankData:
    """兩個端點共用的輸入：現行版本的排序列、價格快取、交易日曆、各基準日是否準時，以及逐日 Rank IC。"""

    version: str | None
    id_rows: list[tuple]  # (id, ticker, base_date, score, source, created_at)
    rows: list[tuple]  # (ticker, base_date, score, source)
    cache: ParquetCache
    sessions: list[date]
    on_time: dict[str, bool]
    per_day: list[tuple]  # daily_ic 的輸出：(基準日, 名數, IC 或 None, 'live'／'pit')
    pending: int


def _rank_data() -> _RankData:
    version = cs_production_version()
    id_rows = _rank_rows(PREDICTIONS_DB_PATH, version)
    rows = [(t, bd, s, src) for _id, t, bd, s, src, _at in id_rows]
    cache = ParquetCache(DATA_CACHE_DIR)
    dates, scores, rets, sources, pending = collect_matured(rows, cache)
    sessions = list(market_sessions(cache))
    return _RankData(
        version=version,
        id_rows=id_rows,
        rows=rows,
        cache=cache,
        sessions=sessions,
        on_time=_on_time(id_rows, sessions),
        per_day=daily_ic(dates, scores, rets, sources),
        pending=pending,
    )


def _health(data: _RankData) -> dict:
    return model_health([(d.date(), ic) for d, _n, ic, _src in data.per_day if ic is not None], _backtest_ic())


def _rank_rows(db_path: Path, version: str | None) -> list[tuple]:
    """(id, ticker, base_date, score, source, created_at)；資料庫或表不存在時回空清單。"""
    if not Path(db_path).exists():
        return []
    conn = sqlite3.connect(f"file:{Path(db_path).as_posix()}?mode=ro", uri=True)
    try:
        return conn.execute(
            "SELECT id, ticker, base_date, score, source, created_at FROM rank_predictions "
            "WHERE model_version=? ORDER BY base_date, ticker",
            (version,),
        ).fetchall()
    except sqlite3.OperationalError:
        return []  # 尚未建表
    finally:
        conn.close()


def _on_time(id_rows: list[tuple], sessions: Sequence[date]) -> dict[str, bool]:
    """基準日 → 這一天的列是否都在預測窗口開始（下一個交易日開盤）前寫入。"""
    out: dict[str, bool] = {}
    for _id, _t, bd, _s, _src, at in id_rows:
        early = at is not None and evidence.written_before_window(date.fromisoformat(bd), evidence.parse_time(at), sessions)
        out[bd] = out.get(bd, True) and early
    return out


def _backtest_ic() -> float | None:
    try:
        return float(json.loads((ARTIFACTS_CS_DIR / "summary.json").read_text(encoding="utf-8"))["test_rank_ic"])
    except (OSError, KeyError, ValueError):
        return None


def _trained_at() -> datetime | None:
    try:
        meta = json.loads((ARTIFACTS_CS_DIR / CS_PRODUCTION_MODEL / "metadata.json").read_text(encoding="utf-8"))
        return evidence.parse_time(meta["trained_at"])
    except (OSError, KeyError, ValueError):
        return None


def _before_training(day: date, trained_at: datetime | None) -> bool:
    """基準日收盤（台北 13:30）時模型還沒訓練完成：這一天只可能是事後重建。"""
    return trained_at is not None and datetime.combine(day, time(13, 30), tzinfo=evidence.TAIPEI) < trained_at


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
    data = _rank_data()
    version, id_rows, rows, per_day, on_time = data.version, data.id_rows, data.rows, data.per_day, data.on_time
    health = _health(data)

    chain = ledger.read_chain(Path(LEDGER_CHAIN_PATH)) if Path(LEDGER_CHAIN_PATH).exists() else []
    sealed = evidence.sealed_base_dates(
        ((i, bd) for i, _t, bd, _s, _src, _at in id_rows), evidence.link_spans(chain, "rank_predictions"), data.sessions
    )
    trained_at = _trained_at()
    days = [
        MonitorDay(
            day=d.date(),
            ic=ic,
            n=n,
            source=src,
            on_time=on_time.get(d.date().isoformat(), False),
            sealed=d.date().isoformat() in sealed,
            before_training=_before_training(d.date(), trained_at),
        )
        for d, n, ic, src in per_day
    ]
    scored_days = [x for x in days if x.ic is not None]
    groups = {
        "live": [(x.day, x.ic) for x in scored_days if x.source == "live" and x.on_time],
        "pit": [(x.day, x.ic) for x in scored_days if not (x.source == "live" and x.on_time)],
        "sealed": [(x.day, x.ic) for x in scored_days if x.sealed],
    }
    model = ModelHealth(
        version=version,
        n_live_days=len(groups["live"]),
        pending_rows=data.pending,
        daily=days,
        groups={key: IcGroup(**evidence.ic_group(values)) for key, values in groups.items()},
        trained_at=trained_at.isoformat() if trained_at else None,
        sealed_since=date.fromisoformat(min(sealed)) if sealed else None,
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
            moves=[QuintileMove(name=stock_name(m["ticker"]), **m) for m in quintile_moves(now, before)],
        )

    provider: DataProvider = request.app.state.data_provider
    highs: list[Week52Extreme] = []
    lows: list[Week52Extreme] = []
    for ticker, name in STOCK_POOL.items():
        try:
            close = provider.get_ohlcv(ticker, as_of - timedelta(days=WEEK52_FETCH_DAYS), as_of)["close"]
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


def _panels(data: _RankData) -> list[baselines.DayPanel]:
    """已到期（5 日報酬可算）的基準日，每檔附上三個因子與兩種起點的 5 日報酬；即時記錄與 groups.live 同一定義。"""
    matured = {d.date().isoformat(): src for d, _n, _ic, src in data.per_day}
    closes: dict[str, tuple[pd.DatetimeIndex, np.ndarray]] = {}
    for ticker in sorted({t for t, _bd, _s, _src in data.rows}):
        df = data.cache.read(ticker)
        if df is not None and not df.empty:
            closes[ticker] = (df.index, df["close"].to_numpy(dtype=float))
    by_day: dict[str, list[baselines.Obs]] = defaultdict(list)
    for ticker, bd, score, _src in data.rows:
        if bd not in matured or ticker not in closes:
            continue
        index, close = closes[ticker]
        pos = int(index.get_indexer([pd.Timestamp(bd)])[0])
        if pos < 0:
            continue
        by_day[bd].append(
            baselines.Obs(
                ticker=ticker,
                score=float(score),
                factors=baselines.factor_values(close, pos),
                ret=baselines.forward_return(close, pos),
                ret_next=baselines.forward_return(close, pos, start=baselines.NEXT_CLOSE),
            )
        )
    return [
        baselines.DayPanel(day=date.fromisoformat(bd), live=matured[bd] == "live" and data.on_time.get(bd, False), obs=tuple(obs))
        for bd, obs in sorted(by_day.items())
    ]


@router.get("/api/monitor/baselines", response_model=BaselinesResponse)
def get_baselines() -> BaselinesResponse:
    data = _rank_data()
    panels = _panels(data)
    health = _health(data)
    failures: list[str] = []

    def section(name: str, build: Callable[[], object]):
        try:
            return build()
        except Exception as exc:  # 一個區塊算不出來，不拖垮其他區塊
            failures.append(f"{name}: {type(exc).__name__}")
            return None

    base_dates = sorted({bd for _t, bd, _s, _src in data.rows})
    return BaselinesResponse(
        base_date=date.fromisoformat(base_dates[-1]) if base_dates else None,
        rules_version=baselines.RULES_VERSION,
        rules_doc=baselines.RULES_DOC,
        model_version=data.version,
        factors=section("factors", lambda: FactorComparison(**baselines.factor_comparison(panels))),
        tradable=section("tradable", lambda: TradableIc(**baselines.tradable_ic(panels))),
        days_needed=section(
            "days_needed", lambda: DaysNeeded(**baselines.days_needed(health["n_days"], health["se_nw"], health["backtest_ic"]))
        ),
        quintiles=section("quintiles", lambda: QuintileReturns(**baselines.quintile_returns(panels))),
        failures=failures,
    )
