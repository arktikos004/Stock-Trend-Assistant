import { describe, expect, it } from "vitest";
import type { MarketResponse } from "@/lib/api";
import { MARKET_BIAS_TONE, marketBias } from "@/lib/market";

// 2026-10-15 的 market.json：三項都偏弱
const MARKET: MarketResponse = {
  as_of: "2026-10-15",
  ret_1d: -0.0341,
  ret_5d: -0.057,
  ma20_bias: -0.0223,
  vol20: 0.0131,
  breadth_up: 0.347,
  breadth_ma5: 0.4776,
};

const STRONG = { breadth_up: 0.62, ma20_bias: 0.018, ret_5d: 0.031 };
const WEAK = { breadth_up: 0.35, ma20_bias: -0.022, ret_5d: -0.057 };

describe("marketBias", () => {
  it("上漲家數比過半、20 日乖離與 5 日報酬都為正 → 偏多", () => {
    expect(marketBias(STRONG)).toBe("偏多");
  });

  it("上漲家數比不到一半、20 日乖離與 5 日報酬都為負 → 偏空", () => {
    expect(marketBias(WEAK)).toBe("偏空");
    expect(marketBias(MARKET)).toBe("偏空");
  });

  it("三項不同向 → 中性", () => {
    expect(marketBias({ ...STRONG, ret_5d: -0.01 })).toBe("中性");
    expect(marketBias({ ...STRONG, breadth_up: 0.4 })).toBe("中性");
    expect(marketBias({ ...WEAK, ma20_bias: 0.005 })).toBe("中性");
    expect(marketBias({ ...WEAK, breadth_up: 0.7 })).toBe("中性");
  });

  it("剛好在門檻上的值不算任何一邊", () => {
    expect(marketBias({ ...STRONG, breadth_up: 0.5 })).toBe("中性");
    expect(marketBias({ ...WEAK, breadth_up: 0.5 })).toBe("中性");
    expect(marketBias({ ...STRONG, ma20_bias: 0 })).toBe("中性");
    expect(marketBias({ ...WEAK, ma20_bias: 0 })).toBe("中性");
    expect(marketBias({ ...STRONG, ret_5d: 0 })).toBe("中性");
    expect(marketBias({ ...WEAK, ret_5d: -0 })).toBe("中性");
  });

  it("任一項缺值或不是有限數值 → 不標（null）", () => {
    expect(marketBias({ ...STRONG, breadth_up: undefined })).toBeNull();
    expect(marketBias({ ...STRONG, ma20_bias: null })).toBeNull();
    expect(marketBias({ ...WEAK, ret_5d: Number.NaN })).toBeNull();
    expect(marketBias({ ...WEAK, ma20_bias: Number.NEGATIVE_INFINITY })).toBeNull();
    expect(marketBias({ breadth_up: 0.6, ma20_bias: 0.01 })).toBeNull();
    expect(marketBias({})).toBeNull();
  });
});

describe("MARKET_BIAS_TONE", () => {
  it("偏多用漲的色、偏空用跌的色、中性不用紅綠", () => {
    expect(MARKET_BIAS_TONE).toEqual({ 偏多: "up", 中性: "neutral", 偏空: "down" });
  });
});
