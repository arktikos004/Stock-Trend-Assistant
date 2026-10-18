import { magnitude, radius, TABLE_RADIUS } from "@/lib/magnitude";

/** 表格裡的星點：依百分位的星等畫大小，純裝飾，數值另外以文字顯示。 */
export default function Magnitude({ percentile, className = "" }: { percentile: number; className?: string }) {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true" className={`shrink-0 ${className}`}>
      <circle cx="7" cy="7" r={radius(TABLE_RADIUS, magnitude(percentile))} fill="var(--star)" />
    </svg>
  );
}
