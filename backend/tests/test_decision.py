"""決策規則只有一份實作：inference/decision.py。

線上 API（Predictor.predict、歷史回放）用單筆的 resolve_signal；回測、門檻校準與 walk-forward 用向量化的
apply_thresholds。兩者必須逐筆相同，也必須與合併前的實作相同。下面的 _old_* 是合併前 ml/backtest.py 與
inference/predictor.py 的原始碼（凍結的對照組，不要修改）。
"""

import numpy as np
import pytest

from stockta.config import LABEL_CLASSES, SIGNAL_CONFIDENCE_THRESHOLDS
from stockta.inference.decision import apply_thresholds, resolve_signal
from stockta.ml.calibrate import apply_thresholds as apply_candidate_thresholds
from stockta.ml.labeling import LABEL_DOWN, LABEL_HOLD, LABEL_UP


def _old_apply_thresholds_batch(proba: np.ndarray) -> np.ndarray:
    pred = proba.argmax(axis=1)
    hold = LABEL_CLASSES.index("觀望")
    for name, tau in SIGNAL_CONFIDENCE_THRESHOLDS.items():
        k = LABEL_CLASSES.index(name)
        pred[(pred == k) & (proba[:, k] < tau)] = hold
    return pred


def _old_resolve_signal(proba: np.ndarray) -> int:
    idx = int(np.argmax(proba))
    if proba[idx] < SIGNAL_CONFIDENCE_THRESHOLDS.get(LABEL_CLASSES[idx], 0.0):
        return LABEL_CLASSES.index("觀望")
    return idx


def _probas(seed: int, n: int = 2000) -> np.ndarray:
    """隨機機率，加上剛好等於門檻、兩類平手、三類平手的列（最容易寫錯的邊界）。"""
    rng = np.random.default_rng(seed)
    down, up = SIGNAL_CONFIDENCE_THRESHOLDS["跌"], SIGNAL_CONFIDENCE_THRESHOLDS["漲"]
    edges = np.array(
        [
            [down, (1 - down) / 2, (1 - down) / 2],
            [(1 - up) / 2, (1 - up) / 2, up],
            [0.45, 0.10, 0.45],
            [1 / 3, 1 / 3, 1 / 3],
        ]
    )
    return np.vstack([rng.dirichlet(np.ones(3), size=n), edges])


@pytest.mark.parametrize("seed", range(5))
def test_single_vectorized_and_old_rules_agree_row_by_row(seed):
    proba = _probas(seed)
    vectorized = apply_thresholds(proba).tolist()
    assert [resolve_signal(p) for p in proba] == vectorized
    assert _old_apply_thresholds_batch(proba).tolist() == vectorized
    assert [_old_resolve_signal(p) for p in proba] == vectorized


def test_threshold_is_inclusive_and_ties_go_to_the_first_class():
    thresholds = {"跌": 0.42, "漲": 0.38}
    proba = np.array(
        [
            [0.42, 0.29, 0.29],  # 剛好等於門檻：保留方向
            [0.31, 0.31, 0.38],
            [0.45, 0.10, 0.45],  # 跌、漲平手：argmax 取第一個
            [0.41, 0.30, 0.29],  # 低於門檻：降級為觀望
            [0.30, 0.40, 0.30],  # 觀望本來就最大
        ]
    )
    expected = [LABEL_DOWN, LABEL_UP, LABEL_DOWN, LABEL_HOLD, LABEL_HOLD]
    assert apply_thresholds(proba, thresholds).tolist() == expected
    assert [resolve_signal(p, thresholds) for p in proba] == expected


def test_default_thresholds_are_read_from_config_at_call_time(monkeypatch):
    proba = np.array([[0.90, 0.05, 0.05]])
    assert apply_thresholds(proba).tolist() == [LABEL_DOWN]
    monkeypatch.setattr("stockta.config.SIGNAL_CONFIDENCE_THRESHOLDS", {"跌": 0.95, "漲": 0.95})
    assert apply_thresholds(proba).tolist() == [LABEL_HOLD]


def test_calibration_searches_with_the_same_rule():
    proba = _probas(7)
    down, up = SIGNAL_CONFIDENCE_THRESHOLDS["跌"], SIGNAL_CONFIDENCE_THRESHOLDS["漲"]
    assert apply_candidate_thresholds(proba, down, up).tolist() == apply_thresholds(proba).tolist()
