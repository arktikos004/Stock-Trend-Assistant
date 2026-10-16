"use client";

/**
 * 個股頁的「融資融券與大戶持股」：證交所融資融券與集保股權分散表的最新值、融資與融券餘額的小折線圖，
 * 以及逐日明細（圖的表格版，附資料來源的顯名）。融資成本與維持率是本站估算，一律標「估」。
 * 兩個餘額的大小差好幾個數量級，所以畫成上下兩格、各自的刻度，不用雙 Y 軸。
 * 這一版網站資料沒有這一檔（null）或還沒有累積到資料時顯示說明，不是錯誤。
 */

import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent, type RefObject } from "react";
import { EmptyState, Skeleton } from "@/components/ui/Feedback";
import HelpLink from "@/components/ui/HelpLink";
import Panel from "@/components/ui/Panel";
import { api, type ChipsMarginDay, type ChipsResponse } from "@/lib/api";
import { count, latest, linePath, nearestIndex, niceTicks, percent, pp, price, sourceLine } from "@/lib/chips";
import { errorText, useAsync } from "@/lib/useAsync";

function Stat({ label, value, unit, note }: { label: string; value: string; unit?: string; note?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5">
        <span className="text-lg font-semibold text-ink">{value}</span>
        {unit && <span className="ml-1 text-sm text-ink-2">{unit}</span>}
        {note && <span className="block text-xs text-ink-3">{note}</span>}
      </dd>
    </div>
  );
}

function Item({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div>
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="text-sm font-semibold text-ink">
        {value}
        {note && <span className="block text-xs font-normal text-ink-3">{note}</span>}
      </dd>
    </div>
  );
}

function useWidth(ref: RefObject<HTMLDivElement | null>) {
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry.contentRect.width)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [ref]);
  return width;
}

const PANES = [
  { key: "margin_balance", label: "融資餘額（張）" },
  { key: "short_balance", label: "融券餘額（張）" },
] as const;
const TITLE_H = 18; // 每一格上方的標題列
const PLOT_H = 52;
const GAP = 12;
const AXIS_H = 18; // 最下面的日期
const GUTTER = 54; // 右側的刻度
const INSET = 6; // 線的左右內縮：兩端的圓點不會被切掉
const HEIGHT = (TITLE_H + PLOT_H) * PANES.length + GAP * (PANES.length - 1) + AXIS_H;
const shortDate = (iso: string) => iso.slice(5).replace("-", "/");

