"""預測存證雜湊鏈的守門測試：已上鏈的資料列被改、被刪、被塞進空號，驗證都必須失敗；
重跑排程不能產生重複的鏈節；正規化格式不能悄悄改變（改了就是另一條鏈，舊鏈全部驗不過）。"""

from __future__ import annotations

import math
import sqlite3
from datetime import date, datetime, timezone

import pytest

from stockta import ledger
from stockta.inference.store import PredictionStore, RankPredictionStore

NOW = datetime(2026, 10, 7, 7, 40, tzinfo=timezone.utc)


def _seed(db, day=date(2026, 10, 5), tickers=("2330.TW", "2317.TW"), source="live"):
    preds, ranks = PredictionStore(db), RankPredictionStore(db)
    for i, ticker in enumerate(tickers):
        preds.record(ticker, day, "漲", 0.4 + i / 10, "gru-x")
        ranks.record(ticker, day, 0.5 + i / 100, "xgb-cs-x", source=source)


def _execute(db, sql: str) -> None:
    conn = sqlite3.connect(db)
    try:
        conn.execute(sql)
        conn.commit()
    finally:
        conn.close()


@pytest.fixture
def db(tmp_path):
    path = tmp_path / "predictions.db"
    _seed(path)
    return path


@pytest.fixture
def chain(tmp_path):
    return tmp_path / "chain.jsonl"


# --- 正規化 ---


def test_float_encoding_is_exact_to_the_last_bit():
    assert ledger.float_hex(0.5) == "3fe0000000000000"
    assert ledger.float_hex(0.1) == "3fb999999999999a"
    assert ledger.float_hex(math.nextafter(0.1, 1.0)) != ledger.float_hex(0.1)


def test_canonical_row_format_is_fixed():
    row = (7, "2330.TW", "2026-10-05", "漲", 0.5, "gru-x", "2026-10-05T07:39:26+00:00")
    assert ledger.canonical_row("predictions", row) == (
        '["predictions",7,"2330.TW","2026-10-05","漲","3fe0000000000000","gru-x","2026-10-05T07:39:26+00:00"]\n'
    ).encode("utf-8")


@pytest.mark.parametrize(
    "row",
    [
        (7, "2330.TW", "2026-10-05", "漲", "0.5", "gru-x", "t"),  # 浮點欄位是字串
        (7, None, "2026-10-05", "漲", 0.5, "gru-x", "t"),          # 文字欄位是 NULL
        ("7", "2330.TW", "2026-10-05", "漲", 0.5, "gru-x", "t"),   # id 不是整數
    ],
)
def test_canonical_row_refuses_unexpected_types(row):
    with pytest.raises(TypeError):
        ledger.canonical_row("predictions", row)


# --- 上鏈 ---


def test_first_link_covers_existing_rows_and_says_it_cannot_prove_earlier(db, chain):
    entry = ledger.append(db, chain, now=NOW, run_id="123")
    assert entry["seq"] == 0 and entry["prev_hash"] == "0" * 64 and entry["run_id"] == "123"
    assert entry["ranges"]["predictions"] == {"after_id": 0, "to_id": 2, "rows": 2}
    assert entry["ranges"]["rank_predictions"] == {"after_id": 0, "to_id": 2, "rows": 2, "sources": {"live": 2}}
    assert "不能證明更早" in entry["note"]
    report = ledger.verify(db, ledger.read_chain(chain))
    assert report.problems == []
    assert report.chained == {"predictions": 2, "rank_predictions": 2}


def test_rerun_without_new_rows_adds_no_link(db, chain):
    ledger.append(db, chain, now=NOW)
    assert ledger.append(db, chain, now=NOW) is None
    assert len(ledger.read_chain(chain)) == 1


def test_new_rows_form_the_next_link_with_live_and_pit_counted_apart(db, chain):
    first = ledger.append(db, chain, now=NOW)
    _seed(db, day=date(2026, 10, 6))
    _seed(db, day=date(2026, 10, 2), tickers=("2454.TW",), source="pit")
    second = ledger.append(db, chain, now=NOW)
    assert second["seq"] == 1 and second["prev_hash"] == first["hash"] and "note" not in second
    assert second["ranges"]["predictions"] == {"after_id": 2, "to_id": 5, "rows": 3}
    assert second["ranges"]["rank_predictions"]["sources"] == {"live": 2, "pit": 1}
    assert ledger.verify(db, ledger.read_chain(chain)).problems == []


