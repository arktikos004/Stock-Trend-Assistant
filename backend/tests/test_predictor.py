"""resolve_signal 決策規則與版本字串的單元測試。"""

import json

import numpy as np

from stockta.config import LABEL_CLASSES, PRODUCTION_MODEL, SIGNAL_CONFIDENCE_THRESHOLDS
from stockta.inference.predictor import Predictor, resolve_signal
from stockta.ml.online import current_production_version

DOWN, HOLD, UP = 0, 1, 2


def test_high_confidence_directional_signal_kept():
    proba = np.array([0.10, 0.20, 0.70])
    assert resolve_signal(proba) == UP


def test_low_confidence_up_downgraded_to_hold():
    # 測資由當前門檻動態推導：漲的信心 = 門檻 − 0.01，仍為 argmax
    up = SIGNAL_CONFIDENCE_THRESHOLDS["漲"] - 0.01
    proba = np.array([(1 - up) / 2 - 0.05, (1 - up) / 2 + 0.05, up])
    assert proba.argmax() == UP, "測資前提：漲需為 argmax"
    assert resolve_signal(proba) == HOLD


def test_low_confidence_down_downgraded_to_hold():
    down = SIGNAL_CONFIDENCE_THRESHOLDS["跌"] - 0.01
    proba = np.array([down, (1 - down) / 2 + 0.05, (1 - down) / 2 - 0.05])
    assert proba.argmax() == DOWN, "測資前提：跌需為 argmax"
    assert resolve_signal(proba) == HOLD


def test_hold_argmax_unaffected_by_thresholds():
    proba = np.array([0.30, 0.40, 0.30])
    assert resolve_signal(proba) == HOLD


def test_exact_threshold_confidence_kept():
    proba = np.zeros(3)
    proba[DOWN] = SIGNAL_CONFIDENCE_THRESHOLDS["跌"]
    proba[HOLD] = (1 - proba[DOWN]) / 2
    proba[UP] = 1 - proba[DOWN] - proba[HOLD]
    assert resolve_signal(proba) == DOWN


def test_version_marks_calibrated_rule():
    predictor = Predictor(
        model=None, scaler=None, metadata={"model_name": "gru", "trained_at": "2026-07-11T00:00:00"}
    )
    assert predictor.version == "gru-2026-07-11+cal"


def test_report_reads_the_same_version_as_the_predictor(tmp_path):
    # predictions.db 以版本字串區分模型：線上記錄（Predictor）與報告（只讀 metadata.json）必須組出同一個字串
    metadata = {"model_name": "gru", "trained_at": "2026-08-14T06:30:00+00:00"}
    (tmp_path / PRODUCTION_MODEL).mkdir()
    (tmp_path / PRODUCTION_MODEL / "metadata.json").write_text(json.dumps(metadata), encoding="utf-8")
    predictor = Predictor(model=None, scaler=None, metadata=metadata)
    assert current_production_version(tmp_path) == predictor.version == "gru-2026-08-14+cal"
    assert current_production_version(tmp_path / "missing") is None


def test_label_order_assumed_by_rule():
    # resolve_signal 依 LABEL_CLASSES 索引「觀望」；順序若變動此測試先失敗
    assert LABEL_CLASSES == ["跌", "觀望", "漲"]
