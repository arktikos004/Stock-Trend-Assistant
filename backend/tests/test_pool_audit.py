"""股票池稽核：每檔只依最後一次已查證的調整事件判斷該不該在池中。

同一檔股票可能先被剔除、之後又被納入（貿聯-KY 在 2026-03 剔除、2026-06 再納入），
逐次比對每個審核日會把早已被取代的剔除也算成「應剔除但池中還在」。
"""

from datetime import date

from stockta.data.pool_audit import pool_discrepancies
from stockta.data.universe import MembershipEvent

_SRC = "https://example.invalid/review"


def _event(day: str, ticker: str, action: str) -> MembershipEvent:
    return MembershipEvent(date.fromisoformat(day), ticker, action, "定期審核", _SRC)


def test_a_later_readd_supersedes_an_earlier_drop():
    events = [
        _event("2025-12-19", "3665.TW", "add"),
        _event("2026-03-20", "3665.TW", "drop"),
        _event("2026-06-19", "3665.TW", "add"),
    ]
    found = pool_discrepancies({"3665.TW"}, events)
    assert all(not missing and not stale for missing, stale in found.values())


def test_latest_drop_of_a_pool_member_is_reported():
    events = [_event("2026-06-19", "2002.TW", "drop"), _event("2026-09-18", "6446.TW", "add")]
    found = pool_discrepancies({"2002.TW", "6446.TW"}, events)
    assert [e.ticker for e in found[date(2026, 6, 19)][1]] == ["2002.TW"]
    assert found[date(2026, 9, 18)] == ([], [])


def test_latest_add_missing_from_the_pool_is_reported():
    events = [_event("2026-09-18", "6446.TW", "add"), _event("2026-09-18", "3661.TW", "drop")]
    found = pool_discrepancies({"2330.TW"}, events)
    missing, stale = found[date(2026, 9, 18)]
    assert [e.ticker for e in missing] == ["6446.TW"] and stale == []
