import type { ScreenerResponse, ScreenerStock } from "@/lib/api";
import { fixed } from "@/lib/format";
import { contributions } from "@/lib/screener";

/** 綜合評分的堆疊條：每段是一個組成的貢獻（分數 × 重新正規化的權重），右側灰色是到 100 的差距。 */
export default function ScoreBar({ stock, weights, className = "h-2.5" }: { stock: ScreenerStock; weights: ScreenerResponse["weights"]; className?: string }) {
  const parts = contributions(stock, weights);
  const rest = Math.max(0, 100 - (stock.composite ?? 0));
  return (
    <div
      className={`flex w-full gap-px overflow-hidden rounded-full ${className}`}
      role="img"
      aria-label={`綜合評分 ${fixed(stock.composite, 1)}：${parts.map((p) => `${p.label} ${fixed(p.value, 1)}`).join("、")}`}
    >
      {parts.map((p) => (
        <span
          key={p.key}
          title={`${p.label} ${fixed(p.score, 1)} 分 × 權重 ${Math.round(p.weight * 100)}% ＝ ${fixed(p.value, 1)}`}
          style={{ flex: `${p.value} 1 0`, background: p.color, minWidth: p.value > 0 ? 2 : 0 }}
        />
      ))}
      {rest > 0 && <span className="bg-surface-3" style={{ flex: `${rest} 1 0` }} />}
    </div>
  );
}
