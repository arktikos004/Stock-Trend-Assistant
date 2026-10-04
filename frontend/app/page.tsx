"use client";

/**
 * 主儀表板：代號搜尋 → K 線圖 ＋ 預測卡（三類機率）＋ 熱門標的總覽 ＋ 技術指標
 * ＋ 大盤情境 ＋ 新聞情緒（跨專案）＋ 線上預測實證 ＋ 模型資訊列。
 * 主資料（K 線/預測）失敗顯示錯誤橫幅；次要卡片各自降級，不影響主頁。
 */

import { useCallback, useEffect, useState } from "react";
import CandleChart from "@/components/CandleChart";
import IndicatorPanel from "@/components/IndicatorPanel";
import HistoryReplayCard from "@/components/HistoryReplayCard";
import MarketCard from "@/components/MarketCard";
import NavTabs from "@/components/NavTabs";
import PredictionCard from "@/components/PredictionCard";
import SentimentCard from "@/components/SentimentCard";
import ThemeToggle from "@/components/ThemeToggle";
import TickerSearch from "@/components/TickerSearch";
import TrackRecordCard from "@/components/TrackRecordCard";
import WatchlistSignals from "@/components/WatchlistSignals";
import {
  api,
  ApiError,
  siteMeta,
  STATIC_DATA,
  type Candle,
  type IndicatorsResponse,
  type MarketResponse,
  type ModelInfoResponse,
  type PastPrediction,
  type PredictionResponse,
  type StockInfo,
  type TrackRecordResponse,
} from "@/lib/api";