def test_rows_written_after_the_last_link_are_pending_not_errors(db, chain):
    ledger.append(db, chain, now=NOW)
    _seed(db, day=date(2026, 10, 6))
    report = ledger.verify(db, ledger.read_chain(chain))
    assert report.problems == []
    assert report.pending == {"predictions": 2, "rank_predictions": 2}


# --- 竄改偵測 ---


@pytest.mark.parametrize(
    "tamper",
    [
        "UPDATE predictions SET confidence = confidence + 1e-12 WHERE id = 1",
        "UPDATE predictions SET signal = '跌' WHERE id = 2",
        "UPDATE rank_predictions SET source = 'pit' WHERE id = 1",
        "UPDATE rank_predictions SET created_at = '2026-10-04T07:00:00+00:00' WHERE id = 2",
        "DELETE FROM rank_predictions WHERE id = 1",
    ],
)
def test_any_change_to_a_chained_row_is_detected(db, chain, tamper):
    ledger.append(db, chain, now=NOW)
    _execute(db, tamper)
    assert ledger.verify(db, ledger.read_chain(chain)).problems


def test_row_slipped_into_a_gap_of_a_chained_range_is_detected(tmp_path, chain):
    db = tmp_path / "predictions.db"
    _seed(db, tickers=("2330.TW", "2317.TW", "2454.TW"))
    _execute(db, "DELETE FROM predictions WHERE id = 2")  # 上鏈之前就有的空號（真實資料庫也有）
    ledger.append(db, chain, now=NOW)
    assert ledger.verify(db, ledger.read_chain(chain)).problems == []
    _execute(
        db,
        "INSERT INTO predictions VALUES (2, '2317.TW', '2026-10-05', '跌', 0.9, 'gru-x', '2026-10-05T07:39:26+00:00')",
    )
    assert ledger.verify(db, ledger.read_chain(chain)).problems


def test_edited_dropped_or_rehashed_links_are_detected(db, chain):
    ledger.append(db, chain, now=NOW)
    _seed(db, day=date(2026, 10, 6))
    ledger.append(db, chain, now=NOW)
    links = ledger.read_chain(chain)

    edited = [dict(link) for link in links]
    edited[0]["recorded_at"] = "2026-01-01T00:00:00+00:00"  # 改了內容卻沒重算 hash
    assert any("hash" in p for p in ledger.verify(db, edited).problems)

    rehashed = [dict(link) for link in links]
    rehashed[0]["recorded_at"] = "2026-01-01T00:00:00+00:00"
    rehashed[0]["hash"] = ledger.entry_hash(rehashed[0])  # 本節重算也沒用：下一節的 prev_hash 對不上
    assert any("prev_hash" in p for p in ledger.verify(db, rehashed).problems)

    assert ledger.verify(db, links[1:]).problems  # 拿掉第一節


def test_append_refuses_to_extend_a_chain_that_no_longer_matches(db, chain):
    ledger.append(db, chain, now=NOW)
    _execute(db, "UPDATE predictions SET signal = '跌' WHERE id = 1")
    _seed(db, day=date(2026, 10, 6))
    with pytest.raises(ledger.LedgerError):
        ledger.append(db, chain, now=NOW)
    assert len(ledger.read_chain(chain)) == 1


def test_missing_trailing_newline_does_not_merge_links(db, chain):
    ledger.append(db, chain, now=NOW)
    chain.write_bytes(chain.read_bytes().rstrip(b"\n"))  # 模擬手動編輯後少了行尾
    _seed(db, day=date(2026, 10, 6))
    ledger.append(db, chain, now=NOW)
    assert len(ledger.read_chain(chain)) == 2
    assert ledger.verify(db, ledger.read_chain(chain)).problems == []


# --- CLI ---


def test_cli_exit_codes(db, chain, capsys):
    assert ledger.main(["append", "--db", str(db), "--chain", str(chain)]) == 0
    assert ledger.main(["append", "--db", str(db), "--chain", str(chain)]) == 0  # 沒有新列：照樣成功、不新增
    assert ledger.main(["verify", "--db", str(db), "--chain", str(chain)]) == 0
    assert len(ledger.read_chain(chain)) == 1
    _execute(db, "DELETE FROM rank_predictions WHERE id = 1")
    assert ledger.main(["verify", "--db", str(db), "--chain", str(chain)]) == 1
    assert ledger.main(["append", "--db", str(db), "--chain", str(chain)]) == 1
    assert "驗證失敗" in capsys.readouterr().out
