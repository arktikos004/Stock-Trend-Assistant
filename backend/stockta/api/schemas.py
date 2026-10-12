"""Pydantic 回應模型 — Phase 0 凍結的 API 契約。

前端（含讀靜態 JSON 的公開站）依這份契約讀資料：欄位名稱與型別不要改；
真的要改就是破壞性變更，frontend/lib/api.ts 與 export_static.py 要一起改。
"""

from datetime import date
from typing import Literal

from pydantic import BaseModel, Field

Signal = Literal["漲", "跌", "觀望"]
RiskLevel = Literal["低", "中", "高"]


class Candle(BaseModel):
    time: date
    open: float
    high: float
    low: float
    close: float
    volume: int


class CandlesResponse(BaseModel):
    ticker: str
    candles: list[Candle]


class PredictionResponse(BaseModel):
    ticker: str
    base_date: date = Field(description="預測所依據的最後一個已完成交易日")
    signal: Signal
    confidence: float = Field(ge=0, le=1)
    risk: RiskLevel
    model_version: str
    is_mock: bool = Field(default=False, description="模型未載入、回應是 mock 時為 True，前端據此顯示提示")
    proba: dict[str, float] | None = Field(
        default=None, description="三類機率（跌/觀望/漲）；mock 模式為 None。additive 欄位，不破壞既有契約"
    )


class RankResult(BaseModel):
    """cross-sectional 相對強弱排名的單一標的。"""

    ticker: str
    name: str
    score: float = Field(ge=0, le=1, description="P(未來 5 日贏過全池中位數)")
    rank: int = Field(description="1 = 相對最強")
    percentile: float = Field(ge=0, le=1)
    quantile: Literal["top", "mid", "bottom"]


class RankResponse(BaseModel):
    """全池 cross-sectional 排名；無 date=即時，帶 date=歷史某日 point-in-time。"""

    base_date: date
    model: str
    is_historical: bool = False
    basis: Literal["recorded", "recomputed"] = Field(
        default="recomputed",
        description="recorded＝讀資料庫裡已記錄（並串入存證鏈）的排序列；recomputed＝依當時可得的資料重新評分，沒有紀錄可對照",
    )
    recorded_source: Literal["live", "pit"] | None = Field(
        default=None, description="basis＝recorded 時：live＝基準日當天記錄，pit＝事後重建後記錄"
    )
    results: list[RankResult]
    is_mock: bool = False


class RankSummaryResponse(BaseModel):
    """cross-sectional 回測摘要（Rank IC + 扣成本組合），供前端策略卡。"""

    model: str | None = None
    test_rank_ic: float | None = None
    test_rank_ic_t: float | None = None  # 樸素 t（逐日 IC 視為獨立，會高估顯著性）
    test_rank_ic_t_nw: float | None = None  # Newey–West t（處理相鄰基準日的報酬重疊）
    test_rank_ic_days: int | None = None
    test_start: date | None = Field(default=None, description="Rank IC 測試期的起日；沒有用來選模型或持有期")
    test_end: date | None = None
    val_start: date | None = Field(default=None, description="驗證期起日；示意組合跑 val_start～test_end，含用來選模型與持有期的驗證期")
    val_rank_ic: float | None = None
    holding_days: int | None = None
    net_cum: float | None = None
    bench_cum: float | None = None
    net_excess_cum: float | None = None
    win_rate: float | None = None
    cost_bps: float | None = None
    available: bool = False


class ScanResult(BaseModel):
    """全池掃描的單一標的結果。歷史日期查詢時附實際 5 日結果。"""

    ticker: str
    name: str
    signal: Signal
    confidence: float = Field(ge=0, le=1)
    risk: RiskLevel | None = None
    proba: dict[str, float]
    actual: Signal | None = Field(default=None, description="歷史查詢且已到期時的實際 5 日趨勢")
    actual_return: float | None = None
    hit: bool | None = None


