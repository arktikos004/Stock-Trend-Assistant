import { describe, expect, it } from "vitest";
import { magnitude, MAG_STEPS, PLATE_RADIUS, radius, TABLE_RADIUS } from "./magnitude";

describe("magnitude", () => {
  it("puts the strongest sixth at magnitude 1 and the weakest at 6", () => {
    expect(magnitude(1)).toBe(1);
    expect(magnitude(0.9)).toBe(1);
    expect(magnitude(0.8125)).toBe(2);
    expect(magnitude(0.5)).toBe(4);
    expect(magnitude(0.1)).toBe(6);
    expect(magnitude(0)).toBe(MAG_STEPS);
  });

  it("treats missing values as the faintest step", () => {
    expect(magnitude(Number.NaN)).toBe(MAG_STEPS);
  });

  it("shrinks monotonically and keeps plate marks at least 8px wide", () => {
    for (const scale of [TABLE_RADIUS, PLATE_RADIUS]) {
      for (let m = 1; m < MAG_STEPS; m++) expect(radius(scale, m)).toBeGreaterThan(radius(scale, m + 1));
    }
    expect(Math.min(...PLATE_RADIUS) * 2).toBeGreaterThanOrEqual(8);
  });
});
