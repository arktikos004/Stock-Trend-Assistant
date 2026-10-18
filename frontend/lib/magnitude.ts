/**
 * 星等刻度：依百分位分成 6 級，第 1 級是最強的六分之一。星點越大越強，只表示在股票池裡的相對位置。
 * 表格用小星點（純裝飾，數值另外以文字顯示）；星圖的點是資料標記，半徑至少 4px。
 */

export const MAG_STEPS = 6;

/** 百分位（1＝最強）→ 星等 1–6 */
export function magnitude(percentile: number): number {
  if (!Number.isFinite(percentile)) return MAG_STEPS;
  return Math.min(MAG_STEPS, Math.max(1, 1 + Math.floor((1 - percentile) * MAG_STEPS)));
}

/** 表格裡的星點半徑（14px 見方的圖示內），依星等 1–6 */
export const TABLE_RADIUS = [6, 5, 4, 3.2, 2.5, 1.8] as const;

/** 星圖上的星點半徑，依星等 1–6；最小 4px，符合資料標記至少 8px 直徑 */
export const PLATE_RADIUS = [10, 8.5, 7, 5.75, 4.75, 4] as const;

export const radius = (scale: readonly number[], mag: number) => scale[Math.min(MAG_STEPS, Math.max(1, mag)) - 1];
