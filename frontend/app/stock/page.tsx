"use client";

/**
 * 個股：報價列、日 K 線、5 日方向訊號、篩選器綜合評分、技術指標、新聞情緒、線上實證與歷史回放。
 * 代號放在網址（/stock?t=2330.TW），可以分享、重新整理不會跑掉。
 * 主資料失敗只影響該區塊；K 線取不到時說明原因，其他區塊照常顯示。
 */

import { SearchX, Star } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import CandleChart from "@/components/CandleChart";
import HistoryReplayCard from "@/components/HistoryReplayCard";
import IndicatorPanel from "@/components/IndicatorPanel";
import PredictionCard from "@/components/PredictionCard";
import ScoreBar from "@/components/screener/ScoreBar";
import SentimentCard from "@/components/SentimentCard";
import TrackRecordCard from "@/components/TrackRecordCard";
import Badge from "@/components/ui/Badge";
import { EmptyState, Notice, Skeleton } from "@/components/ui/Feedback";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import { api, siteMeta, STATIC_DATA, type Candle } from "@/lib/api";
import { code, fixed, pct, toneVar } from "@/lib/format";
import { COMPONENTS, TIER_TITLE } from "@/lib/screener";
import { errorText, useAsync } from "@/lib/useAsync";
import { toggleWatch, useWatchlist } from "@/lib/watchlist";

const RANGES = ["1mo", "3mo", "6mo", "1y", "2y", "5y"] as const;
type Range = (typeof RANGES)[number];
const RANGE_DAYS: Record<Range, number> = { "1mo": 30, "3mo": 90, "6mo": 180, "1y": 365, "2y": 730, "5y": 1825 };
const RANGE_LABEL: Record<Range, string> = { "1mo": "1 個月", "3mo": "3 個月", "6mo": "6 個月", "1y": "1 年", "2y": "2 年", "5y": "5 年" };
const DEFAULT_TICKER = "2330.TW";

/**
 * K 線只有證交所資料累積的那一段：較短的區間已涵蓋全部資料時，更長的區間畫出來一模一樣，
 * 所以只留「還看得到更多資料」的按鈕。不知道資料範圍（本機 API 模式）時全部顯示。
 */
function visibleRanges(span: { start: string; end: string } | null): Range[] {
  if (!span) return [...RANGES];
  const available = (Date.parse(span.end) - Date.parse(span.start)) / 86_400_000;
  return RANGES.filter((_, i) => i === 0 || RANGE_DAYS[RANGES[i - 1]] < available);
}

function Quote({ candles }: { candles: Candle[] | undefined }) {
  if (!candles || candles.length === 0) return <span className="text-sm text-ink-3">—</span>;
  const last = candles[candles.length - 1];
  const prev = candles.length > 1 ? candles[candles.length - 2] : null;
  const change = prev ? last.close / prev.close - 1 : null;
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-2xl font-semibold text-ink">{last.close.toLocaleString()}</span>
      <span className="text-sm font-semibold" style={{ color: toneVar(change) }}>
        {pct(change, 2)}
      </span>
      <span className="text-xs text-ink-3">{last.time} 收盤</span>
    </div>
  );
}