class ScanResponse(BaseModel):
    """全股票池掃描：對每檔以 production 模型推論的趨勢訊號。
    無 date 參數＝即時掃描；帶 date＝歷史某日的 point-in-time 重算（附實際結果）。"""

    base_date: date = Field(description="推論所依據的最後一個交易日")
    model_version: str
    is_historical: bool = Field(default=False)
    up: int = Field(description="訊號為「漲」的檔數")
    hold: int = Field(description="訊號為「觀望」的檔數")
    down: int = Field(description="訊號為「跌」的檔數")
    matured: int = Field(default=0, description="歷史查詢中已到期（可對照實際）的檔數")
    hits: int = Field(default=0, description="其中命中的檔數")
    results: list[ScanResult]
    is_mock: bool = Field(default=False)


class IndicatorsResponse(BaseModel):
    """當前技術指標快照（與模型特徵同一條 build_features 路徑，數值一致）。"""

    ticker: str
    as_of: date
    rsi14: float = Field(description="0–1 縮放（0.5 中性）")
    kd_k: float
    kd_d: float
    macd_hist: float
    bb_pctb: float
    bb_width: float
    vol_ratio: float = Field(description="量能相對 20 日均量的偏離")
    ma_bias_5: float = Field(description="收盤價相對 5 日均線乖離")
    ma_bias_20: float
    ma_bias_60: float


class MarketResponse(BaseModel):
    """大盤情境快照（^TWII + 股票池寬度）。"""

    as_of: date
    ret_1d: float
    ret_5d: float
    ma20_bias: float = Field(description="加權指數相對其 20 日均線乖離")
    vol20: float = Field(description="日報酬 20 日標準差")
    breadth_up: float = Field(description="股票池當日上漲家數比 0–1")
    breadth_ma5: float


class PastPrediction(BaseModel):
    base_date: date
    signal: Signal
    confidence: float
    model_version: str
    actual: Signal | None = Field(default=None, description="未到期（不足 5 個交易日）為 None")
    actual_return: float | None = None
    hit: bool | None = None


class PredictionHistoryResponse(BaseModel):
    ticker: str
    records: list[PastPrediction]


class HistoryRecord(BaseModel):
    date: date
    signal: Signal
    confidence: float
    actual: Signal
    actual_return: float | None = None
    hit: bool


class StockHistoryResponse(BaseModel):
    """單一標的的歷史預測回放（point-in-time 重算 vs 實際），僅含已到期樣本。"""

    ticker: str
    start: date
    end: date
    count: int
    hits: int
    hit_rate: float | None = None
    records: list[HistoryRecord]


class SignalPrecision(BaseModel):
    called: int = Field(description="喊出這個訊號的到期筆數")
    hits: int


class TrackSample(BaseModel):
    """一組已到期的方向預測：命中率、同一批樣本的兩條基線與精度、95% block bootstrap 區間。"""

    key: Literal["all", "before_window", "after_window"] = Field(
        description="all＝全部到期；before_window＝預測窗口開始（下一個交易日開盤）前寫入；after_window＝之後才寫入（隔天補記或回補）"
    )
    matured: int
    hits: int
    hit_rate: float | None
    n_days: int = Field(description="基準日數（bootstrap 的單位）")
    actual: dict[str, int] = Field(description="實際結果的分布")
    baseline_hold: float | None = Field(description="全猜「觀望」的命中率")
    baseline_up: float | None = Field(description="全猜「漲」的命中率")
    precision: dict[str, SignalPrecision]
    ci_hit_rate: tuple[float, float] | None = None
    ci_excess_hold: tuple[float, float] | None = Field(default=None, description="命中率減全猜觀望的 95% 區間")
    ci_excess_up: tuple[float, float] | None = None


class TrackRecordResponse(BaseModel):
    """全站線上實證摘要：predictions.db 已到期預測的即時命中統計。"""

    total: int
    matured: int
    hits: int
    hit_rate: float | None = Field(default=None, description="matured=0 時為 None")
    since: date | None = None
    samples: list[TrackSample] = Field(default_factory=list)
    bootstrap: dict[str, int] | None = Field(default=None, description="區塊長度、重抽次數、亂數種子")


class StockInfo(BaseModel):
    ticker: str
    name: str


class StockListResponse(BaseModel):
    stocks: list[StockInfo]


class ModelInfoResponse(BaseModel):
    model_version: str
    trained_at: str | None = None
    test_auc: float | None = None
    is_mock: bool = Field(default=False, description="模型未載入時為 True")


class HealthResponse(BaseModel):
    status: Literal["ok"]
    model_loaded: bool


