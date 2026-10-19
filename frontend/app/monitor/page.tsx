"use client";

/**
 * 模型監控與例外報表（規則見 docs/monitor_prereg.md；門檻依期刊文獻預先聲明）：
 * - 模型健康：逐日 Rank IC 分成即時記錄、事後重建或補寫、預測窗口開始前已存證三組；主數字是即時記錄（前瞻）的成績，
 *   狀態照聲明用全部的到期日判定（含事後重建或補寫）。附 20 日滾動平均的趨勢線
 * - 方向訊號：命中率一定和同一批樣本的兩條基線、各訊號精度與 95% 區間一起列；依寫入時間分組
 * - 和簡單因子比、收盤後才買得到的成績、還要多久（規則見 docs/baseline_prereg.md）：只有中和後 Rank IC 有判讀
 * - 例外報表：排名分位遷移（5 個基準日）、52 週新高與新低（George & Hwang, 2004）
 * - 存證鏈：上鏈之後匯出的快照
 * 只顯示、不自動處置；不是投資建議。
 */

import { CircleCheck, CircleDashed, CircleMinus, ShieldX, type LucideIcon } from "lucide-react";
import { useState, type ReactNode } from "react";
import LedgerPanel from "@/components/overview/LedgerPanel";
import MarketPanel from "@/components/overview/MarketPanel";
import Badge from "@/components/ui/Badge";
import Hint from "@/components/ui/Hint";
import { Notice, Skeleton } from "@/components/ui/Feedback";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import { api, ledgerSnapshot, type BaselinesResponse, type IcGroup, type MonitorResponse, type NeutralVerdict, type TrackSample } from "@/lib/api";
import { fixed, pct, share, toneVar } from "@/lib/format";
import { LINKS } from "@/lib/links";
import { MODEL_STATUS, type BadgeTone } from "@/lib/status";
import { errorText, useAsync } from "@/lib/useAsync";

type Model = MonitorResponse["model"];

function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-ink-3">{label}</dt>
      <dd className="mt-1 text-xl font-light text-ink">{value}</dd>
      {sub && <dd className="mt-0.5 text-xs text-ink-2">{sub}</dd>}
    </div>
  );
}

/** y 軸刻度間距：依資料範圍取 0.05／0.1／0.2，讓刻度落在好讀的數字上 */
function icStep(bound: number): number {
  return bound > 0.4 ? 0.2 : bound > 0.2 ? 0.1 : 0.05;
}

/** 20 日滾動平均（與「留意」用的近 20 日平均同一個窗口）：滿 window 天才有值 */
function rolling(values: number[], window: number): (number | null)[] {
  return values.map((_, i) => (i + 1 < window ? null : values.slice(i + 1 - window, i + 1).reduce((a, b) => a + b, 0) / window));
}

type Day = Model["daily"][number];

/** 即時記錄＝每日排程在預測窗口開始前寫入；排程晚跑、窗口開始後才補寫的和事後重建同一組（舊版站上資料沒有 on_time，只看 source） */
function isLive(d: Day): boolean {
  return d.source === "live" && d.on_time !== false;
}

function dayLabel(d: Day): string {
  if (isLive(d)) return "即時記錄";
  if (d.source === "live") return "補寫（窗口開始後才寫入）";
  return d.before_training ? "事後重建（模型訓練完成前）" : "事後重建";
}

/**
 * 逐日 Rank IC：以零軸為基準的上下長條，左邊是 y 軸刻度。
 * 實心長條＝即時記錄，空心長條＝事後重建或補寫（形狀不同，不只靠透明度）；
 * 折線是 20 日滾動平均（實線段落在即時記錄的日子、虛線段落在事後重建或補寫的日子）；水平虛線是回測平均。
 * 指到或點一下長條會顯示當天的數值，完整數值在下方的表格。
 */
