import { describe, expect, it } from "vitest";
import { code, fixed, pct, share, toneVar } from "@/lib/format";

describe("pct", () => {
  it("比率轉成帶正負號的百分比，負號是真正的減號", () => {
    expect(pct(0.0123, 2)).toBe("+1.23%");
    expect(pct(-0.05)).toBe("−5.0%");
    expect(pct(0)).toBe("0.0%");
  });

  it("缺值顯示破折號", () => {
    expect(pct(null)).toBe("—");
    expect(pct(undefined)).toBe("—");
    expect(pct(Number.NaN)).toBe("—");
  });
});

describe("share", () => {
  it("比率轉成不帶正負號的百分比", () => {
    expect(share(0.306)).toBe("31%");
    expect(share(0.5, 1)).toBe("50.0%");
    expect(share(null)).toBe("—");
  });
});

describe("fixed", () => {
  it("固定位數；signed 時帶正負號", () => {
    expect(fixed(1.234)).toBe("1.23");
    expect(fixed(-1.234, 1, true)).toBe("−1.2");
    expect(fixed(0.5, 2, true)).toBe("+0.50");
    expect(fixed(undefined)).toBe("—");
  });
});

describe("code 與 toneVar", () => {
  it("2330.TW → 2330", () => {
    expect(code("2330.TW")).toBe("2330");
    expect(code("^TWII")).toBe("^TWII");
  });

  it("台股慣例：漲紅、跌綠、平盤與缺值為一般文字色", () => {
    expect(toneVar(0.01)).toBe("var(--up)");
    expect(toneVar(-0.01)).toBe("var(--down)");
    expect(toneVar(0)).toBe("var(--ink)");
    expect(toneVar(null)).toBe("var(--ink)");
  });
});
