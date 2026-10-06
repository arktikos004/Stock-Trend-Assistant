"use client";

/**
 * 篩選器與綜合評分（規則見 docs/screener_prereg.md）：研究用的候選清單，不是預測、也不是投資建議。
 * 0–100 綜合評分＝五個組成（排序、動能、評價、營收、籌碼）依公開的權重加權；
 * T1／T2／T3＝適用的條件全部符合、少一項、少兩項，各層有上限、不足不補位。
 * 組成的顏色是類別色（避開台股漲跌的紅綠），每個組成都另以文字列出分數，不只靠顏色辨識。
 */

import { type CSSProperties, useEffect, useMemo, useState } from "react";
import NavTabs from "@/components/NavTabs";
import ThemeToggle from "@/components/ThemeToggle";
import {
  api,
  ApiError,
  type ConditionKey,
  type ConditionState,
  type ScreenerComponentKey,
  type ScreenerResponse,
  type ScreenerStock,
  type Tier,
} from "@/lib/api";

const RULES_URL = "https://github.com/arktikos004/Stock-Trend-Assistant/blob/master/docs/screener_prereg.md";

// 順序＝堆疊順序＝驗證過的色序（globals.css 的 --series-1..5）
const COMPONENTS: { key: ScreenerComponentKey; label: string; color: string; hint: string }[] = [
  { key: "rank", label: "排序", color: "var(--series-1)", hint: "相對強弱排序模型的百分位" },
  { key: "momentum", label: "動能", color: "var(--series-2)", hint: "20 日、60 日報酬的百分位" },
  { key: "valuation", label: "評價", color: "var(--series-3)", hint: "盈餘殖利率、現金殖利率、淨值市價比" },
  { key: "revenue", label: "營收", color: "var(--series-4)", hint: "月營收與累計營收年增率；金融保險業不計" },
  { key: "chips", label: "籌碼", color: "var(--series-5)", hint: "融資餘額變化、千張大戶持股週變化" },
];

const CONDITIONS: Record<ConditionKey, string> = {
  C1: "相對強弱前 40%",
  C2: "60 日報酬高於中位數",
  C3: "評價分數 ≥ 50",
  C4: "月營收年增",
  C5: "融資未增加",
  C6: "突破前高或均線多頭",
};

const CONDITION_STYLE: Record<ConditionState, { mark: string; text: string; style: CSSProperties }> = {
  pass: { mark: "✓", text: "符合", style: { background: "var(--accent-soft)", color: "var(--accent)" } },
  fail: { mark: "✗", text: "不符合", style: { background: "var(--surface-2)", color: "var(--ink-3)" } },
  missing: { mark: "?", text: "缺資料", style: { border: "1px dashed var(--border)", color: "var(--ink-3)" } },
  na: { mark: "—", text: "不適用", style: { color: "var(--ink-3)" } },
};

const TIERS: { tier: Tier; title: string }[] = [
  { tier: "T1", title: "適用的條件全部符合" },
  { tier: "T2", title: "少一項" },
  { tier: "T3", title: "少兩項" },
];

