"use client";

/**
 * 模型監控與例外報表（規則見 docs/monitor_prereg.md；門檻依期刊文獻預先聲明）：
 * - 模型健康：線上逐日 Rank IC、Newey–West t、與回測比較的失效檢定（Giacomini & Rossi, 2009）
 * - 例外報表：排名分位遷移（5 個基準日）、52 週新高與新低（George & Hwang, 2004）
 * - 存證鏈：節數、已上鏈與尚未上鏈的列數、驗證結果；大盤結構與絕對方向的線上命中率
 * 只顯示、不自動處置；不是投資建議。
 */

import { type CSSProperties, type ReactNode, useEffect, useState } from "react";
import NavTabs from "@/components/NavTabs";
import ThemeToggle from "@/components/ThemeToggle";
import {
  api,
  ApiError,
  type MarketResponse,
  type ModelStatus,
  type MonitorResponse,
  type TrackRecordResponse,
} from "@/lib/api";

const RULES_URL = "https://github.com/arktikos004/Stock-Trend-Assistant/blob/master/docs/monitor_prereg.md";
const LEDGER_URL = "https://github.com/arktikos004/Stock-Trend-Assistant/tree/ledger";

const STATUS: Record<ModelStatus, { text: string; note: string; style: CSSProperties }> = {
  normal: { text: "正常", note: "線上表現沒有顯著差於回測", style: { background: "var(--accent-soft)", color: "var(--accent)" } },
  watch: { text: "留意", note: "最近 20 個到期日的平均 Rank IC 為負（描述性提示，不是檢定）", style: { background: "var(--hold-soft)", color: "var(--ink)" } },
  breakdown: { text: "失效警示", note: "線上 Rank IC 顯著低於回測（單尾 5%）", style: { background: "var(--ink)", color: "var(--surface)" } },
  insufficient: { text: "資料不足", note: "已到期的交易日不足 20 天，不判定", style: { background: "var(--surface-2)", color: "var(--ink-3)" } },
};

const fmt = (v: number | null | undefined, digits = 4, signed = true) =>
  v == null ? "—" : `${signed && v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(digits)}`;
