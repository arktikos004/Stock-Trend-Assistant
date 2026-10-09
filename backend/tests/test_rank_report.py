"""線上 Rank IC 報告核心（到期判定 + 逐日 IC）的單元測試。"""

import json

import numpy as np
import pandas as pd
import pytest

from stockta.ml import report_rank_predictions
from stockta.ml.cs_metrics import rank_ic
from stockta.ml.report_rank_predictions import _backtest_ic_text, _interpret, collect_matured


class _FakeCache:
    """以單一 close 序列冒充 ParquetCache（read(ticker) 回同一 DataFrame）。"""

    def __init__(self, close_by_ticker):
        self._d = close_by_ticker

    def read(self, ticker):
        return self._d.get(ticker)


def _series(idx, closes):
    return pd.DataFrame({"close": closes}, index=idx)


def test_collect_matured_splits_matured_and_pending():
    idx = pd.bdate_range("2026-01-05", periods=8)  # 8 個交易日
    close = _series(idx, [100, 101, 102, 103, 104, 105, 106, 107])
    cache = _FakeCache({"2330.TW": close})

    early = str(idx[0].date())   # 基準日 +5 日（idx5）存在 → 到期
    late = str(idx[-1].date())   # 基準日 +5 日超出序列 → 待驗證
    rows = [
        ("2330.TW", early, 0.70, "pit"),
        ("2330.TW", late, 0.60, "live"),
    ]
    dates, scores, rets, sources, pending = collect_matured(rows, cache)

    assert pending == 1
    assert len(dates) == 1 and sources == ["pit"]
    assert rets[0] == pytest.approx(105 / 100 - 1)  # close[idx5]/close[idx0] - 1


def test_collect_matured_feeds_rank_ic_positive_when_score_tracks_return():
    # 兩個到期基準日、每日 12 檔，分數與未來報酬同序 → Rank IC 應為正
    d0 = pd.bdate_range("2026-02-02", periods=12)
    close_by_ticker = {}
    rows = []
    base = str(d0[0].date())
    for j in range(12):
        # 每檔 5 日後報酬 = j%（分數同序）
        closes = [100.0] * 6
        closes[5] = 100.0 * (1 + 0.01 * j)
        idx = pd.bdate_range("2026-02-02", periods=6)
        t = f"{2000 + j}.TW"
        close_by_ticker[t] = _series(idx, closes)
        rows.append((t, base, float(j), "pit"))
    dates, scores, rets, sources, pending = collect_matured(rows, _FakeCache(close_by_ticker))
    assert pending == 0 and len(dates) == 12
    ic = rank_ic(np.array(dates), np.array(scores), np.array(rets))
    assert ic["n_days"] == 1
    assert ic["mean"] > 0.99  # 分數與報酬完全同序


def test_backtest_text_leads_with_newey_west_t(tmp_path, monkeypatch):
    monkeypatch.setattr(report_rank_predictions, "ARTIFACTS_CS_DIR", tmp_path)
    summary = {"test_rank_ic": 0.0437, "test_rank_ic_t": 2.18, "test_rank_ic_days": 128}
    (tmp_path / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
    assert _backtest_ic_text() == "+0.0437, t=2.2、128 個交易日"  # 還沒補算 NW 的舊摘要

    summary["test_rank_ic_t_nw"] = 1.547
    (tmp_path / "summary.json").write_text(json.dumps(summary), encoding="utf-8")
    assert _backtest_ic_text() == "+0.0437, Newey–West t=1.55（未處理重疊為 2.2）、128 個交易日"


def test_interpret_judges_significance_with_newey_west_t():
    # 樸素 t 過了 2，但處理重疊後沒有 → 不能說顯著
    assert "無法區分" in _interpret({"n_days": 50, "mean": 0.03, "t": 2.5, "t_nw": 1.2})
    assert "為正且顯著" in _interpret({"n_days": 50, "mean": 0.03, "t": 2.5, "t_nw": 2.1})
