/**
 * 融資融券與大戶持股（個股頁的 ChipsPanel）：數字格式、最新值、資料來源的顯名，以及小折線圖的座標。
 * 資料是 /api/stocks/{t}/chips 的序列（由舊到新）；融資成本與維持率是本站估算，頁面上一律標「估」。
 */

import type { ChipsHolderWeek, ChipsMarginDay, ChipsResponse } from "@/lib/api";
import { DASH } from "@/lib/format";

const MINUS = "−";
const signOf = (v: number) => (v > 0 ? "+" : v < 0 ? MINUS : "");
const missing = (v: number | null | undefined): v is null | undefined => v == null || Number.isNaN(v);

/** 張數或人數：千分位整數；signed 時帶正負號（負號用 U+2212，與正號等寬） */
export function count(v: number | null | undefined, signed = false): string {
  if (missing(v)) return DASH;
  const n = Math.round(v);
  const body = Math.abs(n).toLocaleString("en-US");
  return signed ? `${signOf(n)}${body}` : `${n < 0 ? MINUS : ""}${body}`;
}

/** 本身已是百分比的數字：0.5279 → 0.53% */
export function percent(v: number | null | undefined, digits = 2): string {
  return missing(v) ? DASH : `${v.toFixed(digits)}%`;
}

/** 百分點的變化，帶正負號：0.01 → +0.01 */
export function pp(v: number | null | undefined, digits = 2): string {
  if (missing(v)) return DASH;
  const rounded = Number(v.toFixed(digits));
  return `${signOf(rounded)}${Math.abs(rounded).toFixed(digits)}`;
}

/** 價格：千分位、小數 2 位 */
export function price(v: number | null | undefined): string {
  return missing(v) ? DASH : v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 最新一天、最新一週，以及週變化所比較的前一週 */
export function latest(chips: ChipsResponse): { day: ChipsMarginDay | null; week: ChipsHolderWeek | null; prevWeek: string | null } {
  const { margin, holders } = chips;
  return {
    day: margin.at(-1) ?? null,
    week: holders.at(-1) ?? null,
    prevWeek: holders.length > 1 ? holders[holders.length - 2].date : null,
  };
}

/** 政府資料開放授權條款要求的顯名：提供機關、資料集名稱與授權條款（同一個機關的資料集合併成一句） */
export function sourceLine(chips: ChipsResponse): string {
  const byProvider = new Map<string, string[]>();
  for (const s of chips.meta.sources) byProvider.set(s.provider, [...(byProvider.get(s.provider) ?? []), `「${s.title}」`]);
  const parts = [...byProvider].map(([provider, titles], i) => `${provider}（${i === 0 ? "政府資料開放平臺" : ""}${titles.join("")}資料集）`);
  return `資料來源：${parts.join("、")}，依${chips.meta.license}利用。`;
}

/**
 * 折線圖的刻度：1、2、5 × 10ⁿ 的倍數，涵蓋 [min, max]、最多 maxIntervals 格。
 * 資料是張數（整數），間距至少 1；全部相同時上下各留一點空間，線畫在中間。
 */
export function niceTicks(min: number, max: number, maxIntervals = 3): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || min > max) return [];
  if (min === max) {
    const pad = Math.max(1, Math.abs(min) * 0.05);
    return niceTicks(min >= 0 ? Math.max(0, min - pad) : min - pad, max + pad, maxIntervals);
  }
  for (let mag = Math.max(1, 10 ** Math.floor(Math.log10((max - min) / maxIntervals))); ; mag *= 10) {
    for (const m of [1, 2, 5]) {
      const step = m * mag;
      const lo = Math.floor(min / step);
      const hi = Math.ceil(max / step);
      if (hi - lo <= maxIntervals) return Array.from({ length: hi - lo + 1 }, (_, i) => (lo + i) * step);
    }
  }
}

export type Point = { x: number; y: number };

/** 依索引等距排在 [0, width]（交易日等距，不留週末空白），值映射到 [height, 0]（大的在上）；缺值把線斷開 */
export function linePath(
  values: (number | null)[],
  { width, height, lo, hi }: { width: number; height: number; lo: number; hi: number },
): { points: (Point | null)[]; segments: string[] } {
  const n = values.length;
  const span = hi - lo || 1;
  const r = (v: number) => Math.round(v * 10) / 10 + 0; // + 0：把 −0 變成 0
  const points = values.map((v, i) =>
    v == null ? null : { x: r(n > 1 ? (i / (n - 1)) * width : width / 2), y: r(height - ((v - lo) / span) * height) },
  );
  const segments: string[] = [];
  let current = "";
  for (const p of points) {
    if (p) {
      current += `${current ? "L" : "M"}${p.x},${p.y}`;
    } else if (current) {
      segments.push(current);
      current = "";
    }
  }
  if (current) segments.push(current);
  return { points, segments };
}

/** 指標的 x → 最近的資料索引（夾在兩端） */
export function nearestIndex(x: number, width: number, n: number): number {
  if (n <= 1 || width <= 0) return 0;
  return Math.min(n - 1, Math.max(0, Math.round((x / width) * (n - 1))));
}
