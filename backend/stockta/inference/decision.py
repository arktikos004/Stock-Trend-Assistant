"""機率 → 訊號的唯一決策規則：線上 API、歷史回放、回測、門檻校準與 walk-forward 都走這裡。

argmax 是方向訊號（漲／跌），但信心低於 config.SIGNAL_CONFIDENCE_THRESHOLDS 的方向一律降級為「觀望」
——少喊、喊得準。門檻只用驗證期校準（python -m stockta.ml.calibrate）；校準與線上必須是同一條規則，
否則校準出來的門檻不代表線上行為。
"""

from __future__ import annotations

from collections.abc import Mapping

import numpy as np

from stockta import config
from stockta.config import LABEL_CLASSES
from stockta.ml.labeling import LABEL_HOLD


def apply_thresholds(proba: np.ndarray, thresholds: Mapping[str, float] | None = None) -> np.ndarray:
    """(n, 3) 機率 → 類別索引：argmax 後，信心低於該類門檻的方向訊號降級為「觀望」。

    thresholds 為 None 時，用呼叫當下的 config.SIGNAL_CONFIDENCE_THRESHOLDS。
    """
    if thresholds is None:
        thresholds = config.SIGNAL_CONFIDENCE_THRESHOLDS
    pred = proba.argmax(axis=1)
    for name, tau in thresholds.items():
        k = LABEL_CLASSES.index(name)
        pred[(pred == k) & (proba[:, k] < tau)] = LABEL_HOLD
    return pred


def resolve_signal(proba: np.ndarray, thresholds: Mapping[str, float] | None = None) -> int:
    """單筆版：(3,) 機率 → 類別索引。"""
    return int(apply_thresholds(np.asarray(proba)[np.newaxis, :], thresholds)[0])