/** 融資餘額、融券餘額的逐日折線（上下兩格）：指標或左右鍵移動十字線，數值在提示框與下方的逐日明細 */
function BalanceTrend({ days }: { days: ChipsMarginDay[] }) {
  const ref = useRef<HTMLDivElement>(null);
  const width = useWidth(ref);
  const [active, setActive] = useState<number | null>(null);
  const n = days.length;
  const plotW = Math.max(0, width - GUTTER - INSET * 2);
  const xAt = (i: number) => INSET + (n > 1 ? (i / (n - 1)) * plotW : plotW / 2);
  const shown = active == null ? null : days[active];

  const pointTo = (e: PointerEvent<HTMLDivElement>) => {
    const left = e.currentTarget.getBoundingClientRect().left;
    setActive(nearestIndex(e.clientX - left - INSET, plotW, n));
  };
  const keyTo = (e: KeyboardEvent<HTMLDivElement>) => {
    const steps: Record<string, (i: number) => number> = {
      ArrowLeft: (i) => i - 1,
      ArrowRight: (i) => i + 1,
      Home: () => 0,
      End: () => n - 1,
    };
    const step = steps[e.key];
    if (!step) return;
    e.preventDefault();
    setActive((i) => Math.min(n - 1, Math.max(0, step(i ?? n - 1))));
  };

  return (
    <div
      ref={ref}
      tabIndex={0}
      role="group"
      aria-label={`融資餘額與融券餘額的逐日折線，${days[0].date} 至 ${days[n - 1].date} 共 ${n} 個交易日；左右鍵逐日檢視，數值也列在下方的逐日明細`}
      className="relative mt-3 select-none rounded-sm"
      style={{ height: HEIGHT }}
      onPointerMove={pointTo}
      onPointerDown={pointTo}
      onPointerLeave={(e) => {
        if (e.pointerType === "mouse") setActive(null); // 觸控放開手指也會觸發：留著提示框，點別處（失焦）再收起
      }}
      onFocus={() => setActive((i) => i ?? n - 1)}
      onBlur={() => setActive(null)}
      onKeyDown={keyTo}
    >
      {width > 0 && (
        <svg width={width} height={HEIGHT} aria-hidden="true" className="block overflow-visible">
          {PANES.map((pane, p) => {
            const top = p * (TITLE_H + PLOT_H + GAP);
            const values = days.map((d) => d[pane.key]);
            const present = values.filter((v): v is number => v != null);
            const ticks = niceTicks(Math.min(...present), Math.max(...present));
            const lo = ticks[0];
            const hi = ticks[ticks.length - 1];
            const { points, segments } = ticks.length ? linePath(values, { width: plotW, height: PLOT_H, lo, hi }) : { points: [], segments: [] };
            const mark = active == null ? points[n - 1] : points[active]; // 十字線所在的那一天；沒有十字線時標最新一天
            return (
              <g key={pane.key}>
                <text x={0} y={top + 12} fontSize={12} fill="var(--ink-2)">
                  {pane.label}
                </text>
                <g transform={`translate(${INSET}, ${top + TITLE_H})`}>
                  {active != null && (
                    <line
                      x1={xAt(active) - INSET}
                      x2={xAt(active) - INSET}
                      y1={0}
                      y2={PLOT_H}
                      stroke="var(--border-strong)"
                      strokeWidth={1}
                      shapeRendering="crispEdges"
                    />
                  )}
                  {ticks.map((t) => {
                    const y = PLOT_H - ((t - lo) / (hi - lo || 1)) * PLOT_H;
                    return (
                      <g key={t}>
                        <line x1={-INSET} x2={plotW + INSET} y1={y} y2={y} stroke="var(--border)" strokeWidth={1} shapeRendering="crispEdges" />
                        <text x={plotW + INSET + 6} y={y} dy="0.32em" fontSize={11} fill="var(--ink-3)">
                          {count(t)}
                        </text>
                      </g>
                    );
                  })}
                  {segments.map((d) => (
                    <path key={d} d={d} fill="none" stroke="var(--series-1)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
                  ))}
                  {mark && <circle cx={mark.x} cy={mark.y} r={4} fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} />}
                </g>
              </g>
            );
          })}
          <g fontSize={11} fill="var(--ink-3)">
            {n > 1 ? (
              <>
                <text x={INSET} y={HEIGHT - 4}>
                  {shortDate(days[0].date)}
                </text>
                <text x={INSET + plotW} y={HEIGHT - 4} textAnchor="end">
                  {shortDate(days[n - 1].date)}
                </text>
              </>
            ) : (
              <text x={xAt(0)} y={HEIGHT - 4} textAnchor="middle">
                {shortDate(days[0].date)}
              </text>
            )}
          </g>
        </svg>
      )}
      {shown && active != null && (
        <div
          className="pointer-events-none absolute z-10 rounded-md border border-border bg-surface-2 px-2.5 py-1.5 text-xs leading-relaxed whitespace-nowrap shadow-[var(--shadow-pop)]"
          style={{
            top: TITLE_H,
            left: xAt(active),
            transform: xAt(active) > plotW / 2 ? "translateX(calc(-100% - 8px))" : "translateX(8px)",
          }}
        >
          <div className="text-ink-3">{shown.date}</div>
          <div>
            <span className="font-semibold text-ink">{count(shown.margin_balance)}</span> <span className="text-ink-2">張 融資餘額</span>
          </div>
          <div>
            <span className="font-semibold text-ink">{count(shown.short_balance)}</span> <span className="text-ink-2">張 融券餘額</span>
          </div>
        </div>
      )}
      <p className="sr-only" aria-live="polite">
        {shown ? `${shown.date}：融資餘額 ${count(shown.margin_balance)} 張，融券餘額 ${count(shown.short_balance)} 張` : ""}
      </p>
    </div>
  );
}

// 圖上的兩個餘額排最前面（手機上不必橫捲就看得到），買賣明細在後
const TABLE_COLUMNS: { label: string; value: (d: ChipsMarginDay) => string }[] = [
  { label: "融資餘額", value: (d) => count(d.margin_balance) },
  { label: "融資增減", value: (d) => count(d.margin_change, true) },
  { label: "融券餘額", value: (d) => count(d.short_balance) },
  { label: "融券增減", value: (d) => count(d.short_change, true) },
  { label: "融資成本（估）", value: (d) => price(d.margin_cost) },
  { label: "維持率（估）", value: (d) => percent(d.maintenance_pct, 1) },
  { label: "收盤", value: (d) => price(d.close) },
  { label: "成交張數", value: (d) => count(d.volume_lots) },
  { label: "融資買進", value: (d) => count(d.margin_buy) },
  { label: "融資賣出", value: (d) => count(d.margin_sell) },
  { label: "現金償還", value: (d) => count(d.margin_redeem) },
  { label: "融券賣出", value: (d) => count(d.short_sell) },
  { label: "融券買進", value: (d) => count(d.short_buy) },
  { label: "現券償還", value: (d) => count(d.short_redeem) },
  { label: "資券互抵", value: (d) => count(d.offset) },
];

