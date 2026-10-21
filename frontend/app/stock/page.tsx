"use client";

/**
 * 個股：報價列、日 K 線、相對強弱排序（主模型）、5 日方向訊號、篩選器綜合評分、融資融券與大戶持股、技術指標、新聞情緒、
 * 線上實證與歷史回放。
 * 從總覽或排序頁點進來的人要先看到主模型的結果，所以右欄第一個面板是相對強弱排序。
 * 代號放在網址（/stock?t=2330.TW），可以分享、重新整理不會跑掉。
 * 主資料失敗只影響該區塊；K 線取不到時說明原因，其他區塊照常顯示。
 */

import { SearchX, Star } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import CandleChart, { ChartSkeleton } from "@/components/CandleChart";
import ChipsPanel from "@/components/ChipsPanel";
import HistoryReplayCard from "@/components/HistoryReplayCard";
import IndicatorPanel from "@/components/IndicatorPanel";
import PredictionCard from "@/components/PredictionCard";
import Magnitude from "@/components/rank/Magnitude";
import SkillBanner from "@/components/rank/SkillBanner";
import Hint from "@/components/ui/Hint";
import SentimentCard from "@/components/SentimentCard";
import { sentimentTickerFor } from "@/lib/newsApi";
import TrackRecordCard from "@/components/TrackRecordCard";
import Badge from "@/components/ui/Badge";
import { EmptyState, Notice, Skeleton } from "@/components/ui/Feedback";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import { api, siteMeta, STATIC_DATA, type Candle } from "@/lib/api";
import { code, fixed, pct, share, toneVar } from "@/lib/format";
import { COMPONENTS, compositePercentiles, TIER_TITLE } from "@/lib/screener";
import { QUANTILE } from "@/lib/status";
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
      <span className="text-[30px] font-light leading-none text-ink">{last.close.toLocaleString()}</span>
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
  // 均線與指標在全部已累積的 K 線上計算，再切到所選區間
  const candleHistory = useAsync(`candle-history|${ticker}`, () => api.candleHistory(ticker));

  const info = stocks.data?.stocks.find((s) => s.ticker === ticker);
  const adr = sentimentTickerFor(ticker);
  const s = screener.data?.stocks.find((x) => x.ticker === ticker);
  const sPercentile = screener.data && s ? compositePercentiles(screener.data.stocks).get(ticker) : undefined;
  const r = rank.data?.results.find((x) => x.ticker === ticker);

  if (stocks.data && !info) {
    return (
      <EmptyState
        icon={SearchX}
        title={`找不到代號「${ticker}」`}
        action={
          <Link href="/" className="mt-2 text-sm font-medium link">
            回到總覽
          </Link>
        }
      >
        本站只有台灣 50 成分股的資料。用頂列的搜尋輸入代號或名稱，例如 2330 或台積電。
      </EmptyState>
    );
  }

  const draftRange = draft ?? { start: span?.start ?? "", end: span?.end ?? "" };
  const inputClass = "hairline-b h-9 bg-transparent px-0 text-sm text-ink focus:border-b-accent-mark";

  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-baseline gap-x-3">
            {info?.name ?? code(ticker)}
            <span className="text-lg font-normal text-ink-3">{code(ticker)}</span>
          </span>
        }
        description={
          <span className="flex flex-wrap items-center gap-x-1.5">
            {s?.industry}
            <Hint to="reading" label="這一頁的數字">
              <p>相對強弱名次、方向訊號、篩選器回答三個不同的問題，結果可能不一致；都是研究用的統計輸出，不構成投資建議。</p>
            </Hint>
          </span>
        }
        actions={
          <button
            type="button"
            aria-pressed={watched}
            onClick={() => toggleWatch(ticker)}
            className={`inline-flex h-9 items-center gap-1.5 rounded-[3px] border px-3 text-sm font-medium transition-colors duration-150 ${
              watched ? "border-border-strong text-ink" : "border-border text-ink-2 hover:bg-surface-2 hover:text-ink"
            }`}
          >
            <Star size={15} className={watched ? "fill-current" : ""} aria-hidden="true" />
            {watched ? "已加入自選" : "加入自選"}
          </button>
        }
      />

      <dl className="hairline-t hairline-b mb-14 grid grid-cols-2 gap-x-8 gap-y-5 py-6 lg:grid-cols-4">
        <div className="col-span-2 lg:col-span-1">
          <dt className="text-xs text-ink-3">證交所收盤</dt>
          <dd>{candles.loading ? <Skeleton className="mt-1 h-7 w-32" /> : <Quote candles={candles.data?.candles} />}</dd>
        </div>
        <div>
          <dt className="text-xs text-ink-3">相對強弱名次</dt>
          <dd className="mt-0.5 flex items-center gap-2 text-sm text-ink">
            {r ? (
              <>
                <span className="text-lg font-semibold">{r.rank}</span>／{rank.data?.results.length}
                <span className="text-xs text-ink-2">{QUANTILE[r.quantile]}</span>
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

      {/* 大螢幕兩欄兩列：第一列是 K 線與主模型（相對強弱、方向訊號），第二列左邊是模型輸入的技術指標與篩選器，右邊是融資融券與新聞情緒。
          元素順序就是手機單欄的順序，也是鍵盤與螢幕閱讀器的順序 */}
      <div className="grid grid-cols-1 gap-x-14 gap-y-14 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)] lg:items-start">
        <Panel
          title="日 K 線"
          actions={
            <span className="flex items-center gap-1">
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
            <Hint to="chart" anchor="warmup" label="K 線">
              <p>證交所開放資料，未還原權值，自 {span?.start ?? "2026-10-02"} 起逐日累積；資料累積到足夠的交易日才畫指標。均線、指標與放量標記是價量計算，不是模型訊號。</p>
            </Hint>
            </span>
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
            <button type="submit" className="h-9 rounded-[3px] border border-border-strong px-3 text-sm text-ink transition-colors duration-150 hover:bg-surface-2">
              套用區間
            </button>
            {custom && (
              <button type="button" onClick={() => setCustom(null)} className="h-9 px-2 text-sm link">
                清除自訂區間
              </button>
            )}
          </form>

          {candles.loading ? (
            <ChartSkeleton />
          ) : candles.error ? (
            <Notice>{errorText(candles.error, "這一檔的 K 線還沒有資料。")}</Notice>
          ) : candles.data && candles.data.candles.length > 0 ? (
            <CandleChart candles={candles.data.candles} history={candleHistory.data?.candles} />
          ) : (
            <EmptyState title="這段區間沒有 K 線資料">K 線使用臺灣證券交易所開放資料，自 {span?.start ?? "2026-10-02"} 起逐日累積。</EmptyState>
          )}
        </Panel>

        <div className="space-y-14">
          <Panel
            title="相對強弱排序"
            description={rank.data ? `基準日 ${rank.data.base_date}，預測未來 5 個交易日` : undefined}
            actions={
              <Hint to="rank" anchor="groups" label="相對強弱排序">
                <p>相對排名靠前，仍可能下跌；分數是贏過中位數的模型機率，沒有校準。候選資格另依篩選條件判定。</p>
              </Hint>
            }
          >
            {r && rank.data ? (
              <>
                <div className="mb-3">
                  <SkillBanner variant="box" />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm text-ink-2">
                    第 <span className="text-[32px] font-light text-ink">{r.rank}</span> 名，共 {rank.data.results.length} 檔
                  </p>
                  <span className="text-xs text-ink-2">{QUANTILE[r.quantile]}</span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <Magnitude percentile={r.percentile} />
                  <span className="text-sm text-ink-2">模型分數 {r.score.toFixed(3)}，星等依百分位</span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 hairline-t pt-3 text-sm">
                  <div>
                    <dt className="text-xs text-ink-3">百分位</dt>
                    <dd className="text-ink">{share(r.percentile)}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink-3">篩選層級</dt>
                    <dd className="text-ink">{s ? (s.tier ? `${s.tier}：${TIER_TITLE[s.tier]}` : "未列入候選") : "—"}</dd>
                  </div>
                </dl>
                <Link href="/scan" className="mt-2 inline-block text-xs font-medium link">
                  看全部 {rank.data.results.length} 檔的排序
                </Link>
              </>
            ) : rank.error ? (
              <p className="text-sm text-ink-3">{errorText(rank.error, "今日相對強弱排序還沒有產生。")}</p>
            ) : rank.data ? (
              <p className="text-sm text-ink-3">這一檔不在今日排序裡。</p>
            ) : (
              <Skeleton className="h-36 w-full" />
            )}
          </Panel>

          <Panel title="未來 5 個交易日的方向訊號">
            {prediction.error ? (
              <Notice>{errorText(prediction.error, "這一檔的預測還沒有產生。")}</Notice>
            ) : prediction.data ? (
              <PredictionCard prediction={prediction.data} testAuc={modelInfo.data?.test_auc ?? null} />
            ) : (
              <Skeleton className="h-56 w-full" />
            )}
          </Panel>
        </div>

        <div className="space-y-14">
          <Panel title="模型輸入的技術指標">
            {indicators.data ? (
              <IndicatorPanel indicators={indicators.data} />
            ) : indicators.error ? (
              <p className="text-sm text-ink-3">{errorText(indicators.error, "這一檔的技術指標還沒有產生。")}</p>
            ) : (
              <Skeleton className="h-64 w-full" />
            )}
          </Panel>

          <Panel
            title="篩選器綜合評分"
            description={screener.data ? `規則 ${screener.data.rules_version}，基準日 ${screener.data.base_date}` : undefined}
          >
            {s && screener.data ? (
              <>
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-3">
                    {sPercentile != null && <Magnitude percentile={sPercentile} />}
                    <span className="text-[32px] font-light leading-none text-ink">{fixed(s.composite, 0)}</span>
                  </span>
                  <span className="text-xs text-ink-2">{s.tier ? `${s.tier}：${TIER_TITLE[s.tier]}` : `未列入候選（不符合 ${s.misses} 項）`}</span>
                </div>
                <dl className="mt-4 grid grid-cols-5 gap-1 text-center">
                  {COMPONENTS.map((c) => (
                    <div key={c.key}>
                      <dt className="text-xs text-ink-3">{c.label}</dt>
                      <dd className="text-sm text-ink-2">{fixed(s.components[c.key], 0)}</dd>
                    </div>
                  ))}
                </dl>
                <Link href={`/screener?t=${encodeURIComponent(ticker)}`} className="mt-3 inline-block text-xs font-medium link">
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

        <div className="space-y-14">
          <ChipsPanel ticker={ticker} />

          {adr.isProxy ? null : (
            <Panel title={`對應 ADR 的新聞情緒（${adr.ticker}）`}>
              <SentimentCard twTicker={ticker} />
            </Panel>
          )}
        </div>
      </div>

      <div className="mt-14 grid grid-cols-1 gap-x-14 gap-y-14 lg:grid-cols-2 lg:items-start">
        <Panel title={`線上預測實證（${ticker}）`}>
          <TrackRecordCard ticker={ticker} records={history.data?.records ?? []} trackRecord={trackRecord.data ?? null} />
        </Panel>
        <Panel title={`歷史預測回放（${ticker}）`}>
          <HistoryReplayCard ticker={ticker} minDate={meta.data?.history_start} maxDate={meta.data?.data_as_of} />
        </Panel>
      </div>

      {adr.isProxy && (
        <details className="hairline-t hairline-b mt-14">
          <summary className="cursor-pointer py-4 font-serif text-[15px] font-semibold text-ink">跨市場背景：美股科技大盤（QQQ）的新聞情緒</summary>
          <div className="hairline-t py-4">
            <p className="mb-2 text-sm text-ink-2">{info?.name ?? code(ticker)} 沒有美股 ADR，新聞站也沒有它的英文新聞；這裡只是美股科技大盤的背景，不是這家公司的新聞。</p>
            <SentimentCard twTicker={ticker} compact />
          </div>
        </details>
      )}
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