const pct = (v: number | null | undefined, digits = 1) => (v == null ? "—" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v * 100).toFixed(digits)}%`);

function Tile({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="rounded-xl bg-surface-2 px-3 py-2.5">
      <p className="text-xs text-ink-3">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-ink">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-ink-3">{sub}</p>}
    </div>
  );
}

/** 逐日 Rank IC：單一數列的上下長條（零軸為基準），水平線＝回測平均 IC。 */
function IcChart({ data }: { data: MonitorResponse["model"] }) {
  const days = data.daily.filter((d) => d.ic != null);
  if (days.length === 0) return <p className="text-sm text-ink-3">還沒有到期的交易日。</p>;
  const bound = Math.max(0.1, ...days.map((d) => Math.abs(d.ic as number)), Math.abs(data.backtest_ic ?? 0));
  const y = (v: number) => 50 - (v / bound) * 50; // 0 在中間（%）
  return (
    <div>
      <div className="relative h-40" role="img" aria-label={`逐日線上 Rank IC，${days.length} 天，平均 ${fmt(data.mean_ic)}`}>
        <div className="absolute inset-x-0 border-t border-border" style={{ top: "50%" }} />
        {data.backtest_ic != null && (
          <div className="absolute inset-x-0 border-t border-ink-3" style={{ top: `${y(data.backtest_ic)}%` }} />
        )}
        <div className="absolute inset-0 flex gap-[2px]">
          {days.map((d) => {
            const v = d.ic as number;
            const top = v >= 0 ? y(v) : 50;
            const height = (Math.abs(v) / bound) * 50;
            return (
              <div key={d.day} className="relative h-full flex-1" title={`${d.day}：Rank IC ${fmt(v, 3)}（${d.n} 檔，${d.source === "live" ? "當日即時記錄" : "事後重建"}）`}>
                <span
                  className={`absolute inset-x-0 bg-accent ${v >= 0 ? "rounded-t-[4px]" : "rounded-b-[4px]"}`}
                  style={{ top: `${top}%`, height: `${Math.max(height, 0.5)}%`, opacity: d.source === "live" ? 1 : 0.55 }}
                />
              </div>
            );
          })}
        </div>
      </div>
      <div className="mt-1 flex justify-between text-[11px] text-ink-3">
        <span>{days[0].day}</span>
        <span>{days[days.length - 1].day}</span>
      </div>
      <p className="mt-1 text-[11px] text-ink-3">
        深色＝當日即時記錄、淺色＝事後重建；橫線＝回測平均 {fmt(data.backtest_ic, 4)}，中線＝0
      </p>
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
            <li key={i.key} className="rounded-full bg-surface-2 px-2 py-0.5 text-xs text-ink-2">
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
  const [data, setData] = useState<MonitorResponse | null>(null);
  const [market, setMarket] = useState<MarketResponse | null>(null);
  const [record, setRecord] = useState<TrackRecordResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .monitor()
      .then((d) => !cancelled && setData(d))
      .catch((e) => {
        if (cancelled) return;
        if (e instanceof ApiError && e.status === 404) setError("監控資料由每日排程（收盤後）產生，目前還沒有這一份。");
        else setError(e instanceof ApiError ? e.message : "讀取失敗，請重新整理");
      });
    api.market().then((m) => !cancelled && setMarket(m)).catch(() => {});
    api.trackRecord().then((r) => !cancelled && setRecord(r)).catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const m = data?.model;
  const moves = data?.quintile_moves;
  const topSize = moves && moves.n ? Math.floor((moves.n - 1) / 5) + 1 : 0; // 第 1 分位的檔數
  const entered = moves?.moves.filter((x) => x.tags.includes("enter_top")) ?? [];
  const left = moves?.moves.filter((x) => x.tags.includes("leave_top")) ?? [];
  const jumps = moves?.moves.filter((x) => x.tags.includes("jump") && !x.tags.includes("enter_top") && !x.tags.includes("leave_top")) ?? [];

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-(--shadow-md)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 12h4l3-8 4 16 3-8h4" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">台股趨勢預測助理</h1>
            <p className="mt-0.5 text-sm text-ink-3">監控 · 模型健康、例外報表與存證鏈</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NavTabs current="monitor" />
          <ThemeToggle />
        </div>
      </header>

      <p className="mb-5 rounded-2xl border border-border bg-surface p-4 text-sm text-ink-2 shadow-(--shadow-sm)">
        門檻與定義依
        <a href={RULES_URL} target="_blank" rel="noopener noreferrer" className="mx-1 font-medium text-accent hover:underline">
          預先聲明的規則
        </a>
        （依期刊文獻訂定，看結果前就寫好）。警示只顯示、不自動停用模型；本頁不是投資建議。
      </p>

      {error && <div className="mb-5 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-ink-2">{error}</div>}
      {!data && !error && (
        <div className="flex h-48 items-center justify-center rounded-2xl border border-border text-sm text-ink-3">讀取中…</div>
      )}

      {data && m && (
        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-2xl border border-border bg-surface p-5 shadow-(--shadow-sm) lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-ink">相對強弱排序模型的線上表現</h2>
              <span className="rounded-full px-3 py-1 text-xs font-semibold" style={STATUS[m.status].style}>
                {STATUS[m.status].text}
              </span>
            </div>
            <p className="mt-1 text-xs text-ink-3">
              {STATUS[m.status].note}。模型 {m.version ?? "—"} · 基準日 {data.base_date}
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Tile
                label="線上平均 Rank IC"
                value={fmt(m.mean_ic)}
                sub={`${m.n_days} 個到期日（當日即時 ${m.n_live_days}）`}
              />
              <Tile
                label="技能檢定 t（對 0）"
                value={fmt(m.t_skill, 2)}
                sub={`顯著門檻 ${m.thresholds.skill_t.map((t) => t.toFixed(1)).join("／")}`}
              />
              <Tile
                label="失效檢定 t（對回測）"
                value={fmt(m.t_breakdown, 2)}
                sub={`低於 ${m.thresholds.breakdown_t} 才警示；回測 ${fmt(m.backtest_ic)}`}
              />
              <Tile label={`近 ${m.thresholds.recent_days} 日平均`} value={fmt(m.recent_mean_ic)} sub="描述性，不是檢定" />
            </div>
            <div className="mt-5">
              <IcChart data={m} />
            </div>
            <p className="mt-3 text-xs leading-relaxed text-ink-3">
              t 值用 Newey–West 標準誤（落後 {m.thresholds.nw_lags} 期）：相鄰基準日的 5 日報酬重疊，逐日 IC 會自我相關，
              樸素 t 會高估顯著性。尚未到期的排序紀錄 {m.pending_rows} 筆。
            </p>
          </section>

          <section className="rounded-2xl border border-border bg-surface p-5 shadow-(--shadow-sm)">
            <h2 className="text-sm font-semibold text-ink">例外報表</h2>
            <p className="mt-1 text-xs text-ink-3">
              排名分位遷移：{moves?.from_date ?? "—"} → {moves?.to_date ?? "—"}（5 個基準日，{moves?.n ?? 0} 檔分五個分位）
            </p>
            {moves && moves.n > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Tile label="第 1 分位（前 20%）換手" value={`${left.length}／${topSize}`} sub="5 個基準日內離開的檔數" />
                <Tile label="分位變動 ≥ 2" value={`${moves.moves.filter((x) => x.tags.includes("jump")).length} 檔`} sub={`共 ${moves.n} 檔`} />
              </div>
            )}
            <div className="mt-4 space-y-3">
              <Names
                title="進入第 1 分位"
                items={entered.map((x) => ({ key: x.ticker, text: `${x.name} ${x.q_before}→${x.q_now}` }))}
                empty="沒有"
              />
              <Names
                title="離開第 1 分位"
                items={left.map((x) => ({ key: x.ticker, text: `${x.name} ${x.q_before}→${x.q_now}` }))}
                empty="沒有"
              />
              <Names
                title="其他分位變動 ≥ 2"
                items={jumps.map((x) => ({ key: x.ticker, text: `${x.name} ${x.q_before}→${x.q_now}` }))}
                empty="沒有"
              />
              <Names
                title="52 週新高"
                items={data.new_highs.map((x) => ({ key: x.ticker, text: x.name }))}
                empty="沒有"
              />
              <Names
                title="52 週新低"
                items={data.new_lows.map((x) => ({ key: x.ticker, text: x.name }))}
                empty="沒有"
              />
            </div>
          </section>

          <section className="space-y-5">
            <div className="rounded-2xl border border-border bg-surface p-5 shadow-(--shadow-sm)">
              <h2 className="text-sm font-semibold text-ink">預測存證鏈</h2>
              {data.ledger.available ? (
                <>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <Tile label="鏈節" value={`${data.ledger.entries} 節`} sub={data.ledger.last_recorded_at?.slice(0, 10) ?? "—"} />
                    <Tile
                      label="驗證"
                      value={data.ledger.ok ? "✓ 通過" : "✗ 不符"}
                      sub={data.ledger.ok ? "資料庫與鏈逐節相符" : data.ledger.problems[0]}
                    />
                    <Tile
                      label="已上鏈"
                      value={`${(data.ledger.chained.predictions ?? 0) + (data.ledger.chained.rank_predictions ?? 0)} 列`}
                      sub={`方向 ${data.ledger.chained.predictions ?? 0}、排序 ${data.ledger.chained.rank_predictions ?? 0}`}
                    />
                    <Tile
                      label="等待上鏈"
                      value={`${(data.ledger.pending.predictions ?? 0) + (data.ledger.pending.rank_predictions ?? 0)} 列`}
                      sub="當天記錄的預測在保存後上鏈"
                    />
                  </div>
                  <a href={LEDGER_URL} target="_blank" rel="noopener noreferrer" className="mt-3 inline-block text-xs font-medium text-accent hover:underline">
                    鏈檔與驗證方式（ledger 分支）→
                  </a>
                </>
              ) : (
                <p className="mt-2 text-sm text-ink-3">這次匯出沒有取得鏈檔。</p>
              )}
            </div>

            <div className="rounded-2xl border border-border bg-surface p-5 shadow-(--shadow-sm)">
              <h2 className="text-sm font-semibold text-ink">大盤結構與絕對方向的線上命中率</h2>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <Tile label="加權指數 5 日" value={pct(market?.ret_5d)} sub={`1 日 ${pct(market?.ret_1d)}`} />
                <Tile label="上漲家數比" value={market ? `${Math.round(market.breadth_up * 100)}%` : "—"} sub={market ? `5 日平均 ${Math.round(market.breadth_ma5 * 100)}%` : undefined} />
                <Tile label="20 日均線乖離" value={pct(market?.ma20_bias)} sub={market ? `20 日波動 ${(market.vol20 * 100).toFixed(2)}%` : undefined} />
                <Tile
                  label="絕對方向命中率"
                  value={record?.hit_rate != null ? `${Math.round(record.hit_rate * 100)}%` : "—"}
                  sub={record ? `${record.matured} 筆到期${record.since ? `，自 ${record.since}` : ""}` : undefined}
                />
              </div>
            </div>
          </section>
        </div>
      )}
    </main>
  );
}
