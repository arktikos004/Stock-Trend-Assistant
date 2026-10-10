/** 顯示用的數字與日期格式。缺值一律顯示「—」；負號用 U+2212，與正號等寬。 */

export const DASH = "—";
const MINUS = "−";

const sign = (v: number) => (v > 0 ? "+" : v < 0 ? MINUS : "");

/** 比率 → 帶正負號的百分比：0.0123 → +1.23% */
export function pct(v: number | null | undefined, digits = 1): string {
  if (v == null || Number.isNaN(v)) return DASH;
  return `${sign(v)}${Math.abs(v * 100).toFixed(digits)}%`;
}

/** 比率 → 不帶正負號的百分比：0.306 → 31% */
export function share(v: number | null | undefined, digits = 0): string {
  if (v == null || Number.isNaN(v)) return DASH;
  return `${(v * 100).toFixed(digits)}%`;
}

/** 數值，signed 時帶正負號 */
export function fixed(v: number | null | undefined, digits = 2, signed = false): string {
  if (v == null || Number.isNaN(v)) return DASH;
  return signed ? `${sign(v)}${Math.abs(v).toFixed(digits)}` : v.toFixed(digits);
}

/** 2330.TW → 2330 */
export const code = (ticker: string) => ticker.replace(/\.TW$/, "");

/** 漲跌的方向色（台股：漲紅、跌綠、平盤為一般文字色） */
export const toneVar = (v: number | null | undefined) =>
  v == null || v === 0 ? "var(--ink)" : v > 0 ? "var(--up)" : "var(--down)";

/** ISO 時間 → 台北時間「10/09 15:36」 */
export function taipeiTime(iso: string): string {
  return new Date(iso).toLocaleString("zh-TW", {
    timeZone: "Asia/Taipei",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/** ISO 時間 → 台北日期「2026-10-08」 */
export function taipeiDate(iso: string): string {
  return new Date(iso).toLocaleDateString("sv-SE", { timeZone: "Asia/Taipei" });
}