const num = (v: number | null, digits = 1) => (v == null ? "—" : v.toFixed(digits));
const signedPct = (v: number | null, digits = 1) => (v == null ? "—" : `${v > 0 ? "+" : ""}${(v * 100).toFixed(digits)}%`);
const signedNum = (v: number | null, digits = 1, unit = "") => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toFixed(digits)}${unit}`);

/** 各組成對綜合評分的貢獻：權重在有分數的組成之間重新正規化，加總＝綜合評分。 */
function contributions(stock: ScreenerStock, weights: ScreenerResponse["weights"]) {
  const present = COMPONENTS.filter((c) => stock.components[c.key] != null);
  const total = present.reduce((sum, c) => sum + weights[c.key], 0);
  return present.map((c) => {
    const score = stock.components[c.key] as number;
    const weight = weights[c.key] / total;
    return { ...c, score, weight, value: weight * score };
  });
}

function ScoreBar({ stock, weights }: { stock: ScreenerStock; weights: ScreenerResponse["weights"] }) {
  const parts = contributions(stock, weights);
  const rest = Math.max(0, 100 - (stock.composite ?? 0));
  return (
    <div
      className="flex h-3 w-full gap-[2px]"
      role="img"
      aria-label={`綜合評分 ${num(stock.composite)}：${parts.map((p) => `${p.label} ${num(p.value)}`).join("、")}`}
    >
      {parts.map((p, i) => (
        <span
          key={p.key}
          title={`${p.label} ${num(p.score)} 分 × 權重 ${Math.round(p.weight * 100)}% ＝ ${num(p.value)}`}
          className={i === parts.length - 1 ? "rounded-r-[4px]" : ""}
          style={{ flex: `${p.value} 1 0`, background: p.color, minWidth: p.value > 0 ? 2 : 0 }}
        />
      ))}
      {rest > 0 && <span className="rounded-r-[4px] bg-surface-2" style={{ flex: `${rest} 1 0` }} />}
    </div>
  );
}

function StockCard({ stock, data }: { stock: ScreenerStock; data: ScreenerResponse }) {
  const m = stock.metrics;
  const facts: [string, string][] = [
    ["本益比", m.pe == null ? "—（虧損或無法計算）" : num(m.pe)],
    ["殖利率", m.dividend_yield == null ? "—" : `${num(m.dividend_yield, 2)}%`],
    ["淨值比", num(m.pb, 2)],
    ["月營收年增", stock.conditions.C4 === "na" ? "不計" : signedNum(m.revenue_yoy, 1, "%")],
    [`融資 ${data.sources.margin_days} 日`, signedPct(m.margin_change, 2)],
    ["大戶週變化", signedNum(m.big_holder_change, 2, " 點")],
    ["20 日報酬", signedPct(m.ret20)],
    ["60 日報酬", signedPct(m.ret60)],
  ];
  return (
    <li className="rounded-2xl border border-border bg-surface p-4 shadow-(--shadow-sm)">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-base font-semibold text-ink">{stock.name}</span>
            <span className="font-mono text-xs text-ink-3">{stock.ticker.replace(/\.TW$/, "")}</span>
            {stock.industry && <span className="text-xs text-ink-3">{stock.industry}</span>}
          </p>
          {stock.missing.length > 0 && (
            <p className="mt-0.5 text-xs text-ink-3">
              從缺：{stock.missing.map((k) => COMPONENTS.find((c) => c.key === k)?.label).join("、")}（權重改由其他組成分攤）
            </p>
          )}
        </div>
        <div className="shrink-0 text-right">
          <p className="text-2xl font-semibold text-ink">{num(stock.composite, 0)}</p>
          <p className="text-xs text-ink-3">綜合評分</p>
        </div>
      </div>

      <div className="mt-3">
        <ScoreBar stock={stock} weights={data.weights} />
      </div>
      {/* 表格視圖：每個組成的分數都以文字列出（顏色只是旁邊的識別記號） */}
      <dl className="mt-2 grid grid-cols-5 gap-1 text-center">
        {COMPONENTS.map((c) => (
          <div key={c.key}>
            <dt className="flex items-center justify-center gap-1 text-[11px] text-ink-3">
              <span className="inline-block size-2 rounded-[2px]" style={{ background: c.color }} />
              {c.label}
            </dt>
            <dd className="font-mono text-sm tabular-nums text-ink-2">{num(stock.components[c.key], 0)}</dd>
          </div>
        ))}
      </dl>

      <ul className="mt-3 flex flex-wrap gap-1.5">
        {(Object.keys(CONDITIONS) as ConditionKey[]).map((k) => {
          const state = stock.conditions[k];
          const s = CONDITION_STYLE[state];
          return (
            <li
              key={k}
              className="rounded-full px-2 py-0.5 text-xs"
              style={s.style}
              title={`${k} ${CONDITIONS[k]}：${s.text}`}
            >
              <span aria-hidden="true">{s.mark} </span>
              {CONDITIONS[k]}
              <span className="sr-only">：{s.text}</span>
            </li>
          );
        })}
      </ul>

      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 text-xs sm:grid-cols-4">
        {facts.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-2">
            <dt className="text-ink-3">{k}</dt>
            <dd className="font-mono tabular-nums text-ink-2">{v}</dd>
          </div>
        ))}
      </dl>
    </li>
  );
}

export default function ScreenerPage() {
  const [data, setData] = useState<ScreenerResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .screener()
      .then((d) => !cancelled && setData(d))
      .catch((e) => {
        if (cancelled) return;
        // 404＝這一份還沒產生（新功能上線後，要等下一次每日排程匯出），不是排程失敗
        if (e instanceof ApiError && e.status === 404) setError("篩選器的資料由每日排程（收盤後）產生，目前還沒有這一份。");
        else setError(e instanceof ApiError ? e.message : "讀取失敗，請重新整理");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const unlisted = useMemo(() => (data ? data.stocks.filter((s) => s.tier == null) : []), [data]);

  return (
    <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
      <header className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-accent text-accent-fg shadow-(--shadow-md)">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 4h18l-7 8v6l-4 2v-8z" />
            </svg>
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight sm:text-2xl">台股趨勢預測助理</h1>
            <p className="mt-0.5 text-sm text-ink-3">篩選器 · 綜合評分拆解與 T1／T2／T3 候選</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <NavTabs current="screener" />
          <ThemeToggle />
        </div>
      </header>

      <section className="mb-5 rounded-2xl border border-border bg-surface p-4 text-sm text-ink-2 shadow-(--shadow-sm)">
        <p>
          研究用的候選清單：依
          <a href={RULES_URL} target="_blank" rel="noopener noreferrer" className="mx-1 font-medium text-accent hover:underline">
            事先公開的固定規則
          </a>
          整理公開資料與模型輸出，<strong className="text-ink">不是預測，也不是投資建議</strong>。
          權重不是從資料最佳化來的；綜合評分不存證、不算命中率（相對強弱排序的線上紀錄見「全池掃描」）。
        </p>
        {/* 圖例：兩個以上的類別一律附圖例；權重公開 */}
        {data && (
          <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5 text-xs">
            {COMPONENTS.map((c) => (
              <li key={c.key} className="flex items-center gap-1.5" title={c.hint}>
                <span className="inline-block h-2.5 w-4 rounded-[2px]" style={{ background: c.color }} />
                <span className="text-ink-2">{c.label}</span>
                <span className="font-mono tabular-nums text-ink-3">{Math.round(data.weights[c.key] * 100)}%</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {error && (
        <div className="mb-5 rounded-xl border border-border bg-surface-2 px-4 py-3 text-sm text-ink-2">{error}</div>
      )}

      {!data && !error && (
        <div className="flex h-48 items-center justify-center rounded-2xl border border-border text-sm text-ink-3">讀取中…</div>
      )}

      {data && (
        <>
          <p className="mb-4 text-xs text-ink-3">
            基準日 {data.base_date} · 規則 {data.rules_version} · 資料：價格 {data.sources.prices ?? "—"}、評價 {data.sources.valuation ?? "—"}、
            月營收 {data.sources.revenue_month ?? "—"}（出表 {data.sources.revenue ?? "—"}）、融資 {data.sources.margin ?? "—"}（變化涵蓋 {data.sources.margin_days} 日
            {data.sources.margin_days < 5 ? "，滿 5 日前會較短" : ""}）、集保 {data.sources.big_holder_weeks.join("／") || "—"}
            {data.sources.big_holder_weeks.length < 2 ? "（累積兩週才有週變化）" : ""}
          </p>

          {TIERS.map(({ tier, title }) => {
            const rows = data.stocks.filter((s) => s.tier === tier);
            return (
              <section key={tier} className="mb-6">
                <h2 className="mb-2 flex flex-wrap items-baseline gap-x-2 text-sm font-semibold text-ink">
                  <span className="rounded-md bg-accent px-1.5 py-0.5 text-xs text-accent-fg">{tier}</span>
                  {title}
                  <span className="font-normal text-ink-3">
                    {rows.length} 檔（上限 {data.tier_caps[tier]}，不足不補位）
                  </span>
                </h2>
                {rows.length > 0 ? (
                  <ul className="grid gap-3 md:grid-cols-2">
                    {rows.map((s) => (
                      <StockCard key={s.ticker} stock={s} data={data} />
                    ))}
                  </ul>
                ) : (
                  <p className="rounded-xl border border-dashed border-border px-4 py-3 text-sm text-ink-3">這一層今天沒有股票。</p>
                )}
              </section>
            );
          })}

          <details className="mb-6 rounded-2xl border border-border bg-surface p-4 shadow-(--shadow-sm)">
            <summary className="cursor-pointer text-sm font-semibold text-ink">
              全部 {data.stocks.length} 檔的分數表（其中 {unlisted.length} 檔未列入候選）
            </summary>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="text-ink-3">
                  <tr>
                    <th className="py-1 pr-2 font-medium">股票</th>
                    <th className="py-1 pr-2 text-right font-medium">綜合</th>
                    {COMPONENTS.map((c) => (
                      <th key={c.key} className="py-1 pr-2 text-right font-medium">
                        {c.label}
                      </th>
                    ))}
                    <th className="py-1 pr-2 text-right font-medium">不符合</th>
                    <th className="py-1 font-medium">分層</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums text-ink-2">
                  {[...data.stocks]
                    .sort((a, b) => (b.composite ?? -1) - (a.composite ?? -1))
                    .map((s) => (
                      <tr key={s.ticker} className="border-t border-border">
                        <td className="py-1 pr-2 font-sans text-ink">
                          {s.name} <span className="text-ink-3">{s.ticker.replace(/\.TW$/, "")}</span>
                        </td>
                        <td className="py-1 pr-2 text-right text-ink">{num(s.composite)}</td>
                        {COMPONENTS.map((c) => (
                          <td key={c.key} className="py-1 pr-2 text-right">
                            {num(s.components[c.key])}
                          </td>
                        ))}
                        <td className="py-1 pr-2 text-right">{s.misses}</td>
                        <td className="py-1 font-sans">{s.tier ?? (s.over_cap ? "超過上限" : "—")}</td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </details>

          <p className="text-xs leading-relaxed text-ink-3">
            資料來源：評價（本益比、殖利率、股價淨值比）、月營收、融資融券餘額為臺灣證券交易所；股權分散為臺灣集中保管結算所
            （政府資料開放平臺資料集，依政府資料開放授權條款第 1 版利用）。動能、均線與突破前高以內部價格計算，只公開衍生值。
            每個組成是股票池 {data.stocks.length} 檔內的百分位（0 最差、100 最好）。
          </p>
        </>
      )}
    </main>
  );
}
