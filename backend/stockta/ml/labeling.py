"""5 日趨勢三分類標籤。

標籤定義（PLAN.md Phase 3）：未來 LABEL_HORIZON_DAYS 個交易日的累積報酬
> LABEL_UP_THRESHOLD 為「漲」、< LABEL_DOWN_THRESHOLD 為「跌」、其餘「觀望」。
類別索引順序固定為 config.LABEL_CLASSES = ["跌", "觀望", "漲"]（0/1/2），
所有模型的 predict_proba 輸出都必須遵守此順序。
"""

from __future__ import annotations

import numpy as np
import pandas as pd

from stockta.config import LABEL_CLASSES, LABEL_DOWN_THRESHOLD, LABEL_HORIZON_DAYS, LABEL_UP_THRESHOLD

# 類別索引由 config.LABEL_CLASSES 推出：順序只在 config 定義一次，這裡不另外寫死數字
LABEL_DOWN = LABEL_CLASSES.index("跌")
LABEL_HOLD = LABEL_CLASSES.index("觀望")
LABEL_UP = LABEL_CLASSES.index("漲")


def make_labels(close: pd.Series, horizon: int = LABEL_HORIZON_DAYS) -> pd.Series:
    """回傳與 close 同索引的標籤序列；最後 horizon 列因無未來資料為 NaN。"""
    future_return = close.shift(-horizon) / close - 1.0
    labels = pd.Series(np.float64(LABEL_HOLD), index=close.index)
    labels[future_return > LABEL_UP_THRESHOLD] = LABEL_UP
    labels[future_return < LABEL_DOWN_THRESHOLD] = LABEL_DOWN
    labels[future_return.isna()] = np.nan
    return labels
