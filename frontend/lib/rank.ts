import type { RankResult } from "@/lib/api";

/** 名次最前與最後各 n 檔（都依名次由小到大）；不到 2n 檔時後段只取前段沒用到的，兩邊不重複 */
export function rankEnds(results: RankResult[], n = 3): { top: RankResult[]; bottom: RankResult[] } {
  const sorted = [...results].sort((a, b) => a.rank - b.rank);
  const top = sorted.slice(0, n);
  return { top, bottom: sorted.slice(Math.max(sorted.length - n, top.length)) };
}
