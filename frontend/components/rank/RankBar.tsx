import type { RankResult } from "@/lib/api";
import type { BadgeTone } from "@/lib/status";

/** 百分位分組（台股慣例：強＝紅、弱＝綠，另附文字） */
export const QUANTILE: Record<RankResult["quantile"], { text: string; tone: BadgeTone }> = {
  top: { text: "強", tone: "up" },
  mid: { text: "中", tone: "hold" },
  bottom: { text: "弱", tone: "down" },
};

/** 分數條的縮放基準：這份清單裡離 0.5 最遠的距離（至少 0.05，避免分數都很接近時被放大成滿格） */
export function rankMaxDev(rows: Pick<RankResult, "score">[]): number {
  return Math.max(0.05, ...rows.map((r) => Math.abs(r.score - 0.5)));
}

/**
 * 分數條：以 0.5（贏過中位數的機率對半）為中線，高於 0.5 往右、低於往左，長度依 maxDev 縮放。
 * 純裝飾，數值另外以文字顯示。
 */
export default function RankBar({ score, maxDev, className = "w-24" }: { score: number; maxDev: number; className?: string }) {
  return (
    <div className={`relative h-1.5 rounded-full bg-surface-3 ${className}`} aria-hidden="true">
      <div
        className={`absolute inset-y-0 ${score >= 0.5 ? "left-1/2 rounded-r-full bg-accent" : "right-1/2 rounded-l-full bg-ink-3"}`}
        style={{ width: `${(Math.abs(score - 0.5) / maxDev) * 50}%` }}
      />
      <div className="absolute -top-0.5 left-1/2 h-2.5 w-px bg-border-strong" />
    </div>
  );
}
