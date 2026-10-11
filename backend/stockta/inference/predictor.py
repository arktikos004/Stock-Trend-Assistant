"""線上推論：載入 artifact，對單一股票的近期 OHLCV 產出趨勢預測。

Predictor 不碰網路——OHLCV 由呼叫端經 DataProvider 取得後傳入，
本模組只負責「特徵 → 視窗 → 機率」，與訓練共用 build_features 同一入口。
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass
from datetime import date
from pathlib import Path
from typing import Any

import numpy as np
import pandas as pd

from stockta.config import (
    ARTIFACTS_DIR,
    LABEL_CLASSES,
    SIGNAL_CONFIDENCE_THRESHOLDS,
    WINDOW_LENGTH_DAYS,
)
from stockta.features.pipeline import build_features
from stockta.inference.decision import resolve_signal
from stockta.ml import registry


class InsufficientDataError(RuntimeError):
    """暖機後資料不足一個滑動視窗，無法推論。"""


def model_version(metadata: Mapping[str, Any]) -> str:
    """artifact metadata → 版本字串；predictions.db 以它區分模型，線上記錄與報告都必須用這一個函式。

    有信心門檻時加註 +cal：同一模型在校準前後的訊號分佈不同，新舊決策規則的紀錄不能混在一起。
    """
    suffix = "+cal" if SIGNAL_CONFIDENCE_THRESHOLDS else ""
    return f"{metadata['model_name']}-{metadata['trained_at'][:10]}{suffix}"


@dataclass
class Prediction:
    signal: str
    confidence: float
    base_date: date
    proba: list[float]


class Predictor:
    def __init__(self, model, scaler, metadata: dict[str, Any]):
        self._model = model
        self._scaler = scaler
        self.metadata = metadata

    @classmethod
    def from_registry(cls, name: str, artifacts_dir: Path = ARTIFACTS_DIR) -> "Predictor":
        model, scaler, metadata = registry.load(name, artifacts_dir)
        return cls(model, scaler, metadata)

    @property
    def version(self) -> str:
        return model_version(self.metadata)

    def predict(self, ohlcv: pd.DataFrame, context: pd.DataFrame) -> Prediction:
        """context 為市場情境（build_market_context 產物），與訓練共用同一條特徵路徑。"""
        feats = build_features(ohlcv, context)
        if len(feats) < WINDOW_LENGTH_DAYS:
            raise InsufficientDataError(
                f"暖機後僅 {len(feats)} 列特徵，不足 {WINDOW_LENGTH_DAYS} 日視窗；"
                f"請確認抓取區間涵蓋 warmup_lookback_days()"
            )
        window = feats.iloc[-WINDOW_LENGTH_DAYS:]
        scaled = self._scaler.transform(window.to_numpy(dtype=np.float64)).astype(np.float32)
        proba = self._model.predict_proba(scaled.reshape(1, -1))[0]
        idx = resolve_signal(proba)
        return Prediction(
            signal=LABEL_CLASSES[idx],
            confidence=float(proba[idx]),
            base_date=window.index[-1].date(),
            proba=[float(p) for p in proba],
        )