# --- 模型監控與例外報表（GET /api/monitor；規則見 docs/monitor_prereg.md）---


class MonitorDay(BaseModel):
    day: date
    ic: float | None = Field(description="當日線上 Rank IC；名數不足或沒有變異時為 null")
    n: int
    source: Literal["live", "pit"]
    sealed: bool = Field(default=False, description="這一天的排序列在預測窗口開始前就已串入存證鏈")
    before_training: bool = Field(default=False, description="基準日收盤時模型還沒訓練完成（只可能是事後重建）")


class IcGroup(BaseModel):
    n_days: int
    mean_ic: float | None
    t_nw: float | None = Field(description="平均 IC 對 0 的 Newey–West t")
    first_day: date | None
    last_day: date | None


class ModelHealth(BaseModel):
    version: str | None
    status: Literal["normal", "watch", "breakdown", "insufficient"]
    n_days: int = Field(description="IC 可算的已到期交易日數")
    n_live_days: int
    pending_rows: int = Field(description="尚未到期（不足 5 個交易日）的排序紀錄筆數")
    backtest_ic: float | None
    mean_ic: float | None
    se_nw: float | None = Field(description="Newey–West HAC 標準誤（Bartlett、落後 4 期）")
    t_skill: float | None = Field(description="線上平均 IC 對 0 的 t 值")
    t_breakdown: float | None = Field(description="（線上 − 回測）平均 IC 的 t 值；< −1.645 為失效警示")
    recent_mean_ic: float | None
    thresholds: dict[str, float | list[float]]
    daily: list[MonitorDay]
    groups: dict[str, IcGroup] = Field(
        default_factory=dict, description="live＝當日即時、pit＝事後重建、sealed＝預測窗口開始前已串入存證鏈；狀態判定照聲明用全部"
    )
    trained_at: str | None = Field(default=None, description="現行模型的訓練完成時間（ISO）")
    sealed_since: date | None = Field(default=None, description="第一個在預測窗口開始前就串入存證鏈的基準日")


class QuintileMove(BaseModel):
    ticker: str
    name: str
    rank_now: int
    rank_before: int
    q_now: int
    q_before: int
    tags: list[Literal["enter_top", "leave_top", "jump"]]


class QuintileMoves(BaseModel):
    from_date: date | None
    to_date: date | None
    n: int = Field(description="兩個基準日都有分數的股票數")
    moves: list[QuintileMove]


class Week52Extreme(BaseModel):
    ticker: str
    name: str
    to_high: float = Field(description="收盤價 ÷ 52 週最高價")


class LedgerStatus(BaseModel):
    available: bool = Field(description="取得到鏈檔才為 true")
    entries: int = 0
    chained: dict[str, int] = Field(default_factory=dict)
    pending: dict[str, int] = Field(default_factory=dict)
    ok: bool | None = None
    problems: list[str] = Field(default_factory=list)
    last_recorded_at: str | None = None


class LedgerLinkInfo(BaseModel):
    number: int = Field(description="第幾節，從 1 起算＝chain.jsonl 的第幾行")
    seq: int = Field(description="鏈節本身的 seq 欄位（從 0 起算，寫進雜湊）")
    recorded_at: str
    rows: dict[str, int]
    hash: str
    prev_hash: str
    run_id: str | None = None


class LedgerSnapshot(BaseModel):
    """存證鏈的狀態快照：每日排程在上鏈之後、部署之前匯出；網站只讀這一份。"""

    snapshot_at: str = Field(description="快照產生的時間（ISO UTC）")
    available: bool
    entries: int = 0
    ok: bool | None = None
    problems: list[str] = Field(default_factory=list)
    chained: dict[str, int] = Field(default_factory=dict)
    pending: dict[str, int] = Field(default_factory=dict)
    pending_base_dates: list[date] = Field(default_factory=list, description="尚未上鏈的列所屬的基準日")
    verified_through: date | None = Field(default=None, description="這一天（含）以前的基準日，資料列都已上鏈並通過驗證")
    head: LedgerLinkInfo | None = None
    first_recorded_at: str | None = None
    first_note: str | None = None


