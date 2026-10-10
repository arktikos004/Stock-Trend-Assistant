"use client";

/**
 * 相對強弱排序表：總覽（前 10 名、自選）與排序頁（全池 49 檔）共用。
 * 分數＝模型預測「未來 5 個交易日贏過全池中位數」的機率；分組依百分位分強、中、弱（台股慣例：強＝紅、弱＝綠，另附文字）。
 * 點股票名稱進個股頁；可排序的欄位標 aria-sort。
 */

import { ArrowDown, ArrowUp, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import RankBar, { QUANTILE, rankMaxDev } from "@/components/rank/RankBar";
import Badge from "@/components/ui/Badge";
import type { RankResult, Tier } from "@/lib/api";
import { code, share } from "@/lib/format";

type SortKey = "rank" | "name" | "tier";

export default function RankTable({
  rows,
  tiers,
  watchlist = [],
  sortable = false,
}: {
  rows: RankResult[];
  tiers?: Map<string, Tier | null>;
  watchlist?: string[];
  sortable?: boolean;
}) {
  const router = useRouter();
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: "rank", dir: 1 });
  const maxDev = rankMaxDev(rows);

  const sorted = useMemo(() => {
    if (!sortable) return rows;
    const TIER_ORDER: Record<string, number> = { T1: 1, T2: 2, T3: 3 };
    const tierOrder = (t: string) => TIER_ORDER[tiers?.get(t) ?? ""] ?? 9;
    const list = [...rows];
    list.sort((a, b) => {
      const d =
        sort.key === "rank" ? a.rank - b.rank : sort.key === "name" ? a.name.localeCompare(b.name, "zh-Hant") : tierOrder(a.ticker) - tierOrder(b.ticker) || a.rank - b.rank;
      return d * sort.dir;
    });
    return list;
  }, [rows, sortable, sort, tiers]);

  const header = (key: SortKey, label: string, className = "") => {
    if (!sortable) return <th scope="col" className={`px-3 py-2 font-medium ${className}`}>{label}</th>;
    const active = sort.key === key;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={`px-1 py-1 font-medium ${className}`}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
          className={`inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded px-2 hover:text-ink ${active ? "text-ink" : ""}`}
        >
          {label}
          {active && (sort.dir === 1 ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />)}
        </button>
      </th>
    );
  };

  return (
    // 不包水平捲動容器：捲動容器會讓表頭的 sticky 失效。欄位在窄螢幕依序隱藏，390 寬也放得下
    <div className="relative">
      <table className="w-full text-table">
        <thead className="sticky top-14 z-10 bg-surface-2 [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
          <tr className="text-left text-xs text-ink-3">
            {header("rank", "名次", "w-16 text-right")}
            {header("name", "股票")}
            <th scope="col" className="px-3 py-2 font-medium">
              分數
            </th>
            <th scope="col" className="hidden px-3 py-2 text-right font-medium sm:table-cell">
              百分位
            </th>
            <th scope="col" className="px-3 py-2 text-center font-medium">
              分組
            </th>
            {tiers && header("tier", "篩選", "hidden text-center md:table-cell")}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {sorted.map((r) => {
            const q = QUANTILE[r.quantile];
            const tier = tiers?.get(r.ticker) ?? null;
            const href = `/stock?t=${encodeURIComponent(r.ticker)}`;
            return (
              <tr
                key={r.ticker}
                onClick={(e) => {
                  // 整列都可以點；名稱本身是連結，鍵盤使用者用 Tab 走連結
                  if ((e.target as HTMLElement).closest("a,button")) return;
                  router.push(href);
                }}
                className="cursor-pointer transition-colors duration-150 hover:bg-surface-2"
              >
                <td className="px-3 py-2 text-right font-semibold text-ink">{r.rank}</td>
                <td className="px-3 py-2">
                  <Link href={href} className="inline-flex items-baseline gap-2 rounded-sm font-medium text-ink hover:underline">
                    {r.name}
                    <span className="text-xs font-normal text-ink-3">{code(r.ticker)}</span>
                  </Link>
                  {watchlist.includes(r.ticker) && (
                    <Star size={12} className="ml-1.5 inline fill-current align-baseline text-warn" aria-label="自選" />
                  )}
                </td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <RankBar score={r.score} maxDev={maxDev} className="hidden w-24 sm:block" />
                    <span className="text-ink-2">{r.score.toFixed(3)}</span>
                  </div>
                </td>
                <td className="hidden px-3 py-2 text-right text-ink-2 sm:table-cell">{share(r.percentile)}</td>
                <td className="px-3 py-2 text-center">
                  <Badge tone={q.tone}>{q.text}</Badge>
                </td>
                {tiers && (
                  <td className="hidden px-3 py-2 text-center md:table-cell">
                    {tier ? <Badge tone="neutral">{tier}</Badge> : <span className="text-ink-3">—</span>}
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
