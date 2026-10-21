"""信心門檻校準：python -m stockta.ml.calibrate

對驗證期（SPLIT_TRAIN_END ~ SPLIT_VAL_END）收集 production 模型的逐日機率，
以整體命中率網格搜尋「跌/漲」信心門檻，印出建議值。

門檻只准用驗證期挑選（測試期留給 backtest 驗證，避免樂觀偏差）。
重新訓練或更換 PRODUCTION_MODEL 後執行本指令，把結果回填
config.SIGNAL_CONFIDENCE_THRESHOLDS 並重跑 python -m stockta.ml.backtest。
"""

from __future__ import annotations

from datetime import timedelta
from itertools import product

import numpy as np
import pandas as pd

from stockta.config import (
    PRODUCTION_MODEL,
    SPLIT_TRAIN_END,
    SPLIT_VAL_END,
)
from stockta.data.calendar import REPORT_WARMUP_DAYS, last_completed_trading_day
from stockta.data.pool import load_market, load_pool, print_skip
from stockta.data.provider import CACHE_LIVE, make_provider
from stockta.features.market import build_market_context
from stockta.inference import decision
from stockta.inference.predictor import Predictor
from stockta.ml.backtest import collect_probas

# 門檻網格：低於門檻的方向訊號降級為觀望
THRESHOLD_GRID = np.arange(0.34, 0.72, 0.01)


def apply_thresholds(proba: np.ndarray, down: float, up: float) -> np.ndarray:
    """以（跌, 漲）兩個候選門檻套用正式決策規則；規則本身在 inference/decision.py。

    best_thresholds 與 walk-forward 用這個簽名搜尋門檻，與線上走的是同一條規則。
    """
    return decision.apply_thresholds(proba, {"跌": down, "漲": up})


def best_thresholds(
    proba: np.ndarray, y: np.ndarray, grid: np.ndarray = THRESHOLD_GRID
) -> tuple[float, float, float]:
    """在給定機率上網格搜尋最佳（跌, 漲）門檻，回傳 (命中率, 跌門檻, 漲門檻)。

    只能餵驗證期資料——用測試期挑門檻會產生樂觀偏差。
    """
    best = (-1.0, float(grid[0]), float(grid[0]))
    for down, up in product(grid, grid):
        acc = float((apply_thresholds(proba, down, up) == y).mean())
        if acc > best[0]:
            best = (acc, float(down), float(up))
    return best


def main() -> int:
    provider = make_provider(CACHE_LIVE)
    predictor = Predictor.from_registry(PRODUCTION_MODEL)
    train_end = pd.Timestamp(SPLIT_TRAIN_END)
    val_end = np.datetime64(pd.Timestamp(SPLIT_VAL_END))
    fetch_start = train_end.date() - timedelta(days=REPORT_WARMUP_DAYS)
    end = last_completed_trading_day()
    print(f"模型：{predictor.version}；驗證期 {SPLIT_TRAIN_END} ~ {SPLIT_VAL_END}")

    pool_ohlcv = load_pool(provider, fetch_start, end, on_skip=print_skip)
    context = build_market_context(load_market(provider, fetch_start, end), pool_ohlcv)

    probas, ys = [], []
    for df in pool_ohlcv.values():
        p, a, d = collect_probas(predictor, df, context, train_end)
        m = d <= val_end
        if m.any():
            probas.append(p[m])
            ys.append(a[m])
    proba = np.concatenate(probas)
    y = np.concatenate(ys)
    print(f"驗證期樣本 {len(y):,} 筆")

    acc, td, tu = best_thresholds(proba, y)
    raw_acc = float((proba.argmax(axis=1) == y).mean())
    print(f"原始 argmax 驗證期命中率 {raw_acc:.1%} → 校準後 {acc:.1%}")
    print(f'建議回填 config.py：SIGNAL_CONFIDENCE_THRESHOLDS = {{"跌": {td:.2f}, "漲": {tu:.2f}}}')
    print("回填後請重跑 python -m stockta.ml.backtest 以測試期驗證。")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