function StockView() {
  const params = useSearchParams();
  const ticker = params.get("t") ?? DEFAULT_TICKER;
  const watchlist = useWatchlist();
  const watched = watchlist.includes(ticker);

  const stocks = useAsync("stocks", () => api.stocks());
  const meta = useAsync(STATIC_DATA ? "meta" : null, siteMeta);
  const screener = useAsync("screener", () => api.screener());
  const rank = useAsync("rank", () => api.rank());
  const modelInfo = useAsync("model", () => api.modelInfo());
  const trackRecord = useAsync("track-record", () => api.trackRecord());
  const prediction = useAsync(`prediction|${ticker}`, () => api.prediction(ticker));
  const indicators = useAsync(`indicators|${ticker}`, () => api.indicators(ticker));
  const history = useAsync(`history|${ticker}`, () => api.predictionHistory(ticker));

  const span = meta.data?.candles_start ? { start: meta.data.candles_start, end: meta.data.candles_end ?? meta.data.data_as_of } : null;
  const ranges = visibleRanges(span);
  const [range, setRange] = useState<Range>("1y");
  const [custom, setCustom] = useState<{ start: string; end: string } | null>(null);
  const [draft, setDraft] = useState<{ start: string; end: string } | null>(null);
  const activeRange = ranges.includes(range) ? range : ranges[ranges.length - 1];
  const candles = useAsync(custom ? `candles|${ticker}|${custom.start}|${custom.end}` : `candles|${ticker}|${activeRange}`, () =>
    custom ? api.candles(ticker, activeRange, custom.start, custom.end) : api.candles(ticker, activeRange),
  );

  const info = stocks.data?.stocks.find((s) => s.ticker === ticker);
  const s = screener.data?.stocks.find((x) => x.ticker === ticker);
  const r = rank.data?.results.find((x) => x.ticker === ticker);

  if (stocks.data && !info) {
    return (
      <EmptyState
        icon={SearchX}
        title={`找不到代號「${ticker}」`}
        action={
          <Link href="/" className="mt-2 text-sm font-medium text-accent hover:underline">
            回到總覽
          </Link>
        }
      >
        本站只有台灣 50 成分股的資料。用頂列的搜尋輸入代號或名稱，例如 2330 或台積電。
      </EmptyState>
    );
  }

  const draftRange = draft ?? { start: span?.start ?? "", end: span?.end ?? "" };
  const inputClass = "h-9 rounded-md border border-border bg-surface px-2 text-sm text-ink focus:border-accent";

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            {info?.name ?? code(ticker)}
            <span className="text-lg font-normal text-ink-3">{code(ticker)}</span>
          </span>
        }
        description={s?.industry}
        actions={
          <button
            type="button"
            aria-pressed={watched}
            onClick={() => toggleWatch(ticker)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors duration-150 ${
              watched ? "border-warn/40 bg-warn-soft text-ink" : "border-border text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <Star size={15} className={watched ? "fill-current text-warn" : ""} aria-hidden="true" />
            {watched ? "已加入自選" : "加入自選"}
          </button>
        }
      />

      <dl className="mb-5 grid grid-cols-2 gap-x-6 gap-y-3 rounded-lg border border-border bg-surface px-4 py-3 sm:grid-cols-4">
        <div className="col-span-2 sm:col-span-1">
          <dt className="text-xs text-ink-3">證交所收盤</dt>
          <dd>{candles.loading ? <Skeleton className="mt-1 h-7 w-32" /> : <Quote candles={candles.data?.candles} />}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">相對強弱名次</dt>
          <dd className="mt-0.5 flex items-center gap-2 text-sm text-ink">
            {r ? (
              <>
                <span className="text-lg font-semibold">{r.rank}</span>／{rank.data?.results.length}
                <Badge tone={r.quantile === "top" ? "up" : r.quantile === "bottom" ? "down" : "hold"}>
                  {r.quantile === "top" ? "強" : r.quantile === "bottom" ? "弱" : "中"}
                </Badge>
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">篩選器</dt>
          <dd className="mt-0.5 flex items-center gap-2 text-sm text-ink">
            {s ? (
              <>
                <span className="text-lg font-semibold">{fixed(s.composite, 0)}</span> 分
                {s.tier ? <Badge tone="neutral">{s.tier}</Badge> : <span className="text-xs text-ink-3">未列入候選</span>}
              </>
            ) : (
              "—"
            )}
          </dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">5 日方向訊號</dt>
          <dd className="mt-0.5 text-lg font-semibold" style={{ color: prediction.data ? `var(--${prediction.data.signal === "漲" ? "up" : prediction.data.signal === "跌" ? "down" : "hold"})` : undefined }}>
            {prediction.data?.signal ?? "—"}
          </dd>
        </div>
      </dl>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <Panel
          title="日 K 線"
          actions={
            <Segmented
              label="K 線區間"
              size="sm"
              value={custom ? ("custom" as Range) : activeRange}
              onChange={(v) => {
                setCustom(null);
                setRange(v);
              }}
              options={ranges.map((x) => ({ value: x, label: RANGE_LABEL[x] }))}
            />
          }
        >
          <form
            className="mb-3 flex flex-wrap items-end gap-2 text-xs text-ink-3"
            onSubmit={(e) => {
              e.preventDefault();
              if (draftRange.start && draftRange.end) setCustom(draftRange);
            }}
          >
            <label className="flex flex-col gap-1">
              自訂起日
              <input
                type="date"
                className={inputClass}
                value={draftRange.start}
                min={span?.start}
                max={draftRange.end || span?.end}
                onChange={(e) => setDraft({ ...draftRange, start: e.target.value })}
              />
            </label>
            <label className="flex flex-col gap-1">
              迄日
              <input
                type="date"
                className={inputClass}
                value={draftRange.end}
                min={draftRange.start || span?.start}
                max={span?.end}
                onChange={(e) => setDraft({ ...draftRange, end: e.target.value })}
              />
            </label>
            <button type="submit" className="h-9 rounded-md border border-border px-3 text-sm font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink">
              套用區間
            </button>
            {custom && (
              <button type="button" onClick={() => setCustom(null)} className="h-9 px-2 text-sm text-accent hover:underline">
                清除自訂區間
              </button>
            )}
          </form>

          {candles.loading ? (
            <Skeleton className="h-[380px] w-full" />
          ) : candles.error ? (
            <Notice>{errorText(candles.error, "這一檔的 K 線還沒有資料。")}</Notice>
          ) : candles.data && candles.data.candles.length > 0 ? (
            <CandleChart candles={candles.data.candles} />
          ) : (
            <EmptyState title="這段區間沒有 K 線資料">K 線使用臺灣證券交易所開放資料，自 {span?.start ?? "2026-10-02"} 起逐日累積。</EmptyState>
          )}
          <p className="mt-2 text-xs text-ink-3">
            資料來源：臺灣證券交易所開放資料（盤後資訊，未還原權值）。開放資料只提供最新一個交易日，本站自 {span?.start ?? "2026-10-02"} 起逐日累積。
          </p>
        </Panel>

        <div className="space-y-5">
          <Panel title="未來 5 個交易日的方向訊號">
            {prediction.error ? (
              <Notice>{errorText(prediction.error, "這一檔的預測還沒有產生。")}</Notice>
            ) : prediction.data ? (
              <PredictionCard prediction={prediction.data} testAuc={modelInfo.data?.test_auc ?? null} />
            ) : (
              <Skeleton className="h-56 w-full" />
            )}
          </Panel>

          <Panel
            title="篩選器綜合評分"
            description={screener.data ? `規則 ${screener.data.rules_version}，基準日 ${screener.data.base_date}` : undefined}
          >
            {s && screener.data ? (
              <>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="text-2xl font-semibold text-ink">{fixed(s.composite, 0)}</span>
                  <span className="text-xs text-ink-2">{s.tier ? `${s.tier}：${TIER_TITLE[s.tier]}` : `未列入候選（不符合 ${s.misses} 項）`}</span>
                </div>
                <ScoreBar stock={s} weights={screener.data.weights} className="mt-2 h-2.5" />
                <dl className="mt-3 grid grid-cols-5 gap-1 text-center">
                  {COMPONENTS.map((c) => (
                    <div key={c.key}>
                      <dt className="flex items-center justify-center gap-1 text-xs text-ink-3">
                        <span className="inline-block size-2 rounded-[2px]" style={{ background: c.color }} aria-hidden="true" />
                        {c.label}
                      </dt>
                      <dd className="text-sm text-ink-2">{fixed(s.components[c.key], 0)}</dd>
                    </div>
                  ))}
                </dl>
                <Link href={`/screener?t=${encodeURIComponent(ticker)}`} className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
                  看條件與入選理由
                </Link>
              </>
            ) : screener.error ? (
              <p className="text-sm text-ink-3">{errorText(screener.error, "篩選器的資料還沒有產生。")}</p>
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
          </Panel>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-1 gap-5 md:grid-cols-2">
        <Panel title="技術指標">
          {indicators.data ? (
            <IndicatorPanel indicators={indicators.data} />
          ) : indicators.error ? (
            <p className="text-sm text-ink-3">{errorText(indicators.error, "這一檔的技術指標還沒有產生。")}</p>
          ) : (
            <Skeleton className="h-64 w-full" />
          )}
        </Panel>
        <Panel title="新聞情緒">
          <SentimentCard twTicker={ticker} />
        </Panel>
      </div>

      <div className="mt-5 space-y-5">
        <Panel title={`線上預測實證（${ticker}）`}>
          <TrackRecordCard ticker={ticker} records={history.data?.records ?? []} trackRecord={trackRecord.data ?? null} />
        </Panel>
        <Panel title={`歷史預測回放（${ticker}）`}>
          <HistoryReplayCard ticker={ticker} minDate={meta.data?.history_start} maxDate={meta.data?.data_as_of} />
        </Panel>
      </div>
    </>
  );
}

export default function StockPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <StockView />
    </Suspense>
  );
}
