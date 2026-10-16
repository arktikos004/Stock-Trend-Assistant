import { describe, expect, it } from "vitest";
import type { RankResult } from "@/lib/api";
import { rankEnds } from "@/lib/rank";

/** n 檔的排序結果，名次 1..n（分數高＝名次小） */
function ranked(n: number): RankResult[] {
  return Array.from({ length: n }, (_, i) => ({
    ticker: `${1000 + i}.TW`,
    name: `股票${i + 1}`,
    score: 0.9 - i * 0.01,
    rank: i + 1,
    percentile: n > 1 ? 1 - i / (n - 1) : 1,
    quantile: "mid",
  }));
}

const ranks = (rows: RankResult[]) => rows.map((r) => r.rank);

describe("rankEnds", () => {
  it("49 檔：前三是第 1–3 名，後三是第 47–49 名，都依名次由小到大", () => {
    const { top, bottom } = rankEnds(ranked(49));
    expect(ranks(top)).toEqual([1, 2, 3]);
    expect(ranks(bottom)).toEqual([47, 48, 49]);
  });

  it("依名次挑，不依陣列順序", () => {
    const rows = ranked(10).reverse();
    const { top, bottom } = rankEnds(rows);
    expect(ranks(top)).toEqual([1, 2, 3]);
    expect(ranks(bottom)).toEqual([8, 9, 10]);
    expect(ranks(rows)[0]).toBe(10); // 不改動傳入的陣列
  });

  it("不到 6 檔時前三與後三不重複", () => {
    expect(ranks(rankEnds(ranked(4)).top)).toEqual([1, 2, 3]);
    expect(ranks(rankEnds(ranked(4)).bottom)).toEqual([4]);
    expect(ranks(rankEnds(ranked(2)).top)).toEqual([1, 2]);
    expect(ranks(rankEnds(ranked(2)).bottom)).toEqual([]);
  });

  it("沒有資料時兩邊都是空的", () => {
    expect(rankEnds([])).toEqual({ top: [], bottom: [] });
  });

  it("可以指定每邊幾檔", () => {
    const { top, bottom } = rankEnds(ranked(49), 5);
    expect(ranks(top)).toEqual([1, 2, 3, 4, 5]);
    expect(ranks(bottom)).toEqual([45, 46, 47, 48, 49]);
  });
});
