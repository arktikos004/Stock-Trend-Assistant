import ast
import math
from pathlib import Path

import numpy as np

from stockta import stats
from stockta.stats import day_rank_ic


def test_day_rank_ic_ignores_nan_when_counting_distinct():
    rng = np.random.default_rng(0)
    one_value_and_nan = np.r_[np.full(11, 0.5), np.nan]
    assert day_rank_ic(one_value_and_nan, rng.random(12)) is None
    # 兩邊都有變異但含缺值：照 spearmanr 回 NaN，交給呼叫端決定略過或保留
    with_nan = np.r_[rng.random(11), np.nan]
    assert math.isnan(day_rank_ic(with_nan, rng.random(12)))


def test_day_rank_ic_needs_enough_stocks():
    rng = np.random.default_rng(1)
    assert day_rank_ic(rng.random(stats.MIN_STOCKS_PER_DAY - 1), rng.random(stats.MIN_STOCKS_PER_DAY - 1)) is None
    assert day_rank_ic(rng.random(stats.MIN_STOCKS_PER_DAY), rng.random(stats.MIN_STOCKS_PER_DAY)) is not None


def test_stats_imports_only_config():
    tree = ast.parse(Path(stats.__file__).read_text(encoding="utf-8"))
    imported = {
        node.module for node in ast.walk(tree) if isinstance(node, ast.ImportFrom) and (node.module or "").startswith("stockta")
    } | {alias.name for node in ast.walk(tree) if isinstance(node, ast.Import) for alias in node.names if alias.name.startswith("stockta")}
    assert imported == {"stockta.config"}
