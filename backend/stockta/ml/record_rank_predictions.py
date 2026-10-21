"""每日批次記錄線上相對強弱分數：python -m stockta.ml.record_rank_predictions

對全股票池以 cross-sectional production 模型（CS_PRODUCTION_MODEL）評分
（P(未來 LABEL_HORIZON_DAYS 日贏過當日全池中位數)），落地 predictions.db 的
rank_predictions 表——與絕對方向 record_predictions 並存、互不干擾。累積後由
report_rank_predictions 產出**線上 Rank IC**，補上「絕對方向線上實證只驗證已淘汰
路線」的缺口（相對排序才是 experiment_log #8 的正面主線）。

子命令：
    live      （預設）以最後一個已完成交易日為基準日即時評分並記錄（source=live）
    backfill  以固定權重、point-in-time 重建既有絕對預測相同的歷史基準日
              （source=pit，無前視、與 /api/rank?date= 同一路徑），使線上 Rank IC
              立即有可到期樣本，之後由每日 live 累積延續
"""

from __future__ import annotations

import argparse
import sqlite3
from datetime import date

from stockta.config import (
    CS_PRODUCTION_MODEL,
    LABEL_HORIZON_DAYS,
    MARKET_INDEX_TICKER,
    PREDICTIONS_DB_PATH,
    STOCK_POOL,
    STOCK_POOL_EFFECTIVE,
)
from stockta.data.calendar import backfill_sessions, last_completed_trading_day, record_fetch_start, replay_fetch_start
from stockta.data.provider import CACHE_FIRST, CACHE_LIVE, DataProviderError, make_provider
from stockta.features.market import build_market_context
from stockta.inference.replay import load_pool_context
from stockta.inference.store import RankPredictionStore
from stockta.ml.cross_sectional import load_cs_model, score_asof
from stockta.ml.online import cs_production_version


def _recorded_rank_pairs(db_path, version: str) -> set[tuple[str, str]]:
    """該版本已記錄過的 (ticker, rank 基準日) 集合（供冪等自癒：跳過已補上的）。
    以「標的×日」為單位的理由見 record_predictions._recorded_pairs。"""
    conn = sqlite3.connect(db_path)
    try:
        rows = conn.execute(
            "SELECT ticker, base_date FROM rank_predictions WHERE model_version=?", (version,)
        ).fetchall()
    except sqlite3.OperationalError:
        rows = []
    conn.close()
    return {(r[0], r[1]) for r in rows}


def run_live(
    store: RankPredictionStore, model, scaler, version: str, days: int, require_complete: bool = False
) -> int:
    """即時評分全池並記錄最近 N 個交易日（冪等自癒漏記）。當日最新交易日記 source=live，
    因資料延遲而回補的較舊交易日記 source=pit（分數對固定權重逐位元一致，僅記錄時點不同）。"""
    provider = make_provider(CACHE_LIVE)
    end = last_completed_trading_day()
    ctx_start = record_fetch_start(end)

    pool_ohlcv: dict = {}
    for ticker in STOCK_POOL:
        try:
            pool_ohlcv[ticker] = provider.get_ohlcv(ticker, ctx_start, end)
        except DataProviderError as exc:
            print(f"[略過] {ticker}: {exc}")
    try:
        market = provider.get_ohlcv(MARKET_INDEX_TICKER, ctx_start, end)
    except DataProviderError as exc:
        print(f"無法取得大盤指數 {MARKET_INDEX_TICKER}: {exc}")
        return 1
    context = build_market_context(market, pool_ohlcv)

    # 回補不跨越換池日：換池前的基準日只屬於當時的股票池
    recent_days = backfill_sessions(context.index, days, date.fromisoformat(STOCK_POOL_EFFECTIVE))
    newest = recent_days[-1] if recent_days else None
    already = _recorded_rank_pairs(PREDICTIONS_DB_PATH, version)
    covered: list[str] = []
    missing: list[str] = []
    total = 0
    for as_of in recent_days:
        day = as_of.date().isoformat()
        src = "live" if as_of == newest else "pit"
        day_ok = 0
        for ticker in STOCK_POOL:
            if (ticker, day) in already:
                continue
            df = pool_ohlcv.get(ticker)
            if df is None:
                missing.append(f"{ticker}@{day}")
                continue
            r = score_asof(model, scaler, df, context, as_of)
            if r is None:
                continue
            score, base_date = r
            # 當日 K 棒不在（下載失敗退回舊快取）→ 不記，留給下次補
            if base_date != as_of.date():
                missing.append(f"{ticker}@{day}")
                continue
            store.record(ticker, base_date, score, version, source=src)
            day_ok += 1
        if day_ok:
            covered.append(f"{as_of.date()}({src})")
            total += day_ok
            print(f"  {as_of.date()} [{src}]: {day_ok} 檔")
    if covered:
        print(f"live：新記錄 {'、'.join(covered)}（{total} 筆），累計 {store.count()} 筆 rank_predictions（{version}）")
    else:
        print(f"live：最近 {days} 交易日皆已記錄、無新增；累計 {store.count()} 筆 rank_predictions（{version}）")
    if missing:
        print(f"[未完成] {len(missing)} 筆缺當日資料、待下次補：{'、'.join(missing[:10])}")
        return 2 if require_complete else 0
    return 0


