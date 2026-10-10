"use client";

/**
 * 模型監控與例外報表（規則見 docs/monitor_prereg.md；門檻依期刊文獻預先聲明）：
 * - 模型健康：線上逐日 Rank IC、Newey–West t、與回測比較的失效檢定（Giacomini & Rossi, 2009）
 * - 例外報表：排名分位遷移（5 個基準日）、52 週新高與新低（George & Hwang, 2004）
 * - 存證鏈：節數、已上鏈與尚未上鏈的列數、驗證結果與最新一節的雜湊；大盤結構與方向訊號的線上命中率
 * 只顯示、不自動處置；不是投資建議。
 */

import { useState, type ReactNode } from "react";
import LedgerPanel from "@/components/overview/LedgerPanel";
import MarketPanel from "@/components/overview/MarketPanel";
import Badge from "@/components/ui/Badge";
import { Notice, Skeleton } from "@/components/ui/Feedback";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import { api, ledgerHead, type MonitorResponse } from "@/lib/api";
import { fixed, share } from "@/lib/format";
import { LINKS } from "@/lib/links";
import { MODEL_STATUS } from "@/lib/status";
import { errorText, useAsync } from "@/lib/useAsync";

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="border-l border-border pl-3 first:border-l-0 first:pl-0 max-sm:[&:nth-child(3)]:border-l-0 max-sm:[&:nth-child(3)]:pl-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-0.5 text-lg font-semibold text-ink">{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-ink-3">{sub}</dd>}
    </div>
  );
}

/** y 軸刻度間距：依資料範圍取 0.05／0.1／0.2，讓刻度落在好讀的數字上 */
function icStep(bound: number): number {
  return bound > 0.4 ? 0.2 : bound > 0.2 ? 0.1 : 0.05;
}

/**
 * 逐日 Rank IC：以零軸為基準的上下長條，左邊是 y 軸刻度，虛線＝回測平均（標在圖右側，不壓在最新的長條上）；
 * 實色＝當日即時記錄、半透明＝事後重建。指到或點一下長條會顯示當天的數值，完整數值在下方的表格。
 */