class MonitorResponse(BaseModel):
    base_date: date
    rules_version: str
    rules_doc: str
    model: ModelHealth
    quintile_moves: QuintileMoves
    new_highs: list[Week52Extreme]
    new_lows: list[Week52Extreme]
    ledger: LedgerStatus


# --- 篩選器與綜合評分（GET /api/screener；規則見 docs/screener_prereg.md）---

ConditionState = Literal["pass", "fail", "missing", "na"]


class ScreenerComponents(BaseModel):
    """各組成分數 0–100（股票池內的百分位）；null＝從缺。"""

    rank: float | None
    momentum: float | None
    valuation: float | None
    revenue: float | None
    chips: float | None


class ScreenerMetrics(BaseModel):
    rank_pct: float | None = Field(description="相對強弱排序的百分位（0–1）")
    ret20: float | None = Field(description="20 日報酬（以內部價格計算，只公開衍生值）")
    ret60: float | None
    breakout: bool | None = Field(description="收盤價高於前 60 個交易日的最高收盤價")
    ma_bullish: bool | None = Field(description="5 日均線 > 20 日均線 > 60 日均線")
    pe: float | None = Field(description="本益比；虧損或無法計算時為 null")
    earnings_yield: float | None
    dividend_yield: float | None = Field(description="現金殖利率（%）")
    pb: float | None
    book_to_price: float | None
    revenue_yoy: float | None = Field(description="最新月營收年增率（%）；金融保險業不計")
    revenue_cum_yoy: float | None
    margin_change: float | None = Field(description="融資餘額變化率；涵蓋日數見 sources.margin_days")
    big_holder_change: float | None = Field(description="千張大戶持股比例的週變化（百分點）")


class ScreenerStock(BaseModel):
    ticker: str
    name: str
    industry: str = Field(description="月營收表最近一次出現的那一列的產業別；兩個資料月份都沒有時為空字串")
    revenue_month: str | None = Field(default=None, description="這檔實際使用的營收月份 YYYY-MM；金融保險業不計、缺資料時為 null")
    composite: float | None = Field(description="綜合評分 0–100：依固定規則整理，不是預測")
    components: ScreenerComponents
    missing: list[str] = Field(description="從缺的組成（綜合評分在其他組成間重新正規化權重）")
    metrics: ScreenerMetrics
    conditions: dict[str, ConditionState] = Field(description="C1–C6；missing＝資料缺漏（算不符合）、na＝不適用")
    misses: int
    tier: Literal["T1", "T2", "T3"] | None
    over_cap: bool = Field(description="條件夠進某一層，但該層已滿額：不列入，也不移到下一層")


class ScreenerSources(BaseModel):
    prices: date | None
    valuation: date | None
    revenue: date | None = Field(description="最新一份月營收彙總表的出表日期")
    revenue_month: str | None = Field(description="最新一份的資料月份 YYYY-MM；還沒申報的公司沿用前一個月")
    margin: date | None
    margin_days: int = Field(description="融資餘額變化率實際涵蓋的交易日數（滿 5 日前會少於 5）")
    big_holder_weeks: list[date] = Field(description="大戶持股週變化用到的兩週；只有一週時沒有變化可算")


class ScreenerDataQuality(BaseModel):
    """月營收表是每日快照，只列出已申報的公司：這裡標出受影響的股票。"""

    industry_unknown: list[str] = Field(
        default_factory=list, description="最新資料月份與前一個月都沒有申報：產業別不明，營收條件算資料缺漏"
    )
    revenue_lagging: list[str] = Field(default_factory=list, description="還沒申報最新月份，營收沿用前一個月")
    revenue_month_counts: dict[str, int] = Field(default_factory=dict, description="各營收月份有幾檔在用（不含金融保險業）")


class ScreenerResponse(BaseModel):
    """篩選器與綜合評分：研究用的候選清單，不是預測，也不是投資建議。"""

    base_date: date
    rules_version: str
    rules_doc: str
    weights: dict[str, float]
    tier_caps: dict[str, int]
    sources: ScreenerSources
    counts: dict[str, int]
    data_quality: ScreenerDataQuality = Field(default_factory=ScreenerDataQuality)
    stocks: list[ScreenerStock]
    is_mock: bool = Field(default=False, description="排序模型未載入時為 True（排序組成全部從缺）")
