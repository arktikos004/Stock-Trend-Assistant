"use client";

/**
 * 篩選器（規則見 docs/screener_prereg.md）：研究用的候選清單，不是預測、也不是投資建議。
 * 0–100 綜合評分＝五個組成依公開權重加權；T1／T2／T3＝適用的條件全部符合、少一項、少兩項，各層有上限、不足不補位。
 * 以可排序的表格比較；點一列展開分數拆解、逐項條件與入選理由。層級、展開的股票寫在網址，可以分享。
 */

import { ArrowDown, ArrowUp, Check, ChevronDown, CircleHelp, Download, Minus, Star, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Fragment, Suspense, useMemo, useState } from "react";
import ScoreBar from "@/components/screener/ScoreBar";
import Badge from "@/components/ui/Badge";
import { EmptyState, Notice, Skeleton, TableSkeleton } from "@/components/ui/Feedback";
import PageHeader from "@/components/ui/PageHeader";
import Panel from "@/components/ui/Panel";
import Segmented from "@/components/ui/Segmented";
import { api, type ConditionKey, type ConditionState, type ScreenerComponentKey, type ScreenerResponse, type ScreenerStock } from "@/lib/api";
import { downloadCsv } from "@/lib/csv";
import { code, fixed, pct } from "@/lib/format";
import { LINKS } from "@/lib/links";
import { COMPONENTS, CONDITION_KEYS, CONDITIONS, contributions, TIER_TITLE } from "@/lib/screener";
import { errorText, useAsync } from "@/lib/useAsync";
import { useWatchlist } from "@/lib/watchlist";

type Scope = "candidates" | "T1" | "T2" | "T3" | "all" | "watch";
type SortKey = "tier" | "composite" | ScreenerComponentKey | "misses" | "name";

const STATE: Record<ConditionState, { text: string; icon: typeof Check; className: string }> = {
  pass: { text: "符合", icon: Check, className: "text-accent" },
  fail: { text: "不符合", icon: X, className: "text-ink-3" },
  missing: { text: "缺資料（算不符合）", icon: CircleHelp, className: "text-warn" },
  na: { text: "不適用", icon: Minus, className: "text-ink-3" },
};

const tierOrder = (s: ScreenerStock) => (s.tier ? Number(s.tier.slice(1)) : s.over_cap ? 4 : 5);

/** 每個條件的實際數值，入選理由與逐項條件都用它 */
function evidence(k: ConditionKey, s: ScreenerStock): string {
  const m = s.metrics;
  switch (k) {
    case "C1":
      return m.rank_pct == null ? "排序百分位缺資料" : `排序百分位 ${Math.round(m.rank_pct * 100)}%`;
    case "C2":
      return `60 日報酬 ${pct(m.ret60)}`;
    case "C3":
      return `評價分數 ${fixed(s.components.valuation, 0)}`;
    case "C4":
      return s.conditions.C4 === "na" ? "金融保險業不計營收" : `月營收年增 ${fixed(m.revenue_yoy, 1, true)}%`;
    case "C5":
      return `融資餘額變化 ${pct(m.margin_change, 2)}`;
    case "C6":
      return `突破前高：${m.breakout == null ? "缺資料" : m.breakout ? "是" : "否"}；均線多頭：${m.ma_bullish == null ? "缺資料" : m.ma_bullish ? "是" : "否"}`;
  }
}

/** 入選理由：一句話說明層級從哪裡來（依條件狀態組出，不另做判斷） */
function reason(s: ScreenerStock): string {
  const applicable = CONDITION_KEYS.filter((k) => s.conditions[k] !== "na");
  const passed = applicable.filter((k) => s.conditions[k] === "pass").length;
  const missed = applicable.filter((k) => s.conditions[k] !== "pass").map((k) => CONDITIONS[k]);
  const head = `適用的 ${applicable.length} 項條件符合 ${passed} 項`;
  if (s.tier) return `${head}，列入 ${s.tier}（${TIER_TITLE[s.tier]}）${missed.length ? `；沒有符合：${missed.join("、")}` : ""}。`;
  if (s.over_cap) return `${head}，夠資格進入層級，但該層已達上限，依規則不補位。`;
  return `${head}，不符合的超過兩項，沒有列入候選${missed.length ? `：${missed.join("、")}` : ""}。`;
}