def run_backfill(store: RankPredictionStore, model, scaler, version: str) -> int:
    """對既有絕對方向預測的歷史基準日，以固定權重 point-in-time 重建 CS 分數
    （source=pit，無前視，與 /api/rank?date= 同一重算路徑）。"""
    conn = sqlite3.connect(PREDICTIONS_DB_PATH)
    base_dates = [
        r[0] for r in conn.execute(
            "SELECT DISTINCT base_date FROM predictions ORDER BY base_date"
        ).fetchall()
    ]
    conn.close()

    provider = make_provider(CACHE_FIRST)
    total = 0
    for bd in base_dates:
        as_of = date.fromisoformat(bd)
        try:
            pool_ohlcv, context = load_pool_context(provider, replay_fetch_start(as_of), as_of)
        except DataProviderError as exc:
            print(f"[略過] {bd}: {exc}")
            continue
        n = 0
        for ticker, df in pool_ohlcv.items():
            r = score_asof(model, scaler, df, context, as_of)
            if r is None:
                continue
            score, base_date = r
            store.record(ticker, base_date, score, version, source="pit")
            n += 1
        print(f"  {bd}: 重建 {n} 檔")
        total += n
    print(
        f"backfill：{len(base_dates)} 個基準日、共 {total} 筆（point-in-time），"
        f"累計 {store.count()} 筆 rank_predictions（{version}）"
    )
    return 0 if total else 1


def main() -> int:
    parser = argparse.ArgumentParser(description="批次記錄線上相對強弱分數")
    sub = parser.add_subparsers(dest="cmd")
    p_live = sub.add_parser("live", help="即時評分並記錄最近 N 交易日（冪等自癒；預設）")
    p_live.add_argument(
        "--days", type=int, default=LABEL_HORIZON_DAYS,
        help="回補最近 N 個交易日（冪等自癒漏記；預設=標籤天數，回補日結果尚未實現、無前視）",
    )
    p_live.add_argument(
        "--require-complete", action="store_true",
        help="有標的缺當日資料時以 exit 2 結束（雲端排程據此觸發補跑）；已取得的照常記錄",
    )
    sub.add_parser("backfill", help="point-in-time 重建既有絕對預測相同的歷史基準日")
    args = parser.parse_args()

    model, scaler, _meta = load_cs_model(CS_PRODUCTION_MODEL)
    version = cs_production_version()
    store = RankPredictionStore(PREDICTIONS_DB_PATH)
    if args.cmd == "backfill":
        return run_backfill(store, model, scaler, version)
    return run_live(
        store, model, scaler, version,
        getattr(args, "days", LABEL_HORIZON_DAYS),
        getattr(args, "require_complete", False),
    )


if __name__ == "__main__":
    raise SystemExit(main())