/** 逐日明細（新到舊）：圖的表格版，也是資料來源顯名的位置 */
function DailyTable({ data }: { data: ChipsResponse }) {
  return (
    <details className="mt-3 rounded-md border border-border">
      <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink-2 hover:text-ink">逐日明細與資料來源</summary>
      <div className="border-t border-border px-3 pb-3">
        {data.margin.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full whitespace-nowrap text-table">
              <caption className="sr-only">逐日融資融券（單位：張），新到舊；融資成本與維持率為本站估算</caption>
              <thead>
                <tr className="text-xs text-ink-3">
                  <th scope="col" className="sticky left-0 bg-surface py-2 pr-3 text-left font-normal">
                    日期
                  </th>
                  {TABLE_COLUMNS.map((c) => (
                    <th key={c.label} scope="col" className="py-2 pl-3 text-right font-normal">
                      {c.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {[...data.margin].reverse().map((d) => (
                  <tr key={d.date} className="border-t border-border">
                    <th scope="row" className="sticky left-0 bg-surface py-1.5 pr-3 text-left font-normal text-ink-2">
                      {d.date}
                    </th>
                    {TABLE_COLUMNS.map((c) => (
                      <td key={c.label} className="py-1.5 pl-3 text-right text-ink">
                        {c.value(d)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="mt-2 text-xs leading-relaxed text-ink-3">
          {sourceLine(data)}
          <a className="ml-1 underline hover:text-ink" href={data.meta.license_url} target="_blank" rel="noopener noreferrer">
            授權條款
          </a>
        </p>
      </div>
    </details>
  );
}

function ChipsBody({ data }: { data: ChipsResponse }) {
  const { day, week, prevWeek } = latest(data);
  const start = data.meta.margin_start ?? data.meta.holders_start;
  const holderNote = (change: number | null, holders: number | null) =>
    [change != null && `${pp(change)} 百分點`, holders != null && `${count(holders)} 人`].filter(Boolean).join("，") || undefined;
  return (
    <>
      {day && (
        <>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3">
            <Stat label="融資餘額" value={count(day.margin_balance)} unit="張" note={`較前日 ${count(day.margin_change, true)}`} />
            <Stat label="融券餘額" value={count(day.short_balance)} unit="張" note={`較前日 ${count(day.short_change, true)}`} />
          </dl>
          <BalanceTrend days={data.margin} />
          <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2.5 border-t border-border pt-3">
            <Item label="融資使用率" value={percent(day.margin_usage_pct)} />
            <Item label="券資比" value={percent(day.short_margin_pct)} />
            <Item label="融資成本（估）" value={price(day.margin_cost)} note={data.meta.cost_start ? `自 ${data.meta.cost_start} 起算` : undefined} />
            <Item label="融資維持率（估）" value={percent(day.maintenance_pct, 1)} />
            <Item label="資券互抵" value={`${count(day.offset)} 張`} />
            <Item label="成交張數" value={`${count(day.volume_lots)} 張`} />
          </dl>
        </>
      )}
      {week && (
        <div className={day ? "mt-3 border-t border-border pt-3" : ""}>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2.5">
            <Item label="千張大戶持股" value={percent(week.big_pct)} note={holderNote(week.big_pct_change, week.big_holders)} />
            <Item label="400 張以上持股" value={percent(week.over400_pct)} note={holderNote(week.over400_pct_change, week.over400_holders)} />
          </dl>
          <p className="mt-1.5 text-xs text-ink-3">
            集保資料日 {week.date}
            {prevWeek ? `；增減與 ${prevWeek} 相比` : ""}
          </p>
        </div>
      )}
      <p className="mt-3 text-sm leading-relaxed text-ink-2">
        證交所、集保開放資料，自 {start} 起逐日累積；成本與維持率為{data.meta.estimate_label}。
        <HelpLink to="chips" className="ml-1" />
      </p>
      <DailyTable data={data} />
    </>
  );
}

export default function ChipsPanel({ ticker }: { ticker: string }) {
  const chips = useAsync(`chips|${ticker}`, () => api.chips(ticker));
  const data = chips.data;
  const { day, week } = data ? latest(data) : { day: null, week: null };
  return (
    <Panel
      title="融資融券與大戶持股"
      description={day ? `資料日 ${day.date}` : week ? `集保資料日 ${week.date}` : undefined}
    >
      {chips.loading ? (
        <Skeleton className="h-72 w-full" />
      ) : chips.error ? (
        <p className="text-sm text-ink-3">{errorText(chips.error, "這一檔的融資融券資料還沒有產生。")}</p>
      ) : !data ? (
        <EmptyState title="這一檔的融資融券資料還沒有產生">融資融券與集保資料由每日排程匯出，下一次更新後就會出現。</EmptyState>
      ) : !day && !week ? (
        <EmptyState title="還沒有這一檔的融資融券資料">證交所、集保開放資料只提供最新一期，本站從開始累積的那天起才有資料。</EmptyState>
      ) : (
        <ChipsBody data={data} />
      )}
    </Panel>
  );
}
