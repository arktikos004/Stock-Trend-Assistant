import { describe, expect, it } from "vitest";
import type { ScreenerResponse, ScreenerStock } from "@/lib/api";
import { contributions } from "@/lib/screener";

// 與後端 stockta/screener.py 的 WEIGHTS 相同（docs/screener_prereg.md）
const WEIGHTS: ScreenerResponse["weights"] = { rank: 0.3, momentum: 0.2, valuation: 0.15, revenue: 0.2, chips: 0.15 };

function stock(components: ScreenerStock["components"]): ScreenerStock {
  return { components } as ScreenerStock;
}

describe("contributions", () => {
  it("從缺的組成不列入，權重在其餘組成之間重新正規化", () => {
    const parts = contributions(stock({ rank: 80, momentum: 60, valuation: null, revenue: 40, chips: 100 }), WEIGHTS);
    expect(parts.map((p) => p.key)).toEqual(["rank", "momentum", "revenue", "chips"]);
    expect(parts.reduce((sum, p) => sum + p.weight, 0)).toBeCloseTo(1, 12);
  });

  it("貢獻加總等於後端的綜合評分公式 Σ(權重 × 分數) ÷ Σ權重", () => {
    const parts = contributions(stock({ rank: 80, momentum: 60, valuation: null, revenue: 40, chips: 100 }), WEIGHTS);
    const composite = (0.3 * 80 + 0.2 * 60 + 0.2 * 40 + 0.15 * 100) / (0.3 + 0.2 + 0.2 + 0.15);
    expect(parts.reduce((sum, p) => sum + p.value, 0)).toBeCloseTo(composite, 10);
  });

  it("全部組成都有分數時，權重就是原本的權重", () => {
    const parts = contributions(stock({ rank: 50, momentum: 50, valuation: 50, revenue: 50, chips: 50 }), WEIGHTS);
    parts.forEach((p) => expect(p.weight).toBeCloseTo(WEIGHTS[p.key], 12));
  });
});
