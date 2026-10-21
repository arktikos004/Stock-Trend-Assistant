"""線上紀錄的到期判定與逐日 Rank IC：線上報告（ml/report_*）、API 路由與每日排程共用。

- actual_signal：基準日之後第 LABEL_HORIZON_DAYS 個交易日的實際累積報酬與訊號（與訓練標籤同一定義）
- collect_matured、daily_ic：已到期的排序紀錄與逐日 Rank IC（與回測同一個每日 IC，見 stockta/stats.py）
- current_production_version、cs_production_version：現行模型的版本字串（只讀 metadata.json）
"""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np
import pandas as pd

from stockta.config import (
    ARTIFACTS_CS_DIR,
    ARTIFACTS_DIR,
    CS_PRODUCTION_MODEL,
    LABEL_DOWN_THRESHOLD,
    LABEL_HORIZON_DAYS,
    LABEL_UP_THRESHOLD,
    PRODUCTION_MODEL,
)
from stockta.data.cache import ParquetCache
from stockta.inference.predictor import model_version
from stockta.stats import day_rank_ic



def actual_signal(cache: ParquetCache, ticker: str, base_date: str) -> tuple[str | None, float | None]:
    """回傳 (實際訊號, 實際 5 日累積報酬)；資料尚不足時回 (None, None)。"""
    df = cache.read(ticker)
    if df is None:
        return None, None
    ts = pd.Timestamp(base_date)
    if ts not in df.index:
        return None, None
    pos = df.index.get_loc(ts)
    target = pos + LABEL_HORIZON_DAYS
    if target >= len(df):
        return None, None  # 尚未到期
    ret = float(df["close"].iloc[target] / df["close"].iloc[pos] - 1)
    if ret > LABEL_UP_THRESHOLD:
        return "漲", ret
    if ret < LABEL_DOWN_THRESHOLD:
        return "跌", ret
    return "觀望", ret


def current_production_version(artifacts_dir: Path = ARTIFACTS_DIR) -> str | None:
    """現行 production 模型的版本字串（與 Predictor.version 同一個 model_version；不載入權重，只讀 metadata.json）。"""
    meta_path = artifacts_dir / PRODUCTION_MODEL / "metadata.json"
    if not meta_path.exists():
        return None
    return model_version(json.loads(meta_path.read_text(encoding="utf-8")))


def cs_production_version() -> str | None:
    """現行 cross-sectional production 模型版本字串（讀 metadata.json，不載權重）。"""
    meta_path = ARTIFACTS_CS_DIR / CS_PRODUCTION_MODEL / "metadata.json"
    if not meta_path.exists():
        return None
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    return f"{meta['model_name']}-cs-{meta['trained_at'][:10]}"


def collect_matured(rows: list[tuple], cache) -> tuple[list, list, list, list, int]:
    """rows=[(ticker, base_date, score, source)] → (dates, scores, rets, sources, n_pending)。

    以 actual_signal 取基準日後 LABEL_HORIZON_DAYS 日實際 close-to-close 報酬（重用絕對
    方向的到期判定）；尚未到期者計入 pending，不進入 Rank IC 計算。
    """
    dates, scores, rets, sources = [], [], [], []
    pending = 0
    for ticker, bd, score, source in rows:
        _sig, ret = actual_signal(cache, ticker, bd)
        if ret is None:
            pending += 1
            continue
        dates.append(pd.Timestamp(bd))
        scores.append(score)
        rets.append(ret)
        sources.append(source)
    return dates, scores, rets, sources, pending


def daily_ic(dates: list, scores: list, rets: list, sources: list) -> list[tuple]:
    """逐日 Rank IC：[(基準日, 名數, IC 或 None, 'live'／'pit')]，依基準日排序。

    與 rank_ic 同一過濾條件（每日 ≥10 名、分數與報酬皆有變異；不符合時 IC 為 None）。
    線上報告與模型監控（stockta/monitor.py）共用這一份定義。
    """
    per_day: list[tuple] = []
    if not dates:
        return per_day
    df = pd.DataFrame({"date": np.array(dates), "s": np.array(scores, dtype=float), "r": np.array(rets, dtype=float), "src": sources})
    for d, g in df.groupby("date"):
        src = "live" if (g["src"] == "live").any() else "pit"
        per_day.append((d, len(g), day_rank_ic(g["s"], g["r"]), src))
    return per_day
