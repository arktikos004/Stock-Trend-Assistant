/**
 * 後端 API client — 型別對應 backend/stockta/api/schemas.py（Phase 0 凍結契約）。
 * 錯誤格式統一為 {"error": {"code", "message"}}；以 code 判斷錯誤類型，勿比對 message。
 */

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://localhost:8000";

/**
 * 靜態站模式（Cloudflare Pages）：沒有後端，改讀每日排程匯出的 /data/*.json
 * （backend/stockta/export_static.py）。帶參數的端點由下方 staticApi 在瀏覽器端切片，
 * 規則逐一對照後端路由；本機開發不設此變數，照舊呼叫 uvicorn。
 */
export const STATIC_DATA = process.env.NEXT_PUBLIC_STATIC_DATA === "1";
const DATA_BASE = "/data";

export type Signal = "漲" | "跌" | "觀望";
export type RiskLevel = "低" | "中" | "高";

export interface Candle {
  time: string; // YYYY-MM-DD
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface CandlesResponse {
  ticker: string;
  candles: Candle[];
}

export interface PredictionResponse {
  ticker: string;
  base_date: string;
  signal: Signal;
  confidence: number;
  risk: RiskLevel;
  model_version: string;
  is_mock: boolean;
  proba: Record<Signal, number> | null;
}

export interface IndicatorsResponse {
  ticker: string;
  as_of: string;
  rsi14: number;
  kd_k: number;
  kd_d: number;
  macd_hist: number;
  bb_pctb: number;
  bb_width: number;
  vol_ratio: number;
  ma_bias_5: number;
  ma_bias_20: number;
  ma_bias_60: number;
}

export interface MarketResponse {
  as_of: string;
  ret_1d: number;
  ret_5d: number;
  ma20_bias: number;
  vol20: number;
  breadth_up: number;
  breadth_ma5: number;
}

export interface PastPrediction {
  base_date: string;
  signal: Signal;
  confidence: number;
  model_version: string;
  actual: Signal | null;
  actual_return: number | null;
  hit: boolean | null;
}

export interface PredictionHistoryResponse {
  ticker: string;
  records: PastPrediction[];
}

/** 一組已到期的方向預測：命中率、同一批樣本的兩條基線與精度、95% block bootstrap 區間 */
export interface TrackSample {
  key: "all" | "before_window" | "after_window"; // 全部；預測窗口開始（下一個交易日開盤）前寫入；之後才寫入
  matured: number;
  hits: number;
  hit_rate: number | null;
  n_days: number;
  actual: Record<Signal, number>;
  baseline_hold: number | null; // 全猜「觀望」的命中率
  baseline_up: number | null; // 全猜「漲」的命中率
  precision: Record<Signal, { called: number; hits: number }>;
  ci_hit_rate: [number, number] | null;
  ci_excess_hold: [number, number] | null;
  ci_excess_up: [number, number] | null;
}

export interface TrackRecordResponse {
  total: number;
  matured: number;
  hits: number;
  hit_rate: number | null;
  since: string | null;
  samples?: TrackSample[]; // 舊版站上資料沒有
  bootstrap?: { block: number; replicates: number; seed: number } | null;
}

export interface HistoryRecord {
  date: string;
  signal: Signal;
  confidence: number;
  actual: Signal;
  actual_return: number | null;
  hit: boolean;
}

export interface StockHistoryResponse {
  ticker: string;
  start: string;
  end: string;
  count: number;
  hits: number;
  hit_rate: number | null;
  records: HistoryRecord[];
}

// --- 融資融券與大戶持股（/api/stocks/{t}/chips）：證交所、集保開放資料；margin_cost、maintenance_pct 是本站估算 ---

/** 一個交易日的融資融券（張）與同一天的證交所行情 */
export interface ChipsMarginDay {
  date: string;
  close: number | null; // 證交所收盤價（未還原權值）；當天沒有成交時為 null
  volume_lots: number | null; // 成交張數
  margin_buy: number | null;
  margin_sell: number | null;
  margin_redeem: number | null; // 融資現金償還
  margin_balance: number | null;
  margin_change: number | null; // 今日 − 前日餘額
  margin_limit: number | null;
  margin_usage_pct: number | null; // 融資使用率（%）
  short_sell: number | null;
  short_buy: number | null;
  short_redeem: number | null; // 融券現券償還
  short_balance: number | null;
  short_change: number | null;
  short_margin_pct: number | null; // 券資比（%）
  offset: number | null; // 資券互抵
  margin_cost: number | null; // 融資成本（本站估算）
  maintenance_pct: number | null; // 融資維持率（本站估算，%）
}

/** 一週的集保戶股權分散：比例（%）照集保公布的數字，變化是和前一份週資料相比 */
export interface ChipsHolderWeek {
  date: string;
  big_pct: number | null; // 千張大戶（分級 15）
  big_holders: number | null;
  big_pct_change: number | null; // 百分點
  big_holders_change: number | null;
  over400_pct: number | null; // 400 張以上（分級 12–15）
  over400_holders: number | null;
  over400_pct_change: number | null;
  over400_holders_change: number | null;
}

export interface ChipsSource {
  dataset: string;
  title: string; // 政府資料開放平臺上的資料集名稱
  provider: string;
  gov_id: number;
  dataset_url: string;
  source_urls: string[];
  attribution: string; // 政府資料開放授權條款要求的顯名聲明
}

export interface ChipsResponse {
  ticker: string;
  margin: ChipsMarginDay[]; // 由舊到新
  holders: ChipsHolderWeek[];
  meta: {
    margin_start: string | null; // 第一個有融資融券資料的交易日
    margin_end: string | null;
    cost_start: string | null; // 目前這段融資成本估算的起算日
    holders_start: string | null;
    holders_end: string | null;
    estimates: string[];
    estimate_label: string;
    margin_rate: number;
    sources: ChipsSource[];
    license: string;
    license_url: string;
  };
}

export interface RankResult {
  ticker: string;
  name: string;
  score: number;
  rank: number;
  percentile: number;
  quantile: "top" | "mid" | "bottom";
}

export interface RankResponse {
  base_date: string;
  model: string;
  is_historical: boolean;
  /** recorded＝資料庫裡已記錄（並串入存證鏈）的排序列；recomputed＝沒有紀錄，依當時可得資料重新評分。舊版站上資料沒有 */
  basis?: "recorded" | "recomputed";
  recorded_source?: "live" | "pit" | null; // recorded 時：每日排程記錄或事後重建
  recorded_on_time?: boolean | null; // recorded 時：都在預測窗口開始（下一個交易日開盤）前寫入。舊版站上資料沒有
  results: RankResult[];
  is_mock: boolean;
}

export interface RankSummaryResponse {
  available: boolean;
  model: string | null;
  test_rank_ic: number | null;
  test_rank_ic_t: number | null; // 樸素 t
  test_rank_ic_t_nw?: number | null; // Newey–West t；舊版站上資料沒有這個欄位
  // 期間（舊版站上資料沒有）：Rank IC 的測試期是 test_start～test_end；示意組合跑 val_start～test_end
  test_rank_ic_days?: number | null;
  test_start?: string | null;
  test_end?: string | null;
  val_start?: string | null;
  val_rank_ic: number | null;
  holding_days: number | null;
  net_cum: number | null;
  bench_cum: number | null;
  net_excess_cum: number | null;
  win_rate: number | null;
  cost_bps: number | null;
}

export interface ScanResult {
  ticker: string;
  name: string;
  signal: Signal;
  confidence: number;
  risk: RiskLevel | null;
  proba: Record<Signal, number>;
  actual: Signal | null;
  actual_return: number | null;
  hit: boolean | null;
}

export interface ScanResponse {
  base_date: string;
  model_version: string;
  is_historical: boolean;
  up: number;
  hold: number;
  down: number;
  matured: number;
  hits: number;
  results: ScanResult[];
  is_mock: boolean;
}

// --- 模型監控與例外報表（/api/monitor；規則見 docs/monitor_prereg.md）---

export interface IcGroup {
  n_days: number;
  mean_ic: number | null;
  t_nw: number | null; // 平均 IC 對 0 的 Newey–West t
  first_day: string | null;
  last_day: string | null;
}

/** 存證鏈的狀態快照（/api/ledger；每日排程在上鏈之後、部署之前匯出成 ledger.json） */
export interface LedgerSnapshot {
  snapshot_at: string; // ISO UTC
  available: boolean;
  entries: number;
  ok: boolean | null;
  problems: string[];
  chained: Record<string, number>;
  pending: Record<string, number>;
  pending_base_dates: string[];
  verified_through: string | null; // 這一天（含）以前的基準日都已上鏈並通過驗證
  head: {
    number: number; // 從 1 起算＝chain.jsonl 的第幾行
    seq: number; // 鏈節的 seq 欄位，從 0 起算
    recorded_at: string;
    rows: Record<string, number>;
    hash: string;
    prev_hash: string;
    run_id: string | null;
  } | null;
  first_recorded_at: string | null;
  first_note: string | null;
}

export type ModelStatus = "normal" | "watch" | "breakdown" | "insufficient";

export interface MonitorResponse {
  base_date: string;
  rules_version: string;
  rules_doc: string;
  model: {
    version: string | null;
    status: ModelStatus;
    n_days: number;
    n_live_days: number;
    pending_rows: number;
    backtest_ic: number | null;
    mean_ic: number | null;
    se_nw: number | null; // Newey–West HAC 標準誤
    t_skill: number | null;
    t_breakdown: number | null; // < thresholds.breakdown_t＝失效警示
    recent_mean_ic: number | null;
    thresholds: { breakdown_t: number; min_days: number; recent_days: number; nw_lags: number; skill_t: number[] };
    daily: {
      day: string;
      ic: number | null;
      n: number;
      source: "live" | "pit";
      on_time?: boolean; // 都在預測窗口開始（下一個交易日開盤）前寫入；舊版站上資料沒有
      sealed?: boolean; // 預測窗口開始前就已串入存證鏈
      before_training?: boolean; // 基準日收盤時模型還沒訓練完成
    }[];
    /** live＝即時記錄（窗口開始前寫入的 live 列）、pit＝事後重建或補寫、sealed＝預測窗口開始前已串入存證鏈。舊版站上資料沒有 */
    groups?: Record<"live" | "pit" | "sealed", IcGroup>;
    trained_at?: string | null;
    sealed_since?: string | null;
  };
  quintile_moves: {
    from_date: string | null;
    to_date: string | null;
    n: number;
    moves: {
      ticker: string;
      name: string;
      rank_now: number;
      rank_before: number;
      q_now: number;
      q_before: number;
      tags: ("enter_top" | "leave_top" | "jump")[];
    }[];
  };
  new_highs: { ticker: string; name: string; to_high: number }[];
  new_lows: { ticker: string; name: string; to_high: number }[];
  ledger: {
    available: boolean;
    entries: number;
    chained: Record<string, number>;
    pending: Record<string, number>;
    ok: boolean | null;
    problems: string[];
    last_recorded_at: string | null;
  };
}

// --- 簡單因子對照與可成交性（/api/monitor/baselines；規則見 docs/baseline_prereg.md）---

export interface IcStat {
  n_days: number;
  mean: number | null;
  t_nw: number | null; // 少於 2 天為 null
}

/** beyond＝排除反轉與動量後仍有資訊、negative＝排除後為負、indistinct＝無法區分、insufficient＝不足 20 天 */
export type NeutralVerdict = "beyond" | "negative" | "indistinct" | "insufficient";

export interface FactorBaseline {
  key: string;
  label: string;
  lookback: number; // 回看的交易日數
  ic: IcStat; // 因子自己的 Rank IC
  diff: IcStat; // 模型 IC − 因子 IC
  corr_mean: number | null; // 模型分數與因子的平均截面相關
}

export interface BaselinesResponse {
  base_date: string | null;
  rules_version: string;
  rules_doc: string;
  model_version: string | null;
  /** 各區塊算不出來時為 null，原因列在 failures */
  factors: {
    n_days: number;
    model: IcStat;
    neutral: IcGroup & { verdict: NeutralVerdict };
    factors: FactorBaseline[];
    thresholds: { verdict_t: number; hlz_t: number; min_days: number; min_names: number };
  } | null;
  tradable: { all: IcGroup; live: IcGroup } | null; // 報酬從 t+1 收盤起算
  days_needed: {
    status: "ok" | "insufficient";
    n_days: number;
    se_nw: number | null;
    backtest_ic: number | null;
    target_t: number;
    needed: number | null;
    remaining: number | null;
  } | null;
  quintiles: {
    n_days: number;
    first_day: string | null;
    last_day: string | null;
    top_mean: number | null;
    bottom_mean: number | null;
    pool_mean: number | null;
    spread_mean: number | null;
    spread_t: number | null;
  } | null;
  failures: string[];
}

// --- 篩選器與綜合評分（/api/screener；規則見 docs/screener_prereg.md）：研究用候選清單，不是預測 ---

export type ScreenerComponentKey = "rank" | "momentum" | "valuation" | "revenue" | "chips";
export type ConditionKey = "C1" | "C2" | "C3" | "C4" | "C5" | "C6";
/** missing＝資料缺漏（應該有卻沒有，算不符合）、na＝不適用（金融保險業的營收條件） */
export type ConditionState = "pass" | "fail" | "missing" | "na";
export type Tier = "T1" | "T2" | "T3";

export interface ScreenerStock {
  ticker: string;
  name: string;
  industry: string; // 產業別不明時為空字串
  revenue_month?: string | null; // 這檔實際使用的營收月份 YYYY-MM（金融保險業、缺資料時沒有）
  composite: number | null; // 0–100
  components: Record<ScreenerComponentKey, number | null>; // 股票池內的百分位 0–100
  missing: ScreenerComponentKey[];
  metrics: {
    rank_pct: number | null;
    ret20: number | null;
    ret60: number | null;
    breakout: boolean | null;
    ma_bullish: boolean | null;
    pe: number | null;
    earnings_yield: number | null;
    dividend_yield: number | null; // %
    pb: number | null;
    book_to_price: number | null;
    revenue_yoy: number | null; // %
    revenue_cum_yoy: number | null; // %
    margin_change: number | null; // 比率
    big_holder_change: number | null; // 百分點
  };
  conditions: Record<ConditionKey, ConditionState>;
  misses: number;
  tier: Tier | null;
  over_cap: boolean;
}

export interface ScreenerResponse {
  base_date: string;
  rules_version: string;
  rules_doc: string;
  weights: Record<ScreenerComponentKey, number>;
  tier_caps: Record<Tier, number>;
  sources: {
    prices: string | null;
    valuation: string | null;
    revenue: string | null;
    revenue_month: string | null;
    margin: string | null;
    margin_days: number;
    big_holder_weeks: string[];
  };
  counts: Record<Tier, number>;
  /** 月營收表只列出已申報的公司：哪些股票受影響。較舊的資料檔沒有這一欄 */
  data_quality?: {
    industry_unknown: string[]; // 兩個資料月份都沒有申報：產業別不明，營收條件算資料缺漏
    revenue_lagging: string[]; // 還沒申報最新月份，沿用前一個月
    revenue_month_counts: Record<string, number>;
  };
  stocks: ScreenerStock[];
  is_mock: boolean;
}

export interface StockInfo {
  ticker: string;
  name: string;
}

export interface ModelInfoResponse {
  model_version: string;
  trained_at: string | null;
  test_auc: number | null;
  is_mock: boolean;
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(path: string, base: string = API_BASE): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${base}${path}`);
  } catch {
    throw new ApiError(
      0,
      "NETWORK_ERROR",
      STATIC_DATA ? "資料暫時無法取得，請稍後再試" : "無法連線到後端服務，請確認 API 已啟動",
    );
  }
  if (!res.ok) {
    if (STATIC_DATA && res.status === 404) {
      throw new ApiError(404, "NOT_FOUND", "此項資料今日未產生（每日排程匯出時失敗）");
    }
    const body = await res.json().catch(() => null);
    const err = body?.error;
    throw new ApiError(res.status, err?.code ?? "UNKNOWN", err?.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<T>;
}

const liveApi = {
  stocks: () => request<{ stocks: StockInfo[] }>("/api/stocks"),
  candles: (ticker: string, range: string, start?: string, end?: string) => {
    const q =
      start && end
        ? `start=${start}&end=${end}`
        : `range=${range}`;
    return request<CandlesResponse>(`/api/stocks/${encodeURIComponent(ticker)}/candles?${q}`);
  },
  /** 全部已累積的 K 線：K 線圖的指標在完整序列上計算再切到畫面區間；5y 是後端最長的區間 */
  candleHistory: (ticker: string) =>
    request<CandlesResponse>(`/api/stocks/${encodeURIComponent(ticker)}/candles?range=5y`),
  prediction: (ticker: string) =>
    request<PredictionResponse>(`/api/stocks/${encodeURIComponent(ticker)}/prediction`),
  modelInfo: () => request<ModelInfoResponse>("/api/model"),
  indicators: (ticker: string) =>
    request<IndicatorsResponse>(`/api/stocks/${encodeURIComponent(ticker)}/indicators`),
  market: () => request<MarketResponse>("/api/market"),
  predictionHistory: (ticker: string) =>
    request<PredictionHistoryResponse>(`/api/stocks/${encodeURIComponent(ticker)}/predictions`),
  trackRecord: () => request<TrackRecordResponse>("/api/track-record"),
  scan: (date?: string) =>
    request<ScanResponse>(`/api/scan${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  rank: (date?: string) =>
    request<RankResponse>(`/api/rank${date ? `?date=${encodeURIComponent(date)}` : ""}`),
  rankSummary: () => request<RankSummaryResponse>("/api/rank/summary"),
  screener: () => request<ScreenerResponse>("/api/screener"),
  monitor: () => request<MonitorResponse>("/api/monitor"),
  // null 只出現在靜態站：這一版網站資料還沒有這個檔案
  baselines: (): Promise<BaselinesResponse | null> => request<BaselinesResponse>("/api/monitor/baselines"),
  ledger: () => request<LedgerSnapshot>("/api/ledger"),
  stockHistory: (ticker: string, start: string, end: string) =>
    request<StockHistoryResponse>(
      `/api/stocks/${encodeURIComponent(ticker)}/history?start=${start}&end=${end}`,
    ),
  // 股票池內的代號一定有回應（沒有資料時序列是空的）；null 只出現在靜態站（見 staticApi）
  chips: (ticker: string): Promise<ChipsResponse | null> =>
    request<ChipsResponse>(`/api/stocks/${encodeURIComponent(ticker)}/chips`),
};

/** 靜態站的匯出摘要（export_static.py 的 meta.json）。 */
export interface SiteMeta {
  generated_at: string; // ISO UTC
  last_trading_day: string; // API 推論錨點；candles 區間的終點
  data_as_of: string; // 實際最後一根 K 棒
  model_version: string;
  cs_model: string | null;
  range_days: Record<string, number>;
  /** K 線來源：每日累積的證交所開放資料（未還原權值；識別值沿用 twse-openapi）。舊版 site-data 沒有此欄＝yfinance，不得顯示 */
  candles_source?: string;
  candles_adjusted?: boolean;
  candles_start: string | null; // 已累積的第一個交易日；沒有資料時為 null
  candles_end?: string | null;
  history_start: string;
}

interface DatedIndex {
  latest: string;
  sessions: string[];
  dates: string[];
}

const staticGet = <T>(path: string) => request<T>(path, DATA_BASE);
const enc = encodeURIComponent;

// 每天只更新一次的檔案，一次瀏覽內只抓一次：狀態列與各頁共用同一個請求；失敗不快取，下次重試
const onceCache = new Map<string, Promise<unknown>>();
function staticOnce<T>(path: string): Promise<T> {
  let pending = onceCache.get(path) as Promise<T> | undefined;
  if (!pending) {
    pending = staticGet<T>(path).catch((e) => {
      onceCache.delete(path);
      throw e;
    });
    onceCache.set(path, pending);
  }
  return pending;
}

let metaPromise: Promise<SiteMeta> | null = null;
export function siteMeta(): Promise<SiteMeta> {
  metaPromise ??= staticGet<SiteMeta>("/meta.json").catch((e) => {
    metaPromise = null; // 失敗不快取，下次重試
    throw e;
  });
  return metaPromise;
}

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function assertOrdered(start: string, end: string) {
  if (start >= end) throw new ApiError(422, "INVALID_RANGE", `起日需早於迄日：${start} ~ ${end}`);
}

/** 靜態站保留的交易日（scan、rank 各自的 index.json）；給日期欄設上下限。本機 API 模式回 null。 */
export async function datedSessions(kind: "scan" | "rank"): Promise<string[] | null> {
  if (!STATIC_DATA) return null;
  const idx = await staticOnce<DatedIndex>(`/${kind}/index.json`);
  return idx.sessions;
}

/** scan/rank 查歷史某日：同 API，≥ 錨點日走即時；否則對齊到 ≤ 查詢日的最後一個交易日。 */
async function staticDated<T>(kind: "scan" | "rank", date?: string): Promise<T> {
  if (!date) return staticOnce<T>(`/${kind}/latest.json`);
  const [meta, idx] = await Promise.all([siteMeta(), staticOnce<DatedIndex>(`/${kind}/index.json`)]);
  if (date >= meta.last_trading_day) return staticOnce<T>(`/${kind}/latest.json`);
  const session = [...idx.sessions].reverse().find((d) => d <= date);
  if (!session) {
    throw new ApiError(422, "OUT_OF_RANGE", `靜態站保留最近 ${idx.sessions.length} 個交易日（${idx.sessions[0]} 起）`);
  }
  if (!idx.dates.includes(session)) {
    throw new ApiError(404, "NOT_FOUND", `${session} 的資料今日未產生（每日排程匯出時失敗）`);
  }
  return staticGet<T>(`/${kind}/${session}.json`);
}

/** 只顯示證交所開放資料：還沒有資料（或舊版 site-data 的 yfinance K 線已被移除）時沒有 K 線，由頁面顯示說明 */
const hasTwseCandles = (meta: SiteMeta): meta is SiteMeta & { candles_start: string } =>
  meta.candles_source === "twse-openapi" && !!meta.candles_start;

/** 證交所 K 線整檔；candles 與 candleHistory 共用同一次下載 */
const twseCandles = (ticker: string) => staticOnce<CandlesResponse>(`/stocks/${enc(ticker)}/candles-twse.json`);

export const staticApi: typeof liveApi = {
  stocks: () => staticOnce("/stocks.json"),
  candles: async (ticker, range, start, end) => {
    const meta = await siteMeta();
    if (!hasTwseCandles(meta)) return { ticker, candles: [] };
    const full = await twseCandles(ticker);
    let lo: string;
    let hi: string;
    if (start && end) {
      assertOrdered(start, end);
      if (start < meta.candles_start) {
        throw new ApiError(422, "OUT_OF_RANGE", `靜態站 K 線僅提供 ${meta.candles_start} 之後的資料`);
      }
      [lo, hi] = [start, end];
    } else {
      const days = meta.range_days[range];
      if (days == null) throw new ApiError(422, "INVALID_RANGE", `不支援的 range 參數: ${range}`);
      hi = meta.last_trading_day;
      lo = addDays(hi, -days);
    }
    // 後端 _slice 兩端皆含
    return { ticker: full.ticker, candles: full.candles.filter((c) => c.time >= lo && c.time <= hi) };
  },
  candleHistory: async (ticker) => {
    const meta = await siteMeta();
    if (!hasTwseCandles(meta)) return { ticker, candles: [] };
    const full = await twseCandles(ticker);
    return { ticker: full.ticker, candles: full.candles };
  },
  prediction: (ticker) => staticGet(`/stocks/${enc(ticker)}/prediction.json`),
  modelInfo: () => staticOnce("/model.json"),
  indicators: (ticker) => staticGet(`/stocks/${enc(ticker)}/indicators.json`),
  market: () => staticOnce("/market.json"),
  predictionHistory: (ticker) => staticGet(`/stocks/${enc(ticker)}/predictions.json`),
  trackRecord: () => staticOnce("/track-record.json"),
  scan: (date) => staticDated("scan", date),
  rank: (date) => staticDated("rank", date),
  rankSummary: () => staticOnce("/rank/summary.json"),
  screener: () => staticOnce("/screener/latest.json"),
  monitor: () => staticOnce("/monitor.json"),
  baselines: () =>
    staticOnce<BaselinesResponse>("/baselines.json").catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
  ledger: () => staticOnce("/ledger.json"),
  stockHistory: async (ticker, start, end) => {
    const [meta, full] = await Promise.all([
      siteMeta(),
      staticGet<StockHistoryResponse>(`/stocks/${enc(ticker)}/history.json`),
    ]);
    assertOrdered(start, end);
    if (start < meta.history_start) {
      throw new ApiError(422, "OUT_OF_RANGE", `靜態站僅提供 ${meta.history_start} 之後的歷史回放`);
    }
    // 後端 history_series 取 (start, end]、新到舊；命中率依篩選後重算。
    // 匯出檔從 history_start 起算指標暖機，與以使用者 start 起算的差異在
    // test_feature_parity 的 1e-4 容忍度內。
    const records = full.records.filter((r) => r.date > start && r.date <= end);
    const hits = records.filter((r) => r.hit).length;
    return {
      ticker: full.ticker,
      start,
      end,
      count: records.length,
      hits,
      hit_rate: records.length ? hits / records.length : null,
      records,
    };
  },
  // 非必要檔案：這一版網站資料沒有（新功能上線前、或當天匯出失敗）時回 null，面板顯示說明而不是錯誤
  chips: (ticker) =>
    staticGet<ChipsResponse>(`/stocks/${enc(ticker)}/chips.json`).catch((e: unknown) => {
      if (e instanceof ApiError && e.status === 404) return null;
      throw e;
    }),
};

export const api = STATIC_DATA ? staticApi : liveApi;

/** 存證快照；這一版網站資料還沒有（404）時回 null，頁面改用 monitor.json 的摘要 */
export function ledgerSnapshot(): Promise<LedgerSnapshot | null> {
  return api.ledger().catch((e: unknown) => {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  });
}