const RANGES = ["1mo", "3mo", "6mo", "1y", "2y", "5y"] as const;
type Range = (typeof RANGES)[number];
const RANGE_DAYS: Record<Range, number> = { "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825 };
/** 開始逐日累積證交所盤後資料的第一個交易日（OpenAPI 只提供當日，之前的日子無法回補） */
const TWSE_SINCE = "2026-10-02";

/**
 * K 線只有證交所資料累積的那一段：上一個較短的區間已涵蓋全部資料時，更長的區間畫出來一模一樣，
 * 所以只留「還看得到更多資料」的按鈕。不知道資料範圍（本機 API 模式）時全部顯示。
 */
function visibleRanges(span: { start: string; end: string } | null): Range[] {
  if (!span) return [...RANGES];
  const available = (Date.parse(span.end) - Date.parse(span.start)) / 86_400_000;
  return RANGES.filter((_, i) => i === 0 || RANGE_DAYS[RANGES[i - 1]] < available);
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

/** K 線自訂日期區間；套用後覆蓋預設 range，清除則回預設。 */
function CustomRangeRow({
  custom,
  onApply,
}: {
  custom: { start: string; end: string } | null;
  onApply: (v: { start: string; end: string } | null) => void;
}) {
  const [start, setStart] = useState(custom?.start ?? isoDaysAgo(365));
  const [end, setEnd] = useState(custom?.end ?? isoDaysAgo(0));
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-ink-3">
      <span>自訂區間</span>
      <input
        type="date"
        value={start}
        onChange={(e) => setStart(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-ink outline-none focus:border-accent"
      />
      <span>~</span>
      <input
        type="date"
        value={end}
        onChange={(e) => setEnd(e.target.value)}
        className="rounded-md border border-border bg-surface px-2 py-1 text-ink outline-none focus:border-accent"
      />
      <button
        type="button"
        onClick={() => onApply({ start, end })}
        className="rounded-md bg-accent px-2.5 py-1 font-semibold text-accent-fg transition hover:opacity-90"
      >
        套用
      </button>
      {custom && (
        <button
          type="button"
          onClick={() => onApply(null)}
          className="rounded-md bg-surface-2 px-2.5 py-1 font-medium text-ink-2 transition hover:text-ink"
        >
          清除
        </button>
      )}
    </div>
  );
}

function Card({ title, children, className = "", action }: {
  title?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}) {
  return (
    <section className={`rounded-2xl border border-border bg-surface p-5 shadow-(--shadow-sm) ${className}`}>
      {title && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink-2">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** 分組標題帶：帶出「區塊 ＞ 卡片標題」的層級。左 accent 短條＋右細分隔線。 */
function SectionHeading({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`mb-4 flex items-center gap-3 ${className}`}>
      <span className="h-4 w-1 rounded-full bg-accent" />
      <h2 className="text-sm font-semibold tracking-tight text-ink">{children}</h2>
      <span className="h-px flex-1 bg-border" />
    </div>
  );
}

export default function Home() {
  const [stocks, setStocks] = useState<StockInfo[]>([]);
  const [ticker, setTicker] = useState("2330.TW");
  const [range, setRange] = useState<Range>("1y");
  const [candleSpan, setCandleSpan] = useState<{ start: string; end: string } | null>(null);
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);
  const [candles, setCandles] = useState<Candle[] | null>(null);
  const [candleNote, setCandleNote] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<PredictionResponse | null>(null);
  const [modelInfo, setModelInfo] = useState<ModelInfoResponse | null>(null);
  const [indicators, setIndicators] = useState<IndicatorsResponse | null>(null);
  const [market, setMarket] = useState<MarketResponse | null>(null);
  const [history, setHistory] = useState<PastPrediction[]>([]);
  const [trackRecord, setTrackRecord] = useState<TrackRecordResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.stocks().then((r) => setStocks(r.stocks)).catch(() => setStocks([]));
    api.modelInfo().then(setModelInfo).catch(() => setModelInfo(null));
    api.market().then(setMarket).catch(() => setMarket(null));
    api.trackRecord().then(setTrackRecord).catch(() => setTrackRecord(null));
    if (STATIC_DATA) {
      siteMeta()
        .then((m) => m.candles_start && setCandleSpan({ start: m.candles_start, end: m.candles_end ?? m.last_trading_day }))
        .catch(() => {});
    }
  }, []);

  const ranges = visibleRanges(candleSpan);
  // 預設的 1y 若因資料還短而被隱藏，改用看得到的最長區間
  const activeRange = ranges.includes(range) ? range : ranges[ranges.length - 1];
  const twseSince = candleSpan?.start ?? TWSE_SINCE;

  const load = useCallback(
    async (t: string, r: string, c: { start: string; end: string } | null) => {
      setLoading(true);
      setError(null);
      api.indicators(t).then(setIndicators).catch(() => setIndicators(null));
      api.predictionHistory(t).then((h) => setHistory(h.records)).catch(() => setHistory([]));
      try {
        // K 線取不到（例如證交所資料尚未累積到這個區間）不該連帶讓預測顯示失敗：獨立接住
        const candlesReq = (c ? api.candles(t, r, c.start, c.end) : api.candles(t, r)).catch((e) => {
          setCandleNote(e instanceof ApiError ? e.message : null);
          return { ticker: t, candles: [] as Candle[] };
        });
        setCandleNote(null);
        const [cd, p] = await Promise.all([candlesReq, api.prediction(t)]);
        setCandles(cd.candles);
        setPrediction(p);
      } catch (e) {
        setCandles(null);
        setPrediction(null);
        if (e instanceof ApiError) {
          setError(e.status === 503 ? `資料源暫時無法使用：${e.message}` : e.message);
        } else {
          setError("發生未知錯誤");
        }
      } finally {
        setLoading(false);
      }
    },
    [],
  );

  useEffect(() => {
    load(ticker, activeRange, custom);
  }, [ticker, activeRange, custom, load]);

  const stockName = stocks.find((s) => s.ticker === ticker)?.name ?? "";

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <header className="mb-6 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-(--shadow-md)">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M3 3v18h18" />
                <path d="M19 9l-5 5-4-4-3 3" />
              </svg>
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight sm:text-2xl">台股趨勢預測助理</h1>
              <p className="mt-0.5 text-sm text-ink-3">深度學習 · 技術指標 · 市場情境 · 台灣 50</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <NavTabs current="dashboard" />
            <ThemeToggle />
          </div>
        </div>
        <TickerSearch stocks={stocks} selected={ticker} onSelect={setTicker} />
      </header>

      {error && (
        <div
          className="mb-6 rounded-xl border px-4 py-3 text-sm"
          style={{ borderColor: "var(--up)", background: "var(--up-soft)", color: "var(--up)" }}
        >
          {error}
        </div>
      )}

      <SectionHeading>市場總覽</SectionHeading>

      <div className="grid gap-5 md:grid-cols-2">
        {market && <div className="animate-fadeup"><MarketCard market={market} /></div>}
        <Card title="熱門標的預測總覽" className="animate-fadeup">
          <WatchlistSignals stocks={stocks} selected={ticker} onSelect={setTicker} />
        </Card>
      </div>

      <SectionHeading className="mt-8">個股判斷</SectionHeading>

      <div className="grid gap-5 lg:grid-cols-[2fr_1fr]">
        <Card
          className="animate-fadeup"
          title={`${stockName} ${ticker}`}
          action={
            <div className="flex gap-1">
              {ranges.map((r) => (
                <button
                  key={r}
                  type="button"
                  onClick={() => {
                    setCustom(null);
                    setRange(r);
                  }}
                  className="rounded-md px-2.5 py-1 text-xs font-medium transition"
                  style={
                    r === activeRange && !custom
                      ? { background: "var(--accent)", color: "var(--accent-fg)" }
                      : { background: "var(--surface-2)", color: "var(--ink-2)" }
                  }
                >
                  {r}
                </button>
              ))}
            </div>
          }
        >
          <CustomRangeRow custom={custom} onApply={setCustom} />
          {loading ? (
            <div className="flex h-[380px] items-center justify-center text-sm text-ink-3">載入中…</div>
          ) : candles && candles.length > 0 ? (
            <>
              <CandleChart candles={candles} />
              <p className="mt-2 text-[11px] text-ink-3">
                資料來源：臺灣證券交易所 OpenAPI 盤後資料（未還原權值）。證交所只提供當日資料，本站自 {twseSince} 起逐日累積。
              </p>
            </>
          ) : !error ? (
            <div className="flex h-[380px] flex-col items-center justify-center gap-1 px-6 text-center text-sm text-ink-3">
              <span>此區間尚無 K 線資料</span>
              <span className="text-[11px]">
                K 線改用臺灣證券交易所開放資料，自 {twseSince} 起逐日累積{candleNote ? `（${candleNote}）` : ""}。
              </span>
            </div>
          ) : null}
        </Card>

        <aside className="space-y-5">
          {!loading && prediction && (
            <div className="animate-fadeup">
              <PredictionCard prediction={prediction} testAuc={modelInfo?.test_auc ?? null} />
            </div>
          )}
          {loading && (
            <div className="flex h-64 items-center justify-center rounded-2xl border border-border text-sm text-ink-3">
              載入中…
            </div>
          )}
        </aside>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        {indicators && <div className="animate-fadeup"><IndicatorPanel indicators={indicators} /></div>}
        <div className="animate-fadeup"><SentimentCard twTicker={ticker} /></div>
      </div>

      <SectionHeading className="mt-8">模型實證</SectionHeading>

      <div className="space-y-5">
        <div className="animate-fadeup">
          <TrackRecordCard ticker={ticker} records={history} trackRecord={trackRecord} />
        </div>

        <div className="animate-fadeup">
          <HistoryReplayCard ticker={ticker} />
        </div>

        {modelInfo && !modelInfo.is_mock && (
          <div className="flex flex-wrap items-center justify-center gap-x-6 gap-y-1 rounded-xl border border-border bg-surface-2 px-4 py-2.5 text-[11px] text-ink-3">
            <span>模型版本 {modelInfo.model_version}</span>
            {modelInfo.test_auc != null && <span>測試集 Macro AUC {modelInfo.test_auc.toFixed(4)}</span>}
            <span>決策規則：方向訊號信心未達門檻時轉為觀望（驗證期校準）</span>
          </div>
        )}
      </div>

      <footer className="mt-8 space-y-1 text-center text-xs text-ink-3">
        <p>基於深度學習之股價趨勢預測與投資助理系統 — 研究原型，僅供學術研究參考，不構成投資建議</p>
        <p>
          K 線資料：臺灣證券交易所 OpenAPI，依
          <a className="underline" href="https://data.gov.tw/license" target="_blank" rel="noopener noreferrer">
            政府資料開放授權條款
          </a>
          釋出；模型訓練用的歷史價格僅供內部研究，不對外提供。
        </p>
        <p>
          圖表：
          <a className="underline" href="https://www.tradingview.com/" target="_blank" rel="noopener noreferrer">
            TradingView Lightweight Charts™
          </a>
        </p>
      </footer>
    </main>
  );
}
