"""全尺度洩漏報告開頭的切分說明：測試期的月數與筆數由資料算出，不寫死（過去寫死「只剩約一個半月」）。"""

from datetime import date, timedelta

import pytest

from stockta.config import SPLIT_VAL_END
from stockta.ml.leakage_check import (
    MIN_TEST_ROWS,
    POWER_TRAIN_END,
    POWER_VAL_END,
    SplitInfo,
    _split_notice,
)


def test_default_split_reports_how_much_data_the_production_split_has():
    data_end = date.fromisoformat(SPLIT_VAL_END) + timedelta(days=61)
    split = SplitInfo(POWER_TRAIN_END, POWER_VAL_END, False, 50_000, data_end)
    assert split.production_test_months == pytest.approx(61 / 30.44)
    text = "\n".join(_split_notice(split))
    assert f"約 {split.production_test_months:.1f} 個月" in text
    assert "一個半月" not in text


def test_production_split_is_flagged_only_when_test_rows_are_too_few():
    data_end = date.fromisoformat(SPLIT_VAL_END) + timedelta(days=45)
    short = SplitInfo(POWER_TRAIN_END, SPLIT_VAL_END, True, MIN_TEST_ROWS - 1, data_end)
    enough = SplitInfo(POWER_TRAIN_END, SPLIT_VAL_END, True, MIN_TEST_ROWS, data_end)
    assert "統計效力不足" in "\n".join(_split_notice(short))
    assert "統計效力不足" not in "\n".join(_split_notice(enough))


def test_no_test_rows_means_zero_months():
    assert SplitInfo(POWER_TRAIN_END, SPLIT_VAL_END, True, 0, None).test_months == 0.0
