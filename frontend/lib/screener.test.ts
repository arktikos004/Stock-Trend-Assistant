import { describe, expect, it } from "vitest";
import type { ScreenerResponse, ScreenerStock } from "@/lib/api";
import { compositePercentiles, contributions } from "@/lib/screener";

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

describe("compositePercentiles", () => {
  const pool = (scores: (number | null)[]) => scores.map((composite, i) => ({ ticker: `T${i}`, composite }) as ScreenerStock);

  it("最高 1、最低 0，中間依名次等距", () => {
    const p = compositePercentiles(pool([10, 70, 40]));
    expect([p.get("T0"), p.get("T2"), p.get("T1")]).toEqual([0, 0.5, 1]);
  });

  it("同分取平均，沒有綜合評分的不列入也不占名次", () => {
    const p = compositePercentiles(pool([50, 50, null, 90]));
    expect(p.get("T0")).toBeCloseTo(0.25, 12);
    expect(p.get("T1")).toBeCloseTo(0.25, 12);
    expect(p.has("T2")).toBe(false);
    expect(p.get("T3")).toBe(1);
  });
});
