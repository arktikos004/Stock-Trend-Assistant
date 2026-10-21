import sqlite3
from datetime import date

from fastapi import APIRouter, Request

from stockta import evidence
from stockta.api.errors import DataSourceUnavailableError
from stockta.api.schemas import (
    HealthResponse,
    MarketResponse,
    ModelInfoResponse,
    StockInfo,
    StockListResponse,
    TrackRecordResponse,
    TrackSample,
)
from stockta.config import DATA_CACHE_DIR, PREDICTIONS_DB_PATH, STOCK_POOL
from stockta.data.cache import ParquetCache
from stockta.data.calendar import last_completed_trading_day, market_sessions
from stockta.data.provider import DataProviderError
from stockta.ml.online import actual_signal, current_production_version

router = APIRouter(tags=["meta"])


@router.get("/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    predictor = getattr(request.app.state, "predictor", None)
    return HealthResponse(status="ok", model_loaded=predictor is not None)


@router.get("/api/stocks", response_model=StockListResponse)
def list_stocks() -> StockListResponse:
    return StockListResponse(
        stocks=[StockInfo(ticker=ticker, name=name) for ticker, name in STOCK_POOL.items()]
    )


@router.get("/api/model", response_model=ModelInfoResponse)
def model_info(request: Request) -> ModelInfoResponse:
    predictor = getattr(request.app.state, "predictor", None)
    if predictor is None:
        return ModelInfoResponse(model_version="mock-0.0.0", is_mock=True)
    meta = predictor.metadata
    return ModelInfoResponse(
        model_version=predictor.version,
        trained_at=meta.get("trained_at"),
        test_auc=meta.get("metrics", {}).get("test", {}).get("macro_auc"),
        is_mock=False,
    )


@router.get("/api/market", response_model=MarketResponse)
def market_snapshot(request: Request) -> MarketResponse:
    """大盤情境快照（^TWII + 股票池寬度）——與模型特徵同一條 context 路徑。"""
    end = last_completed_trading_day()
    try:
        context = request.app.state.market_context.get(end)
    except DataProviderError as exc:
        raise DataSourceUnavailableError(str(exc)) from exc

    row = context.iloc[-1]
    return MarketResponse(
        as_of=context.index[-1].date(),
        ret_1d=float(row["mkt_ret_1d"]),
        ret_5d=float(row["mkt_ret_5d"]),
        ma20_bias=float(row["mkt_ma20"]),
        vol20=float(row["mkt_vol20"]),
        breadth_up=float(row["breadth_up"]),
        breadth_ma5=float(row["breadth_ma5"]),
    )


@router.get("/api/track-record", response_model=TrackRecordResponse)
def track_record() -> TrackRecordResponse:
    """全站線上實證摘要：predictions.db 已到期預測的命中統計（即時計算）。
    僅計現行 production 版本——歷次換模型的已淘汰版本不與現行版本混算。

    命中率一定和同一批樣本的基線（全猜觀望、全猜漲）一起看；另依寫入時間分成預測窗口開始前寫入
    與之後才寫入（隔天補記、模型訓練完成後回補）兩組（stockta/evidence.py）。"""
    prod = current_production_version()
    try:
        conn = sqlite3.connect(PREDICTIONS_DB_PATH)
        if prod is not None:
            rows = conn.execute(
                "SELECT ticker, base_date, signal, created_at FROM predictions "
                "WHERE model_version = ? ORDER BY base_date",
                (prod,),
            ).fetchall()
        else:
            rows = conn.execute(
                "SELECT ticker, base_date, signal, created_at FROM predictions ORDER BY base_date"
            ).fetchall()
        conn.close()
    except sqlite3.OperationalError:
        rows = []
    if not rows:
        return TrackRecordResponse(total=0, matured=0, hits=0)

    cache = ParquetCache(DATA_CACHE_DIR)
    sessions = market_sessions(cache)
    samples: dict[str, list[tuple[str, str, str]]] = {"all": [], "before_window": [], "after_window": []}
    for ticker, base_date, signal, created_at in rows:
        actual, _ = actual_signal(cache, ticker, base_date)
        if actual is None:
            continue
        record = (base_date, signal, actual)
        samples["all"].append(record)
        early = evidence.written_before_window(date.fromisoformat(base_date), evidence.parse_time(created_at), sessions)
        samples["before_window" if early else "after_window"].append(record)
    matured = len(samples["all"])
    hits = sum(signal == actual for _bd, signal, actual in samples["all"])
    return TrackRecordResponse(
        total=len(rows),
        matured=matured,
        hits=hits,
        hit_rate=(hits / matured) if matured else None,
        since=date.fromisoformat(rows[0][1]),
        samples=[TrackSample(key=key, **evidence.hit_sample(records)) for key, records in samples.items()],
        bootstrap={"block": evidence.BOOTSTRAP_BLOCK, "replicates": evidence.BOOTSTRAP_REPS, "seed": evidence.BOOTSTRAP_SEED},
    )
