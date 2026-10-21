"""排序評估共用的統計量：逐日 Rank IC 與 Newey–West 標準誤。

回測（ml/cs_metrics）、線上紀錄（ml/online）、模型監控（monitor）與簡單因子對照（baselines）都用這一份；
各自怎麼處理「這一天不算」（略過、記成 None 或 NaN）留在呼叫端，這裡只回答一天的 IC 是多少。
只依賴 config，不 import 其他 stockta 模組。
"""

from __future__ import annotations

from collections.abc import Sequence

import numpy as np
import pandas as pd
from scipy.stats import spearmanr

from stockta.config import LABEL_HORIZON_DAYS

NW_LAGS = LABEL_HORIZON_DAYS - 1  # 相鄰基準日的未來報酬重疊 LABEL_HORIZON_DAYS − 1 天
MIN_STOCKS_PER_DAY = 10  # 當日少於這麼多檔不算 Rank IC
MIN_DAYS = 20  # 逐日 IC 少於這麼多天不下判斷


def newey_west(x: Sequence[float], lags: int = NW_LAGS) -> tuple[float, float]:
    """平均與其 Newey–West HAC 標準誤（Bartlett kernel：權重 1 − l／(lags + 1)）。"""
    a = np.asarray(x, dtype=float)
    n = len(a)
    e = a - a.mean()
    s = float(e @ e) / n
    for lag in range(1, min(lags, n - 1) + 1):
        s += 2 * (1 - lag / (lags + 1)) * float(e[lag:] @ e[:-lag]) / n
    return float(a.mean()), float(np.sqrt(max(s, 0.0) / n))


def day_rank_ic(scores: Sequence[float], rets: Sequence[float]) -> float | None:
    """一天的 Spearman(分數, 報酬)。少於 MIN_STOCKS_PER_DAY 檔、或任一邊沒有變異時回 None；
    有缺值時 spearmanr 回 NaN，原樣回傳。不轉換資料型別。"""
    if len(scores) < MIN_STOCKS_PER_DAY or pd.Series(scores).nunique() < 2 or pd.Series(rets).nunique() < 2:
        return None
    return float(spearmanr(scores, rets)[0])
