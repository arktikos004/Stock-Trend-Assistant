"""線上成績的分組與不確定區間（stockta/evidence.py）、存證快照（/api/ledger）、排序讀紀錄（/api/rank）。全部不連網。"""

import json
import sqlite3
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import pytest

from stockta import evidence, ledger
from stockta.api.routers import monitor as monitor_router
from stockta.api.routers import rank as rank_router
from stockta.api.routers.ledger import ledger_snapshot
from stockta.data.cache import ParquetCache
from stockta.data.calendar import market_sessions

TPE = evidence.TAIPEI


def test_window_opens_on_the_next_weekday_at_nine():
    assert evidence.window_opens(date(2026, 10, 7)) == datetime(2026, 10, 8, 9, 0, tzinfo=TPE)
    assert evidence.window_opens(date(2026, 10, 9)) == datetime(2026, 10, 12, 9, 0, tzinfo=TPE)  # 週五 → 週一


def test_written_before_window():
    bd = date(2026, 8, 18)
    assert evidence.written_before_window(bd, datetime(2026, 8, 18, 15, 0, tzinfo=TPE))  # 當天收盤後
    assert evidence.written_before_window(bd, datetime(2026, 8, 19, 8, 59, tzinfo=TPE))
    assert not evidence.written_before_window(bd, datetime(2026, 8, 19, 15, 0, tzinfo=TPE))  # 隔天收盤後才補記
    # 資料庫存 UTC：2026-08-18T07:00Z＝台北 15:00
    assert evidence.written_before_window(bd, evidence.parse_time("2026-08-18T07:00:00+00:00"))


def test_window_opens_on_the_next_session_when_known():
    # 9/25 中秋、9/28 教師節休市：9/24 的窗口在 9/29 開盤才開始，週末寫入的不算晚寫
    sessions = [date(2026, 9, 23), date(2026, 9, 24), date(2026, 9, 29)]
    bd, written = date(2026, 9, 24), evidence.parse_time("2026-09-26T18:35:09+00:00")
    assert evidence.window_opens(bd, sessions) == datetime(2026, 9, 29, 9, 0, tzinfo=TPE)
    assert evidence.written_before_window(bd, written, sessions)
    assert not evidence.written_before_window(bd, written)  # 只看平日會誤判成晚寫
    # 還沒有基準日之後的交易日資料（尚未到期）：退回下一個平日
    assert evidence.window_opens(date(2026, 9, 29), sessions) == datetime(2026, 9, 30, 9, 0, tzinfo=TPE)


def test_market_sessions_come_from_the_index_cache(tmp_path):
    cache = ParquetCache(tmp_path)
    assert market_sessions(cache) == []
    cache.write("^TWII", pd.DataFrame({"close": [1.0, 2.0]}, index=pd.to_datetime(["2026-09-24", "2026-09-29"])))
    assert market_sessions(cache) == [date(2026, 9, 24), date(2026, 9, 29)]


def _chain(*links):
    return [
        {"recorded_at": at, "ranges": {"rank_predictions": {"after_id": a, "to_id": b, "rows": b - a}}}
        for at, a, b in links
    ]


def test_sealed_base_dates_needs_every_row_chained_before_the_window():
    chain = _chain(("2026-10-07T07:43:23+00:00", 0, 4), ("2026-10-08T07:44:11+00:00", 4, 6))
    spans = evidence.link_spans(chain, "rank_predictions")
    rows = [
        (1, "2026-10-01"),  # 10/07 才上鏈：窗口（10/02 開盤）早就開始了
        (2, "2026-10-07"),
        (3, "2026-10-07"),  # 10/07 收盤後上鏈：窗口 10/08 開盤才開始
        (4, "2026-10-08"),  # 10/07 那一節就涵蓋（不可能，但只看 id 區間）
        (5, "2026-10-08"),
        (7, "2026-10-08"),  # 還沒上鏈：整個基準日都不算
    ]
    assert evidence.sealed_base_dates(rows, spans) == {"2026-10-07"}