function IcChart({ data }: { data: Model }) {
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
  const window = data.thresholds.recent_days;
  const trend = rolling(
    days.map((d) => d.ic as number),
    window,
  );
  const x = (i: number) => ((i + 0.5) / days.length) * 100;
  return (
    <div>
      <div className="flex gap-2">
        <div className="relative h-44 w-10 shrink-0 text-right text-xs text-ink-3" aria-hidden="true">
          {ticks.map((t) => (
            <span key={t} className="absolute right-0 -translate-y-1/2" style={{ top: `${y(t)}%` }}>
              {t === 0 ? "0" : fixed(t, digits, true)}
            </span>
          ))}
        </div>
        <div
          className="relative h-44 flex-1"
          role="img"
          aria-label={`逐日 Rank IC，${days.length} 天，平均 ${fixed(data.mean_ic, 4, true)}；回測平均 ${fixed(data.backtest_ic, 4, true)}`}
          onPointerLeave={() => setHover(null)}
        >
          {ticks.map((t) => (
            <div key={t} className={`absolute inset-x-0 border-t ${t === 0 ? "border-border-strong" : "border-border"}`} style={{ top: `${y(t)}%` }} />
          ))}
          <div className="absolute inset-0 flex gap-px">
            {days.map((d, i) => {
              const v = d.ic as number;
              const live = isLive(d);
              return (
                <div
                  key={d.day}
                  className={`relative h-full flex-1 ${hover === i ? "bg-surface-2" : ""}`}
                  onPointerEnter={() => setHover(i)}
                  onPointerDown={() => setHover(i)}
                >
                  <span
                    className={`absolute inset-x-0 ${live ? "bg-ink-3" : "border border-ink-3 bg-transparent"} ${v >= 0 ? "rounded-t-[2px]" : "rounded-b-[2px]"}`}
                    style={{ top: `${v >= 0 ? y(v) : 50}%`, height: `${Math.max((Math.abs(v) / bound) * 50, 0.5)}%` }}
                  />
                </div>
              );
            })}
          </div>
          <svg className="pointer-events-none absolute inset-0 h-full w-full overflow-visible" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
            {trend.map((v, i) => {
              const prev = trend[i - 1];
              if (v == null || prev == null) return null;
              return (
                <line
                  key={days[i].day}
                  x1={x(i - 1)}
                  y1={y(prev)}
                  x2={x(i)}
                  y2={y(v)}
                  stroke="var(--ink)"
                  strokeWidth={2}
                  strokeDasharray={isLive(days[i]) ? undefined : "4 3"}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </svg>
          {data.backtest_ic != null && (
            <div className="pointer-events-none absolute inset-x-0 border-t border-dashed border-ink-2" style={{ top: `${y(data.backtest_ic)}%` }} />
          )}
          {h && hover != null && (
            <div
              className="pointer-events-none absolute top-1 z-10 -translate-x-1/2 whitespace-nowrap rounded-[3px] border border-border bg-surface px-2.5 py-1.5 text-xs shadow-(--shadow-pop)"
              style={{ left: `clamp(4.5rem, ${x(hover)}%, calc(100% - 4.5rem))` }}
            >
              <p className="text-ink-3">{h.day}</p>
              <p className="font-semibold text-ink">Rank IC {fixed(h.ic, 3, true)}</p>
              {trend[hover] != null && <p className="text-ink-2">20 日滾動平均 {fixed(trend[hover], 3, true)}</p>}
              <p className="text-ink-3">
                {h.n} 檔，{dayLabel(h)}
              </p>
            </div>
          )}
        </div>
        {data.backtest_ic != null && (
          <div className="relative h-44 w-16 shrink-0 text-xs text-ink-2" aria-hidden="true">
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
      <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink-2">
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-2 rounded-[1px] bg-ink-3" aria-hidden="true" />
          即時記錄
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block h-3 w-2 rounded-[1px] border border-ink-3" aria-hidden="true" />
          事後重建或補寫
        </li>
        <li className="flex items-center gap-1.5">
          <svg width="22" height="6" aria-hidden="true">
            <line x1="0" y1="3" x2="22" y2="3" stroke="var(--ink)" strokeWidth="2" />
          </svg>
          {window} 日滾動平均
          <Hint to="model" anchor="groups" label="滾動平均">
            <p>滾動平均落在事後重建或補寫日子的那一段畫成虛線。</p>
          </Hint>
        </li>
        <li className="flex items-center gap-1.5">
          <span className="inline-block w-5 border-t border-dashed border-ink-2" aria-hidden="true" />
          回測平均
        </li>
      </ul>
      <details className="mt-2 text-xs">
        <summary className="cursor-pointer text-ink-2 hover:text-ink">看逐日數值</summary>
        <div className="relative mt-2 max-h-56 overflow-auto rounded-[3px] border border-border">
          <table className="w-full text-table">
            <thead className="sticky top-0 bg-background">
              <tr className="text-left text-ink-3">
                <th scope="col" className="px-3 py-1.5 font-medium">到期的基準日</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">Rank IC</th>
                <th scope="col" className="px-3 py-1.5 text-right font-medium">檔數</th>
                <th scope="col" className="px-3 py-1.5 font-medium">來源</th>
                <th scope="col" className="px-3 py-1.5 font-medium">窗口開始前已存證</th>
              </tr>
            </thead>
            <tbody className="divide-hairline">
              {[...days].reverse().map((d) => (
                <tr key={d.day}>
                  <td className="px-3 py-1 text-ink-2">{d.day}</td>
                  <td className="px-3 py-1 text-right text-ink">{fixed(d.ic, 3, true)}</td>
                  <td className="px-3 py-1 text-right text-ink-2">{d.n}</td>
                  <td className="px-3 py-1 text-ink-2">{dayLabel(d)}</td>
                  <td className="px-3 py-1 text-ink-2">{d.sealed ? "是" : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </details>
    </div>
  );
}

/** 三組成績：即時記錄（主）、事後重建或補寫、預測窗口開始前已串入存證鏈 */
function Groups({ m }: { m: Model }) {
  const groups = m.groups;
  if (!groups) return null;
  const preTraining = m.daily.filter((d) => d.ic != null && d.before_training).length;
  const late = m.daily.filter((d) => d.ic != null && d.source === "live" && d.on_time === false).length;
  const rows: { key: "live" | "pit" | "sealed"; label: string; g: IcGroup }[] = [
    { key: "live", label: "即時記錄", g: groups.live },
    { key: "pit", label: "事後重建或補寫", g: groups.pit },
    { key: "sealed", label: "到期前已公開存證", g: groups.sealed },
  ];
  return (
    <div className="relative overflow-x-auto">
      <table className="w-full text-table">
        <caption className="sr-only">逐日 Rank IC 依資料來源分成三組</caption>
        <thead>
          <tr className="hairline-b text-left text-xs text-ink-3">
            <th scope="col" className="py-2 pr-3 font-normal">
              <span className="inline-flex items-center gap-1">
                成績
                <Hint to="model" anchor="groups" label="三組成績">
                  <p>即時記錄：每日排程在預測窗口開始（下一個交易日開盤）前寫入，是主要的前瞻成績。</p>
                  <p>
                    事後重建或補寫：窗口開始後才寫入，資料延遲時依當時可得的資料重算{late ? `，${late} 天是排程晚跑補寫` : ""}
                    {preTraining ? `；其中 ${preTraining} 天在模型訓練完成之前` : ""}。
                  </p>
                  <p>
                    到期前已公開存證：
                    {groups.sealed.n_days > 0
                      ? "預測窗口開始前就已串入存證鏈。"
                      : m.sealed_since
                        ? `存證自 ${m.sealed_since} 的基準日開始，到期（5 個交易日後）才有成績。`
                        : "還沒有在預測窗口開始前上鏈的基準日。"}
                  </p>
                </Hint>
              </span>
            </th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">到期日</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">平均 Rank IC</th>
            <th scope="col" className="py-2 pr-3 text-right font-medium">
              <span className="sm:hidden">t 值</span>
              <span className="hidden sm:inline">Newey–West t</span>
            </th>
            <th scope="col" className="hidden py-2 font-medium sm:table-cell">期間</th>
          </tr>
        </thead>
        <tbody className="divide-hairline">
          {rows.map(({ key, label, g }) => (
            <tr key={key}>
              <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                <span className={key === "live" ? "font-semibold text-ink" : "text-ink"}>{label}</span>
              </th>
              <td className="py-2 pr-3 text-right text-ink">{g.n_days}</td>
              <td className="py-2 pr-3 text-right text-ink">{fixed(g.mean_ic, 4, true)}</td>
              <td className="py-2 pr-3 text-right text-ink">{fixed(g.t_nw, 2, true)}</td>
              <td className="hidden whitespace-nowrap py-2 text-xs text-ink-2 sm:table-cell">{g.first_day ? `${g.first_day}～${g.last_day}` : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const SAMPLE_TEXT: Record<TrackSample["key"], string> = {
  all: "全部到期",
  before_window: "窗口開始前寫入",
  after_window: "窗口開始後才寫入",
};

const pp = (v: number | null | undefined) => (v == null ? "—" : `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(1)}`);
const range = (r: [number, number] | null | undefined, f: (v: number) => string) => (r ? `${f(r[0])}～${f(r[1])}` : "—");

/** 方向訊號：命中率、同一批樣本的兩條基線與差距、95% 區間；依寫入時間分組 */
function TrackTable({ samples, bootstrap }: { samples: TrackSample[]; bootstrap?: { block: number; replicates: number } | null }) {
  const all = samples.find((s) => s.key === "all");
  return (
    <>
      <div className="relative overflow-x-auto">
        <table className="w-full text-table">
          <caption className="sr-only">方向訊號的命中率與基線</caption>
          <thead>
            <tr className="hairline-b text-left text-xs text-ink-3">
              <th scope="col" className="py-2 pr-3 font-normal">
                <span className="inline-flex items-center gap-1">
                  樣本
                  <Hint to="direction" anchor="timing" label="樣本">
                    <p>窗口開始前寫入：基準日的下一個交易日開盤前就寫入資料庫。窗口開始後才寫入：隔天才補記，或模型訓練完成後回補。</p>
                  </Hint>
                </span>
              </th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">到期筆數</th>
              <th scope="col" className="py-2 pr-3 text-right font-normal">
                <span className="inline-flex items-center justify-end gap-1">
                  命中率<span className="hidden sm:inline">（95% 區間）</span>
                  <Hint to="direction" anchor="baselines" label="命中率與基線">
                    <p>
                      命中率一定要和同一批樣本的基線比：每次都猜同一類的命中率。區間跨過 0 代表還不能說贏過基線（block bootstrap，區塊 {bootstrap?.block ?? 5} 個基準日）。
                    </p>
                  </Hint>
                </span>
              </th>
              <th scope="col" className="hidden py-2 pr-3 text-right font-medium sm:table-cell">全猜觀望</th>
              <th scope="col" className="hidden py-2 pr-3 text-right font-medium sm:table-cell">全猜漲</th>
              <th scope="col" className="py-2 text-right font-medium">
                <span className="whitespace-nowrap">比全猜觀望</span>
                <span className="hidden sm:inline">（百分點）</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-hairline">
            {samples.map((s) => (
              <tr key={s.key}>
                <th scope="row" className="py-2.5 pr-3 text-left font-normal">
                  <span className={`whitespace-nowrap ${s.key === "all" ? "font-semibold text-ink" : "text-ink"}`}>{SAMPLE_TEXT[s.key]}</span>
                </th>
                <td className="py-2 pr-3 text-right text-ink">
                  {s.matured.toLocaleString()}
                  <span className="hidden text-xs text-ink-2 sm:block">{s.n_days} 個基準日</span>
                </td>
                <td className="py-2 pr-3 text-right text-ink">
                  {share(s.hit_rate, 1)}
                  <span className="block whitespace-nowrap text-xs text-ink-2">{range(s.ci_hit_rate, (v) => share(v, 1))}</span>
                </td>
                <td className="hidden py-2 pr-3 text-right text-ink-2 sm:table-cell">{share(s.baseline_hold, 1)}</td>
                <td className="hidden py-2 pr-3 text-right text-ink-2 sm:table-cell">{share(s.baseline_up, 1)}</td>
                <td className="py-2 text-right text-ink">
                  {s.hit_rate != null && s.baseline_hold != null ? pp(s.hit_rate - s.baseline_hold) : "—"}
                  <span className="block whitespace-nowrap text-xs text-ink-2">{range(s.ci_excess_hold, pp)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {all && all.matured > 0 && (
        <p className="mt-3 text-sm text-ink-2">
          各訊號的精度
          <Hint to="direction" anchor="baselines" label="精度">
            <p>精度是喊了某一類之後，真的是那一類的比例，用全部到期的紀錄計算。</p>
          </Hint>
          ：
          {(["漲", "跌", "觀望"] as const).map((sig, i) => {
            const p = all.precision[sig];
            return (
              <span key={sig}>
                {i > 0 && "、"}
                {sig} {p.called ? share(p.hits / p.called, 1) : "—"}（{p.hits}/{p.called}）
              </span>
            );
          })}
          。
        </p>
      )}
    </>
  );
}

function Names({ title, items, empty }: { title: string; items: { key: string; text: string }[]; empty: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-ink-2">
        {title}（{items.length}）
      </p>
      {items.length > 0 ? (
        // 以頓號串成一行，頓號跟著前一項，換行時不會出現在行首
        <ul className="mt-1 flex flex-wrap text-xs leading-relaxed text-ink-2">
          {items.map((i, k) => (
            <li key={i.key} className="whitespace-nowrap">
              {i.text}
              {k < items.length - 1 && "、"}
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-1 text-xs text-ink-3">{empty}</p>
      )}
    </div>
  );
}

/** 中和後 Rank IC 的判讀（docs/baseline_prereg.md 2.2）：負的結論用實心深色底，不用紅綠 */
const VERDICT: Record<NeutralVerdict, { text: string; tone: BadgeTone; icon: LucideIcon }> = {
  beyond: { text: "排除後仍有資訊", tone: "neutral", icon: CircleCheck },
  negative: { text: "排除後為負", tone: "solid", icon: ShieldX },
  indistinct: { text: "無法和反轉、動量區分", tone: "neutral", icon: CircleMinus },
  insufficient: { text: "資料不足", tone: "neutral", icon: CircleDashed },
};

/** 還要多久：若真實 IC 等於回測，t 的期望值到門檻還要幾個到期日（一個月約 21 個交易日）；假設與意義收在提示裡 */
function Horizon({ d }: { d: BaselinesResponse["days_needed"] | undefined }) {
  if (!d) return null;
  const remaining = d.status === "ok" ? d.remaining : null;
  const target = d.target_t.toFixed(0);
  return (
    <div className="min-w-0">
      <dt className="flex items-center gap-1 text-xs text-ink-3">
        還要多久
        <Hint to="model" anchor="horizon" label="還要多久">
          <p>
            {remaining == null
              ? "到期日不足 20 天，還不推算。"
              : `若真實 Rank IC 等於回測（${fixed(d.backtest_ic, 3, true)}），照目前逐日 IC 的雜訊，t 的期望值要到 ${target} 所需的到期日數。到那時大約只有五成機會真的到 ${target}，要八成把握約需兩倍；真實 IC 若比回測小，需要更久。`}
          </p>
        </Hint>
      </dt>
      <dd className="mt-1 text-xl font-light text-ink">{remaining == null ? "—" : remaining === 0 ? "已足夠" : `約 ${remaining} 天`}</dd>
      {remaining != null && (
        <dd className="mt-0.5 text-xs text-ink-2">
          {remaining > 0 && `約 ${Math.max(1, Math.round(remaining / 21))} 個月；`}共需 {d.needed} 個到期日
        </dd>
      )}
    </div>
  );
}

/** 「N 天，t x.xx」：統計卡的補充說明 */
const daysAndT = (s: { n_days: number; t_nw: number | null }) => `${s.n_days} 天，t ${fixed(s.t_nw, 2, true)}`;

/** 和簡單因子比：主數字是中和後 Rank IC，三個因子的對照只描述 */
function FactorPanel({ f }: { f: NonNullable<BaselinesResponse["factors"]> }) {
  const v = VERDICT[f.neutral.verdict];
  return (
    <Panel
      className="lg:col-span-2"
      title="和簡單因子比"
      description="排除短期反轉與動量之後，模型還剩多少預測力"
      actions={
        <span className="flex items-center gap-1">
          <Badge tone={v.tone} icon={v.icon}>
            {v.text}
          </Badge>
          <Hint to="baselines" anchor="neutral" label="和簡單因子比">
            <p>三個因子在基準日收盤時就能算出。中和後 Rank IC 累積 20 天以上才判讀；表上的因子 IC、差與相關只描述，不判讀。</p>
          </Hint>
        </span>
      }
    >
      <dl className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
        <Stat
          label="中和後 Rank IC"
          value={fixed(f.neutral.mean_ic, 4, true)}
          sub={`${daysAndT(f.neutral)}（門檻 ${f.thresholds.verdict_t.toFixed(1)}／${f.thresholds.hlz_t.toFixed(1)}）`}
        />
        <Stat label="模型 Rank IC（同一批）" value={fixed(f.model.mean, 4, true)} sub={daysAndT(f.model)} />
      </dl>
      <div className="mt-4">
        <table className="w-full text-table">
          <caption className="sr-only">模型和三個簡單因子的 Rank IC 對照</caption>
          <thead>
            <tr className="hairline-b text-left text-xs text-ink-3">
              <th scope="col" className="py-2 pr-3 font-medium">因子</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">因子 IC</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">模型 − 因子</th>
              <th scope="col" className="py-2 text-right font-medium">和模型的相關</th>
            </tr>
          </thead>
          <tbody className="divide-hairline">
            {f.factors.map((x) => (
              <tr key={x.key}>
                <th scope="row" className="whitespace-nowrap py-2 pr-3 text-left font-normal text-ink">
                  {x.label}
                </th>
                <td className="py-2 pr-3 text-right text-ink">
                  {fixed(x.ic.mean, 4, true)}
                  <span className="block text-xs text-ink-2 sm:ml-1.5 sm:inline">t {fixed(x.ic.t_nw, 2, true)}</span>
                </td>
                <td className="py-2 pr-3 text-right text-ink">
                  {fixed(x.diff.mean, 4, true)}
                  <span className="block text-xs text-ink-2 sm:ml-1.5 sm:inline">t {fixed(x.diff.t_nw, 2, true)}</span>
                </td>
                <td className="py-2 text-right text-ink">{fixed(x.corr_mean, 2, true)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  );
}

/** 收盤後才買得到的成績：報酬從 t+1 收盤起算；前後 20% 只用即時記錄的基準日 */
function TradablePanel({ q, t }: { q: BaselinesResponse["quintiles"]; t: BaselinesResponse["tradable"] }) {
  const tinted = (v: number | null) => <span style={{ color: toneVar(v) }}>{pct(v, 2)}</span>;
  return (
    <Panel
      className="lg:col-span-2"
      title="收盤後才買得到的成績"
      description="報酬從下一個交易日收盤起算（t+1 到 t+6），等權、未扣交易成本"
      actions={
        <Hint to="tradable" anchor="quintiles" label="收盤後的成績">
          <p>排名靠前仍可能下跌。相鄰基準日的報酬互相重疊，這是排序兩端實際發生的結果，不是每天換股的組合報酬；只描述，不改變模型狀態。</p>
        </Hint>
      }
    >
      {q && (
        <dl className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4">
          <Stat label="前 20% 的平均 5 日報酬" value={tinted(q.top_mean)} sub={`即時記錄 ${q.n_days} 個基準日`} />
          <Stat label="後 20%" value={tinted(q.bottom_mean)} />
          <Stat label="全池" value={tinted(q.pool_mean)} />
          <Stat label="前 20% − 後 20%" value={pct(q.spread_mean, 2)} sub={`t ${fixed(q.spread_t, 2, true)}`} />
        </dl>
      )}
      {t && (
        <dl className={`grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-4 ${q ? "hairline-t mt-6 pt-6" : ""}`}>
          <Stat label="可成交版 Rank IC（即時記錄）" value={fixed(t.live.mean_ic, 4, true)} sub={daysAndT(t.live)} />
          <Stat label="可成交版 Rank IC（全部）" value={fixed(t.all.mean_ic, 4, true)} sub={daysAndT(t.all)} />
        </dl>
      )}
    </Panel>
  );
}

export default function MonitorPage() {
  const monitor = useAsync("monitor", () => api.monitor());
  const market = useAsync("market", () => api.market());
  const record = useAsync("track-record", () => api.trackRecord());
  const ledger = useAsync("ledger", ledgerSnapshot);
  const base = useAsync("baselines", () => api.baselines());

  const data = monitor.data;
  const m = data?.model;
  const status = m ? MODEL_STATUS[m.status] : null;
  const moves = data?.quintile_moves;
  const topSize = moves && moves.n ? Math.floor((moves.n - 1) / 5) + 1 : 0; // 第 1 分位的檔數
  const entered = moves?.moves.filter((x) => x.tags.includes("enter_top")) ?? [];
  const left = moves?.moves.filter((x) => x.tags.includes("leave_top")) ?? [];
  const jumps = moves?.moves.filter((x) => x.tags.includes("jump") && !x.tags.includes("enter_top") && !x.tags.includes("leave_top")) ?? [];
  const tr = record.data;
  const live = m?.groups?.live;

  return (
    <>
      <PageHeader
        title="監控"
        description={
          <>
            模型的線上表現、例外報表與預測存證鏈，門檻依
            <a href={LINKS.monitorRules} target="_blank" rel="noopener noreferrer" className="font-medium link">
              預先聲明的規則
            </a>
            。
          </>
        }
      />

      {monitor.error && <Notice tone="error">{errorText(monitor.error, "監控資料由每日排程在收盤後產生，目前還沒有這一份。")}</Notice>}
      {monitor.loading && <Skeleton className="h-72 w-full" />}

      {data && m && status && (
        <div className="grid grid-cols-1 gap-x-14 gap-y-14 lg:grid-cols-2 lg:items-start">
          <Panel
            className="lg:col-span-2"
            title="相對強弱排序模型的線上表現"
            description={`模型 ${m.version ?? "—"}，基準日 ${data.base_date}，尚未到期 ${m.pending_rows} 筆`}
            actions={
              <span className="flex items-center gap-1">
                <Badge tone={status.tone} icon={status.icon}>
                  {status.text}
                </Badge>
                <Hint to="model" anchor="status" label="模型狀態">
                  <p>
                    「{status.text}」：{status.note}。依預先聲明用全部 {m.n_days} 個到期日判定（含事後重建或補寫）：失效檢定 t 低於 {m.thresholds.breakdown_t} 才警示；近{" "}
                    {m.thresholds.recent_days} 日平均低於 0 是描述性的「留意」，不是檢定。
                  </p>
                  <p>t 值用 Newey–West 標準誤（落後 {m.thresholds.nw_lags} 期）。狀態只顯示，不會自動停用模型。</p>
                </Hint>
              </span>
            }
          >
            <dl className="grid grid-cols-2 gap-x-8 gap-y-6 sm:grid-cols-3 lg:grid-cols-5">
              {live ? (
                <Stat
                  label="即時記錄的平均 Rank IC"
                  value={fixed(live.mean_ic, 4, true)}
                  sub={`${live.n_days} 個到期日，Newey–West t ${fixed(live.t_nw, 2, true)}`}
                />
              ) : (
                <Stat label="線上平均 Rank IC" value={fixed(m.mean_ic, 4, true)} sub={`${m.n_days} 個到期日（即時記錄 ${m.n_live_days}）`} />
              )}
              <Stat
                label="全部到期日（含事後重建或補寫）"
                value={fixed(m.mean_ic, 4, true)}
                sub={`${m.n_days} 天，t ${fixed(m.t_skill, 2, true)}（門檻 ${m.thresholds.skill_t.map((t) => t.toFixed(1)).join("／")}）`}
              />
              <Stat label="失效檢定 t（對回測）" value={fixed(m.t_breakdown, 2, true)} sub={`門檻 ${m.thresholds.breakdown_t}；回測 ${fixed(m.backtest_ic, 4, true)}`} />
              <Stat label={`近 ${m.thresholds.recent_days} 日平均`} value={fixed(m.recent_mean_ic, 4, true)} sub="描述性提示" />
              <Horizon d={base.data?.days_needed} />
            </dl>
            {m.groups && (
              <div className="mt-8">
                <Groups m={m} />
              </div>
            )}
            <div className="mt-8">
              <IcChart data={m} />
            </div>
          </Panel>

          {base.error != null && (
            <div className="lg:col-span-2">
              <Notice tone="error">{errorText(base.error, "簡單因子對照由每日排程產生，目前還沒有這一份。")}</Notice>
            </div>
          )}
          {base.data?.factors && <FactorPanel f={base.data.factors} />}
          {base.data && (base.data.quintiles || base.data.tradable) && <TradablePanel q={base.data.quintiles} t={base.data.tradable} />}

          <Panel className="lg:col-span-2" title="方向訊號的線上命中率" description="漲跌＝5 日累積報酬超過 ±2%">
            {tr ? (
              tr.samples && tr.samples.length > 0 ? (
                <TrackTable samples={tr.samples} bootstrap={tr.bootstrap} />
              ) : (
                <dl className="grid grid-cols-2 gap-y-3">
                  <Stat label="命中率" value={share(tr.hit_rate)} sub={`${tr.matured.toLocaleString()} 筆到期${tr.since ? `，自 ${tr.since}` : ""}`} />
                  <Stat label="等待到期" value={`${(tr.total - tr.matured).toLocaleString()} 筆`} sub="基準日後滿 5 個交易日才對照" />
                </dl>
              )
            ) : record.error ? (
              <p className="text-sm text-ink-3">{errorText(record.error, "線上命中率還沒有產生。")}</p>
            ) : (
              <Skeleton className="h-24 w-full" />
            )}
            <a className="mt-3 inline-block text-xs link" href={LINKS.onlineReport} target="_blank" rel="noopener noreferrer">
              線上實證報告
            </a>
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

          <div className="space-y-14">
            <div id="ledger" className="scroll-mt-28">
              <LedgerPanel snapshot={ledger.error ? null : ledger.data} fallback={data.ledger} />
            </div>
            <MarketPanel market={market.data} />
          </div>
        </div>
      )}
    </>
  );
}