function Detail({ s, data }: { s: ScreenerStock; data: ScreenerResponse }) {
  const m = s.metrics;
  const facts: [string, string][] = [
    ["本益比", m.pe == null ? "—（虧損或無法計算）" : fixed(m.pe, 1)],
    ["現金殖利率", m.dividend_yield == null ? "—" : `${fixed(m.dividend_yield, 2)}%`],
    ["股價淨值比", fixed(m.pb, 2)],
    ["月營收年增", s.conditions.C4 === "na" ? "不計" : `${fixed(m.revenue_yoy, 1, true)}%`],
    [`融資 ${data.sources.margin_days} 日變化`, pct(m.margin_change, 2)],
    ["千張大戶週變化", `${fixed(m.big_holder_change, 2, true)} 個百分點`],
    ["20 日報酬", pct(m.ret20)],
    ["60 日報酬", pct(m.ret60)],
  ];
  return (
    <div className="grid gap-6 px-4 py-4 lg:grid-cols-3">
      <section>
        <h3 className="text-sm font-semibold text-ink">分數拆解</h3>
        <ScoreBar stock={s} weights={data.weights} className="mt-2 h-2.5" />
        <table className="mt-2 w-full text-table">
          <thead>
            <tr className="text-left text-xs text-ink-3">
              <th scope="col" className="py-1 font-medium">組成</th>
              <th scope="col" className="py-1 text-right font-medium">分數</th>
              <th scope="col" className="py-1 text-right font-medium">權重</th>
              <th scope="col" className="py-1 text-right font-medium">貢獻</th>
            </tr>
          </thead>
          <tbody>
            {contributions(s, data.weights).map((p) => (
              <tr key={p.key}>
                <td className="py-1">
                  <span className="inline-flex items-center gap-1.5 text-ink-2">
                    <span className="inline-block size-2 rounded-[2px]" style={{ background: p.color }} aria-hidden="true" />
                    {p.label}
                  </span>
                </td>
                <td className="py-1 text-right text-ink-2">{fixed(p.score, 0)}</td>
                <td className="py-1 text-right text-ink-2">{Math.round(p.weight * 100)}%</td>
                <td className="py-1 text-right font-semibold text-ink">{fixed(p.value, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {s.missing.length > 0 && (
          <p className="mt-2 text-xs text-ink-3">
            從缺：{s.missing.map((k) => COMPONENTS.find((c) => c.key === k)?.label).join("、")}，權重改由其他組成分攤。
          </p>
        )}
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">入選理由</h3>
        <p className="mt-2 text-sm leading-relaxed text-ink-2">{reason(s)}</p>
        <ul className="mt-3 space-y-1.5">
          {CONDITION_KEYS.map((k) => {
            const st = STATE[s.conditions[k]];
            return (
              <li key={k} className="flex items-start gap-2 text-sm">
                <st.icon size={15} className={`mt-0.5 shrink-0 ${st.className}`} aria-hidden="true" />
                <span>
                  <span className="text-ink">{CONDITIONS[k]}</span>
                  <span className="sr-only">：{st.text}</span>
                  <span className="block text-xs text-ink-3">
                    {st.text}。{evidence(k, s)}
                  </span>
                </span>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <h3 className="text-sm font-semibold text-ink">指標</h3>
        <dl className="mt-2 divide-y divide-border">
          {facts.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3 py-1.5 text-sm">
              <dt className="text-ink-2">{k}</dt>
              <dd className="text-right text-ink">{v}</dd>
            </div>
          ))}
        </dl>
        <Link href={`/stock?t=${encodeURIComponent(s.ticker)}`} className="mt-3 inline-block text-sm font-medium text-accent hover:underline">
          看 {s.name} 的個股頁
        </Link>
      </section>
    </div>
  );
}

function ScreenerView() {
  const params = useSearchParams();
  const router = useRouter();
  const { data, error, loading } = useAsync("screener", () => api.screener());
  const watchlist = useWatchlist();
  const scope = (params.get("tier") as Scope | null) ?? "candidates";
  const open = params.get("t");
  const [required, setRequired] = useState<ConditionKey[]>([]);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "tier", dir: 1 });

  const setParams = (next: { tier?: Scope; t?: string | null }) => {
    const q = new URLSearchParams(params.toString());
    if (next.tier !== undefined) {
      if (next.tier === "candidates") q.delete("tier");
      else q.set("tier", next.tier);
    }
    if (next.t !== undefined) {
      if (next.t) q.set("t", next.t);
      else q.delete("t");
    }
    const s = q.toString();
    router.replace(s ? `/screener?${s}` : "/screener", { scroll: false });
  };

  const rows = useMemo(() => {
    if (!data) return [];
    let list = data.stocks;
    if (scope === "candidates") list = list.filter((s) => s.tier != null);
    else if (scope === "watch") list = list.filter((s) => watchlist.includes(s.ticker));
    else if (scope !== "all") list = list.filter((s) => s.tier === scope);
    if (required.length) list = list.filter((s) => required.every((k) => s.conditions[k] === "pass"));
    const v = (s: ScreenerStock): number | string => {
      switch (sort.key) {
        case "tier":
          return tierOrder(s) * 1000 - (s.composite ?? 0);
        case "composite":
          return -(s.composite ?? -1);
        case "misses":
          return s.misses;
        case "name":
          return s.name;
        default:
          return -(s.components[sort.key] ?? -1);
      }
    };
    return [...list].sort((a, b) => {
      const x = v(a);
      const y = v(b);
      const d = typeof x === "string" ? x.localeCompare(y as string, "zh-Hant") : x - (y as number);
      return d * sort.dir;
    });
  }, [data, scope, watchlist, required, sort]);

  const header = (key: SortKey, label: string, className = "") => {
    const active = sort.key === key;
    // 分數類的欄位第一次點是由高到低；名稱、層級、不符合數是由小到大
    const scoreLike = key === "composite" || COMPONENTS.some((c) => c.key === key);
    const ascending = (sort.dir === 1) !== scoreLike;
    return (
      <th scope="col" aria-sort={active ? (ascending ? "ascending" : "descending") : "none"} className={`px-1 py-1 font-medium ${className}`}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
          className={`inline-flex min-h-8 items-center gap-1 rounded px-2 hover:text-ink ${active ? "text-ink" : ""}`}
        >
          {label}
          {active && (ascending ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)}
        </button>
      </th>
    );
  };

  const scopes: { value: Scope; label: string }[] = data
    ? [
        { value: "candidates", label: `候選 ${data.counts.T1 + data.counts.T2 + data.counts.T3}` },
        { value: "T1", label: `T1 ${data.counts.T1}` },
        { value: "T2", label: `T2 ${data.counts.T2}` },
        { value: "T3", label: `T3 ${data.counts.T3}` },
        { value: "all", label: `全部 ${data.stocks.length}` },
        { value: "watch", label: `自選 ${watchlist.length}` },
      ]
    : [{ value: "candidates", label: "候選" }];

  return (
    <>
      <PageHeader
        title="篩選器"
        description={
          <>
            依
            <a href={LINKS.screenerRules} target="_blank" rel="noopener noreferrer" className="mx-1 font-medium text-accent hover:underline">
              事先公開的固定規則
            </a>
            整理公開資料與模型輸出。0–100 綜合評分由五個組成依公開的權重加權；T1、T2、T3 分別是適用的條件全部符合、少一項、少兩項，各層有上限、不足不補位。
            <strong className="font-semibold text-ink">這是研究用的候選清單，不是預測，也不是投資建議。</strong>
          </>
        }
      />

      {error && <Notice tone="error">{errorText(error, "篩選器的資料由每日排程在收盤後產生，目前還沒有這一份。")}</Notice>}

      {loading && <TableSkeleton rows={10} label="篩選器讀取中" />}

      {data && (
        <>
          <ul className="mb-4 flex flex-wrap gap-x-4 gap-y-1.5 text-xs" aria-label="綜合評分的組成與權重">
            {COMPONENTS.map((c) => (
              <li key={c.key} className="flex items-center gap-1.5" title={c.hint}>
                <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ background: c.color }} aria-hidden="true" />
                <span className="text-ink-2">{c.label}</span>
                <span className="text-ink-3">{Math.round(data.weights[c.key] * 100)}%</span>
              </li>
            ))}
          </ul>

          <Panel
            title={`基準日 ${data.base_date}`}
            description={`規則 ${data.rules_version}；價格 ${data.sources.prices ?? "—"}、評價 ${data.sources.valuation ?? "—"}、月營收 ${data.sources.revenue_month ?? "—"}、融資 ${data.sources.margin ?? "—"}（變化涵蓋 ${data.sources.margin_days} 日）、集保 ${data.sources.big_holder_weeks.join("／") || "—"}`}
            actions={
              <button
                type="button"
                disabled={rows.length === 0}
                onClick={() =>
                  downloadCsv(
                    `screener-${data.base_date}.csv`,
                    ["代號", "名稱", "產業", "層級", "綜合", ...COMPONENTS.map((c) => c.label), ...CONDITION_KEYS.map((k) => CONDITIONS[k]), "不符合"],
                    rows.map((s) => [
                      code(s.ticker),
                      s.name,
                      s.industry,
                      s.tier ?? (s.over_cap ? "超過上限" : ""),
                      s.composite,
                      ...COMPONENTS.map((c) => s.components[c.key]),
                      ...CONDITION_KEYS.map((k) => STATE[s.conditions[k]].text),
                      s.misses,
                    ]),
                  )
                }
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border px-2.5 text-xs font-medium text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink disabled:opacity-50"
              >
                <Download size={14} aria-hidden="true" />
                下載 CSV
              </button>
            }
            bodyClassName="p-0"
          >
            <div className="space-y-3 border-b border-border px-4 py-3">
              <Segmented label="列出哪些股票" size="sm" value={scope} onChange={(v) => setParams({ tier: v, t: null })} options={scopes} />
              <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="只看符合這些條件的股票">
                <span className="mr-1 text-xs text-ink-3">只看符合：</span>
                {CONDITION_KEYS.map((k) => {
                  const on = required.includes(k);
                  return (
                    <button
                      key={k}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setRequired((r) => (on ? r.filter((x) => x !== k) : [...r, k]))}
                      className={`inline-flex min-h-8 items-center gap-1 rounded-md border px-2.5 text-xs transition-colors duration-150 ${
                        on ? "border-accent bg-accent-soft font-semibold text-accent" : "border-border text-ink-2 hover:bg-surface-2 hover:text-ink"
                      }`}
                    >
                      {on && <Check size={12} aria-hidden="true" />}
                      {CONDITIONS[k]}
                    </button>
                  );
                })}
                {required.length > 0 && (
                  <button type="button" onClick={() => setRequired([])} className="ml-1 text-xs text-accent hover:underline">
                    清除條件
                  </button>
                )}
              </div>
            </div>

            {rows.length === 0 ? (
              <EmptyState icon={scope === "watch" ? Star : undefined} title={scope === "watch" ? "自選股不在這份清單裡" : "沒有股票同時符合這些條件"}>
                {scope === "watch"
                  ? "在個股頁按「加入自選」，或切到「全部」看 49 檔。"
                  : "取消一個條件，或切到「全部」再看看。不適用的條件（例如金融保險業的營收）不算符合。"}
              </EmptyState>
            ) : (
              <div className="relative overflow-x-auto">
                <table className="w-full min-w-[20rem] text-table">
                  <thead className="sticky top-0 bg-surface-2">
                    <tr className="border-b border-border text-left text-xs text-ink-3">
                      <th scope="col" className="w-10 px-2 py-2">
                        <span className="sr-only">展開</span>
                      </th>
                      {header("name", "股票")}
                      {header("tier", "層級", "text-center")}
                      {header("composite", "綜合", "text-right")}
                      {COMPONENTS.map((c) => (
                        <Fragment key={c.key}>{header(c.key, c.label, "hidden text-right lg:table-cell")}</Fragment>
                      ))}
                      <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                        條件
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((s) => {
                      const expanded = open === s.ticker;
                      const detailId = `detail-${code(s.ticker)}`;
                      return (
                        <Fragment key={s.ticker}>
                          <tr
                            onClick={(e) => {
                              if ((e.target as HTMLElement).closest("a")) return;
                              setParams({ t: expanded ? null : s.ticker });
                            }}
                            className={`cursor-pointer border-t border-border transition-colors duration-150 hover:bg-surface-2 ${expanded ? "bg-surface-2" : ""}`}
                          >
                            <td className="px-2 py-2">
                              <button
                                type="button"
                                aria-expanded={expanded}
                                aria-controls={detailId}
                                aria-label={`${expanded ? "收起" : "展開"} ${s.name} 的分數拆解與入選理由`}
                                className="flex size-8 items-center justify-center rounded-md text-ink-3 hover:bg-surface-3 hover:text-ink"
                              >
                                <ChevronDown size={16} className={`transition-transform duration-150 ${expanded ? "rotate-180" : ""}`} aria-hidden="true" />
                              </button>
                            </td>
                            <td className="px-3 py-2">
                              <span className="font-medium text-ink">{s.name}</span>
                              <span className="ml-2 text-xs text-ink-3">{code(s.ticker)}</span>
                              {watchlist.includes(s.ticker) && <Star size={12} className="ml-1.5 inline fill-current text-warn" aria-label="自選" />}
                              <span className="block text-xs text-ink-3">{s.industry}</span>
                            </td>
                            <td className="px-3 py-2 text-center">
                              {s.tier ? <Badge tone="neutral">{s.tier}</Badge> : <span className="text-xs text-ink-3">{s.over_cap ? "超過上限" : "—"}</span>}
                            </td>
                            <td className="px-3 py-2">
                              <div className="flex items-center justify-end gap-2">
                                <div className="hidden w-20 sm:block">
                                  <ScoreBar stock={s} weights={data.weights} className="h-1.5" />
                                </div>
                                <span className="w-8 text-right font-semibold text-ink">{fixed(s.composite, 0)}</span>
                              </div>
                            </td>
                            {COMPONENTS.map((c) => (
                              <td key={c.key} className="hidden px-3 py-2 text-right text-ink-2 lg:table-cell">
                                {fixed(s.components[c.key], 0)}
                              </td>
                            ))}
                            <td className="hidden px-3 py-2 md:table-cell">
                              <span className="flex gap-0.5">
                                {CONDITION_KEYS.map((k) => {
                                  const st = STATE[s.conditions[k]];
                                  return <st.icon key={k} size={14} className={st.className} aria-label={`${CONDITIONS[k]}：${st.text}`} />;
                                })}
                              </span>
                            </td>
                          </tr>
                          {expanded && (
                            <tr id={detailId} className="bg-surface">
                              <td colSpan={10} className="border-t border-border p-0">
                                <Detail s={s} data={data} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </Panel>

          <p className="mt-4 text-xs leading-relaxed text-ink-3">
            資料來源：評價（本益比、殖利率、股價淨值比）、月營收、融資融券餘額來自臺灣證券交易所；股權分散來自臺灣集中保管結算所
            （政府資料開放平臺資料集，依政府資料開放授權條款第 1 版利用）。動能、均線與突破前高以內部價格計算，只公開衍生值。
            每個組成是股票池 {data.stocks.length} 檔內的百分位（0 最差、100 最好）。綜合評分不存證、不算命中率；相對強弱排序的線上紀錄見「排序」與「監控」。
          </p>
        </>
      )}
    </>
  );
}

export default function ScreenerPage() {
  return (
    <Suspense fallback={<Skeleton className="h-96 w-full" />}>
      <ScreenerView />
    </Suspense>
  );
}