def test_ic_group_uses_newey_west():
    days = [(date(2026, 9, 1) + timedelta(days=i), v) for i, v in enumerate([0.1, -0.05, 0.08, 0.02, -0.01, 0.06])]
    g = evidence.ic_group(days)
    assert g["n_days"] == 6 and g["first_day"] == date(2026, 9, 1) and g["last_day"] == date(2026, 9, 6)
    assert g["mean_ic"] == pytest.approx(0.2 / 6)
    assert g["t_nw"] is not None
    assert evidence.ic_group([]) == {"n_days": 0, "mean_ic": None, "t_nw": None, "first_day": None, "last_day": None}


def test_hit_sample_baselines_precision_and_interval():
    records = []
    for i in range(30):
        day = (date(2026, 8, 1) + timedelta(days=i)).isoformat()
        records += [(day, "漲", "漲"), (day, "觀望", "觀望"), (day, "跌", "漲"), (day, "漲", "觀望")]
    s = evidence.hit_sample(records)
    assert s["matured"] == 120 and s["hits"] == 60 and s["hit_rate"] == 0.5 and s["n_days"] == 30
    assert s["actual"] == {"漲": 60, "跌": 0, "觀望": 60}
    assert s["baseline_hold"] == 0.5 and s["baseline_up"] == 0.5
    assert s["precision"]["漲"] == {"called": 60, "hits": 30}
    assert s["precision"]["跌"] == {"called": 30, "hits": 0}
    lo, hi = s["ci_hit_rate"]
    assert lo <= 0.5 <= hi  # 每天都一樣：區間退化成一點
    assert evidence.hit_sample(records) == s  # 固定種子：同一份資料，區間相同


def test_hit_sample_empty():
    s = evidence.hit_sample([])
    assert s["matured"] == 0 and s["hit_rate"] is None and s["ci_hit_rate"] is None


def _db(path: Path, rank_rows: list[tuple], pred_rows: list[tuple] = ()) -> None:
    conn = sqlite3.connect(path)
    conn.execute(
        "CREATE TABLE predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, base_date TEXT, signal TEXT,"
        " confidence REAL, model_version TEXT, created_at TEXT)"
    )
    conn.execute(
        "CREATE TABLE rank_predictions (id INTEGER PRIMARY KEY AUTOINCREMENT, ticker TEXT, base_date TEXT, score REAL,"
        " model_version TEXT, source TEXT, created_at TEXT)"
    )
    conn.executemany("INSERT INTO rank_predictions (ticker, base_date, score, model_version, source, created_at) VALUES (?,?,?,?,?,?)", rank_rows)
    conn.executemany("INSERT INTO predictions (ticker, base_date, signal, confidence, model_version, created_at) VALUES (?,?,?,?,?,?)", pred_rows)
    conn.commit()
    conn.close()


def test_ledger_snapshot_numbers_from_one_and_reports_pending_dates(tmp_path):
    db, chain_path = tmp_path / "p.db", tmp_path / "chain.jsonl"
    v = "xgb-cs-test"
    _db(db, [("2330.TW", "2026-10-07", 0.6, v, "live", "2026-10-07T07:40:00+00:00"), ("2317.TW", "2026-10-07", 0.4, v, "live", "2026-10-07T07:40:00+00:00")])
    ledger.append(db, chain_path, now=datetime(2026, 10, 7, 7, 43, tzinfo=timezone.utc), run_id="1")
    conn = sqlite3.connect(db)
    conn.execute("INSERT INTO rank_predictions (ticker, base_date, score, model_version, source, created_at) VALUES ('2330.TW','2026-10-08',0.7,?,'live','2026-10-08T07:40:00+00:00')", (v,))
    conn.commit()
    conn.close()

    snap = ledger_snapshot(db, chain_path, now=datetime(2026, 10, 8, 8, 0, tzinfo=timezone.utc))
    assert snap.available and snap.ok and snap.entries == 1
    assert snap.head.number == 1 and snap.head.seq == 0 and snap.head.rows == {"predictions": 0, "rank_predictions": 2}
    assert snap.pending == {"predictions": 0, "rank_predictions": 1}
    assert snap.pending_base_dates == [date(2026, 10, 8)] and snap.verified_through == date(2026, 10, 7)
    assert snap.first_note and snap.snapshot_at.startswith("2026-10-08T08:00")

    ledger.append(db, chain_path, now=datetime(2026, 10, 8, 7, 44, tzinfo=timezone.utc), run_id="2")
    snap = ledger_snapshot(db, chain_path)
    assert snap.entries == 2 and snap.head.number == 2 and snap.pending_base_dates == [] and snap.verified_through == date(2026, 10, 8)
    assert snap.head.prev_hash == json.loads(chain_path.read_text(encoding="utf-8").splitlines()[0])["hash"]


