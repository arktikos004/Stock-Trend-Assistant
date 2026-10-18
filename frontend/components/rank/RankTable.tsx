"use client";

/**
 * 相對強弱排序表：總覽（前 10 名、自選）與排序頁（全池）共用。
 * 分數＝模型預測「未來 5 個交易日贏過全池中位數」的機率；星點是依百分位的星等（6 級，越大越強）。
 * 分組（前 20%、中段、後 20%）只寫成字，不上漲跌色（紅綠只表示價格方向）；兩端比中段深一階。
 * 點股票名稱進個股頁；可排序的欄位標 aria-sort。
 */

import { ArrowDown, ArrowUp, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import Magnitude from "@/components/rank/Magnitude";
import Badge from "@/components/ui/Badge";
import type { RankResult, Tier } from "@/lib/api";
import { code, share } from "@/lib/format";
import { QUANTILE } from "@/lib/status";

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
    if (!sortable) return <th scope="col" className={`px-2 py-2.5 font-normal ${className}`}>{label}</th>;
    const active = sort.key === key;
    return (
      <th scope="col" aria-sort={active ? (sort.dir === 1 ? "ascending" : "descending") : "none"} className={`px-0.5 py-1 font-normal ${className}`}>
        <button
          type="button"
          onClick={() => setSort((s) => ({ key, dir: s.key === key ? (s.dir === 1 ? -1 : 1) : 1 }))}
          className={`inline-flex min-h-8 items-center gap-1 whitespace-nowrap rounded-[3px] px-1.5 hover:text-ink ${active ? "text-ink" : ""}`}
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
        <thead className="sticky top-14 z-10 bg-background [&_th]:shadow-[inset_0_-1px_0_var(--border)]">
          <tr className="text-left text-xs text-ink-3">
            {header("rank", "名次", "w-14 text-right")}
            {header("name", "股票")}
            <th scope="col" className="px-2 py-2.5 font-normal">
              模型分數
            </th>
            <th scope="col" className="hidden px-2 py-2.5 text-right font-normal sm:table-cell">
              百分位
            </th>
            <th scope="col" className="px-2 py-2.5 text-center font-normal">
              分組
            </th>
            {tiers && header("tier", "篩選", "hidden text-center md:table-cell")}
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => {
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
                className="hairline-b cursor-pointer transition-colors duration-150 hover:bg-surface-2"
              >
                <td className="px-2 py-2.5 text-right text-ink-2">{r.rank}</td>
                <td className="px-2 py-2.5">
                  <Link href={href} className="inline-flex items-baseline gap-2 rounded-[3px] font-serif text-[15px] font-semibold text-ink hover:underline">
                    {r.name}
                    <span className="font-sans text-xs font-normal text-ink-3">{code(r.ticker)}</span>
                  </Link>
                  {watchlist.includes(r.ticker) && <Star size={12} className="ml-1.5 inline fill-current align-baseline text-ink" aria-label="自選" />}
                </td>
                <td className="px-2 py-2.5">
                  <div className="flex items-center gap-2.5">
                    <Magnitude percentile={r.percentile} />
                    <span className="text-ink">{r.score.toFixed(3)}</span>
                  </div>
                </td>
                <td className="hidden px-2 py-2.5 text-right text-ink-2 sm:table-cell">{share(r.percentile)}</td>
                <td className="px-2 py-2.5 text-center">
                  <span className={`text-xs ${r.quantile === "mid" ? "text-ink-3" : "text-ink-2"}`}>{QUANTILE[r.quantile]}</span>
                </td>
                {tiers && (
                  <td className="hidden px-2 py-2.5 text-center md:table-cell">
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