function IcChart({ data }: { data: MonitorResponse["model"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const days = data.daily.filter((d) => d.ic != null);
  if (days.length === 0) return <p className="text-sm text-ink-3">還沒有到期的交易日。</p>;
  const raw = Math.max(0.1, ...days.map((d) => Math.abs(d.ic as number)), Math.abs(data.backtest_ic ?? 0));
  const step = icStep(raw);
  const bound = Math.ceil(raw / step - 1e-9) * step;
  const ticks = Array.from({ length: Math.round((2 * bound) / step) + 1 }, (_, i) => Number((bound - i * step).toFixed(4)));
  const digits = step < 0.1 ? 2 : 1;
  const y = (v: number) => 50 - (v / bound) * 50;
  const h = hover != null ? days[hover] : null;
  return (
    <div>
      <div className="flex gap-2">
        <div className="relative h-40 w-10 shrink-0 text-right text-xs text-ink-3" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(t)}%` }}>
              {t === 0 ? "0" : fixed(t, digits, true)}
            </span>
          ))}
        </div>
        <div
          className="relative h-40 flex-1"
          role="img"
          aria-label={`逐日線上 Rank IC，${days.length} 天，平均 ${fixed(data.mean_ic, 4, true)}；回測平均 ${fixed(data.backtest_ic, 4, true)}`}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <div key={t} className={`absolute inset-x-0 border-t ${t === 0 ? "border-border-strong" : "border-border"}`} style={{ top: `${y(t)}%` }} />
          ))}
          <div className="absolute inset-0 flex gap-px">
            {days.map((d, i) => {
              const v = d.ic as number;
              return (
                <div
                  key={d.day}
                  className={`relative h-full flex-1 ${hover === i ? "bg-surface-2" : ""}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                >
                  <span
                    className={`absolute inset-x-0 bg-accent ${v >= 0 ? "rounded-t-[2px]" : "rounded-b-[2px]"}`}
                    style={{ top: `${v >= 0 ? y(v) : 50}%`, height: `${Math.max((Math.abs(v) / bound) * 50, 0.5)}%`, opacity: d.source === "live" ? 1 : 0.45 }}
                  />
                </div>
              );
            })}
          </div>
          {data.backtest_ic != null && (
            <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-2" style={{ top: `${y(data.backtest_ic)}%` }} />
          )}
          {h && hover != null && (
            <div
              className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs shadow-(--shadow-pop)"
              style={{ left: `clamp(4.5rem, ${((hover + 0.5) / days.length) * 100}%, calc(100% - 4.5rem))` }}
            >
              <p className="text-ink-3">{h.day}</p>
              <p className="font-semibold text-ink">Rank IC {fixed(h.ic, 3, true)}</p>
              <p className="text-ink-3">
                {h.n} 檔，{h.source === "live" ? "當日即時記錄" : "事後重建"}
              </p>
            </div>
          )}
        </div>
        {data.backtest_ic != null && (
          <div className="relative h-40 w-16 shrink-0 text-xs text-ink-2" aria-hidden="true">
            <span className="absolute left-0 -translate-y-1/2 whitespace-nowrap" style={{ top: `${y(data.backtest_ic)}%` }}>
              回測 {fixed(data.backtest_ic, 3, true)}
            </span>
          </div>
        )}
      </div>
      <div className={`mt-1 flex justify-between pl-12 text-xs text-ink-3 ${data.backtest_ic != null ? "pr-[4.5rem]" : ""}`}>
        <span>{days[0].day}</span>
        <span>{days[days.length - 1].day}</span>
      </div>
      <p className="mt-1 text-xs text-ink-3">實色是當日即時記錄，半透明是事後重建；虛線是回測平均。</p>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-accent">看逐日數值</summary>
        <div className="relative mt-2 max-h-56 overflow-auto rounded-md border border-border">
          <table className="w-full text-table">
            <thead className="sticky top-0 bg-surface-2">
              <tr className="text-left text-ink-3">
                <th scope="col" className="px-3 py-1.5 font-medium">到期的基準日</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Rank IC</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">檔數</th>
                <th scope="col" className="px-3 py-1.5 font-medium">來源</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {[...days].reverse().map((d) => (
                <tr key={d.day}>
                  <td className="px-3 py-1 text-ink-2">{d.day}</td>
                  <td className="px-3 py-1 text-right text-ink">{fixed(d.ic, 3, true)}</td>
                  <td className="px-3 py-1 text-right text-ink-2">{d.n}</td>
                  <td className="px-3 py-1 text-ink-2">{d.source === "live" ? "當日即時" : "事後重建"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

function Names({ title, items, empty }: { title: string; items: { key: string; text: string }[]; empty: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-ink-2">
        {title}（{items.length}）
      </p>
      {items.length > 0 ? (
        <ul className="mt-1 flex flex-wrap gap-1.5">
          {items.map((i) => (
            <li key={i.key} className="rounded-md bg-surface-2 px-2 py-0.5 text-xs text-ink-2">
              {i.text}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-ink-3">{empty}</p>
      )}
    </div>
  );
}

export default function MonitorPage() {
  const monitor = useAsync("monitor", () => api.monitor());
  const market = useAsync("market", () => api.market());
  const record = useAsync("track-record", () => api.trackRecord());
  const head = useAsync("ledger-head", ledgerHead);

  const data = monitor.data;
  const m = data?.model;
  const status = m ? MODEL_STATUS[m.status] : null;
  const moves = data?.quintile_moves;
  const topSize = moves && moves.n ? Math.floor((moves.n - 1) / 5) + 1 : 0; // 第 1 分位的檔數
  const entered = moves?.moves.filter((x) => x.tags.includes("enter_top")) ?? [];
  const left = moves?.moves.filter((x) => x.tags.includes("leave_top")) ?? [];
  const jumps = moves?.moves.filter((x) => x.tags.includes("jump") && !x.tags.includes("enter_top") && !x.tags.includes("leave_top")) ?? [];
  const tr = record.data;

  return (
    <>
      <PageHeader
        title="監控"
        description={
          <>
            模型健康、例外報表與預測存證鏈。門檻與定義依
            <a href={LINKS.monitorRules} target="_blank" rel="noopener noreferrer" className="mx-1 font-medium text-accent hover:underline">
              預先聲明的規則
            </a>
            （依期刊文獻訂定，看到結果前就寫好）。警示只顯示，不會自動停用模型；本頁不是投資建議。
          </>
        }
      />

      {monitor.error && <Notice tone="error">{errorText(monitor.error, "監控資料由每日排程在收盤後產生，目前還沒有這一份。")}</Notice>}
      {monitor.loading && <Skeleton className="h-72 w-full" />}

      {data && m && status && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2 lg:items-start">
          <Panel
            className="lg:col-span-2"
            title="相對強弱排序模型的線上表現"
            description={`${status.note}。模型 ${m.version ?? "—"}，基準日 ${data.base_date}`}
            actions={
              <Badge tone={status.tone} icon={status.icon}>
                {status.text}
              </Badge>
            }
          >
            <dl className="grid grid-cols-2 gap-y-4 sm:grid-cols-4">
              <Stat label="線上平均 Rank IC" value={fixed(m.mean_ic, 4, true)} sub={`${m.n_days} 個到期日（當日即時 ${m.n_live_days}）`} />
              <Stat
                label="技能檢定 t（對 0）"
                value={fixed(m.t_skill, 2, true)}
                sub={`顯著門檻 ${m.thresholds.skill_t.map((t) => t.toFixed(1)).join("／")}`}
              />
              <Stat label="失效檢定 t（對回測）" value={fixed(m.t_breakdown, 2, true)} sub={`低於 ${m.thresholds.breakdown_t} 才警示；回測 ${fixed(m.backtest_ic, 4, true)}`} />
              <Stat label={`近 ${m.thresholds.recent_days} 日平均`} value={fixed(m.recent_mean_ic, 4, true)} sub="描述性，不是檢定" />
            </dl>
            <div className="mt-5">
              <IcChart data={m} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-3">
              t 值用 Newey–West 標準誤（落後 {m.thresholds.nw_lags} 期）：相鄰基準日的 5 日報酬互相重疊，逐日 IC 會自我相關，樸素 t 會高估顯著性。尚未到期的排序紀錄 {m.pending_rows} 筆。
            </p>
          </Panel>

          <Panel
            title="例外報表"
            description={`排名分位遷移：${moves?.from_date ?? "—"} → ${moves?.to_date ?? "—"}（5 個基準日，${moves?.n ?? 0} 檔分成五個分位）`}
          >
            {moves && moves.n > 0 && (
              <dl className="mb-4 grid grid-cols-2 gap-y-3">
                <Stat label="第 1 分位（前 20%）換手" value={`${left.length}／${topSize}`} sub="5 個基準日內離開的檔數" />
                <Stat label="分位變動 ≥ 2" value={`${moves.moves.filter((x) => x.tags.includes("jump")).length} 檔`} sub={`共 ${moves.n} 檔`} />
              </dl>
            )}
            <div className="space-y-3">
              <Names title="進入第 1 分位" items={entered.map((x) => ({ key: x.ticker, text: `${x.name} ${x.q_before}→${x.q_now}` }))} empty="沒有" />
              <Names title="離開第 1 分位" items={left.map((x) => ({ key: x.ticker, text: `${x.name} ${x.q_before}→${x.q_now}` }))} empty="沒有" />
              <Names title="其他分位變動 ≥ 2" items={jumps.map((x) => ({ key: x.ticker, text: `${x.name} ${x.q_before}→${x.q_now}` }))} empty="沒有" />
              <Names title="52 週新高" items={data.new_highs.map((x) => ({ key: x.ticker, text: x.name }))} empty="沒有" />
              <Names title="52 週新低" items={data.new_lows.map((x) => ({ key: x.ticker, text: x.name }))} empty="沒有" />
            </div>
          </Panel>

          <div className="space-y-5">
            <div id="ledger" className="scroll-mt-28">
              <LedgerPanel ledger={data.ledger} head={head.data} headFailed={head.error != null} />
            </div>
            <Panel title="方向訊號的線上命中率">
              {tr ? (
                <dl className="grid grid-cols-2 gap-y-3">
                  <Stat label="命中率" value={share(tr.hit_rate)} sub={`${tr.matured.toLocaleString()} 筆到期${tr.since ? `，自 ${tr.since}` : ""}`} />
                  <Stat label="等待到期" value={`${(tr.total - tr.matured).toLocaleString()} 筆`} sub="基準日後滿 5 個交易日才對照" />
                </dl>
              ) : (
                <Skeleton className="h-14 w-full" />
              )}
              <a className="mt-3 inline-block text-xs text-accent hover:underline" href={LINKS.onlineReport} target="_blank" rel="noopener noreferrer">
                與全猜「觀望」的基線比較（線上實證報告）
              </a>
            </Panel>
            <MarketPanel market={market.data} />
          </div>
        </div>
      )}
    </>
  );
}