def test_ledger_snapshot_without_chain(tmp_path):
    snap = ledger_snapshot(tmp_path / "p.db", tmp_path / "missing.jsonl")
    assert snap.available is False and snap.head is None


def test_rank_uses_recorded_rows_when_they_exist(client_with_model, monkeypatch, tmp_path):
    """有紀錄的基準日直接回傳紀錄（存證的那一份），不重新評分；沒有紀錄才重新評分並標示。"""
    client = client_with_model
    monkeypatch.setattr(rank_router, "PREDICTIONS_DB_PATH", tmp_path / "none.db")
    base = client.get("/api/rank").json()
    assert base["basis"] == "recomputed" and base["recorded_source"] is None
    bd = base["base_date"]
    db = tmp_path / "p.db"
    _db(db, [(r["ticker"], bd, 0.9 - i * 0.01, "xgb-cs-test", "live", "2026-10-07T07:40:00+00:00") for i, r in enumerate(reversed(base["results"]))])
    monkeypatch.setattr(rank_router, "PREDICTIONS_DB_PATH", db)
    monkeypatch.setattr(rank_router, "cs_production_version", lambda: "xgb-cs-test")
    recorded = client.get("/api/rank").json()
    assert recorded["basis"] == "recorded" and recorded["recorded_source"] == "live"
    # 紀錄的分數順序和重新評分的不同：回傳的是紀錄
    assert [r["ticker"] for r in recorded["results"]] == [r["ticker"] for r in reversed(base["results"])]
    assert recorded["results"][0]["score"] == pytest.approx(0.9)

    monkeypatch.setattr(rank_router, "cs_production_version", lambda: "another-version")
    assert client.get("/api/rank").json()["basis"] == "recomputed"  # 別的模型版本的紀錄不算


def test_recorded_rows_written_after_the_window_are_flagged(tmp_path):
    db, v = tmp_path / "p.db", "xgb-cs-test"
    _db(db, [
        ("2330.TW", "2026-08-12", 0.6, v, "live", "2026-08-13T04:31:41+00:00"),  # 8/13 台北 12:31：開盤後才寫入
        ("2330.TW", "2026-10-07", 0.6, v, "live", "2026-10-07T07:37:00+00:00"),
    ])
    _scored, source, on_time = rank_router.recorded_scores(db, v, date(2026, 8, 12))
    assert source == "live" and on_time is False
    assert rank_router.recorded_scores(db, v, date(2026, 10, 7))[2] is True


def test_monitor_on_time_needs_every_row_before_the_window():
    rows = [
        (1, "2330.TW", "2026-08-12", 0.6, "live", "2026-08-13T04:31:41+00:00"),
        (2, "2330.TW", "2026-10-07", 0.6, "live", "2026-10-07T07:37:00+00:00"),
        (3, "2317.TW", "2026-10-07", 0.4, "live", "2026-10-08T07:37:00+00:00"),  # 同一天有一列晚寫：整天都不算
        (4, "2330.TW", "2026-10-08", 0.6, "live", "2026-10-08T07:38:00+00:00"),
        (5, "2317.TW", "2026-10-08", 0.4, "live", None),
    ]
    assert monitor_router._on_time(rows, []) == {"2026-08-12": False, "2026-10-07": False, "2026-10-08": False}
    assert monitor_router._on_time(rows[3:4], []) == {"2026-10-08": True}
