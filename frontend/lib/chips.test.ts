import { describe, expect, it } from "vitest";
import type { ChipsHolderWeek, ChipsMarginDay, ChipsResponse } from "@/lib/api";
import { count, latest, linePath, nearestIndex, niceTicks, percent, pp, price, sourceLine } from "@/lib/chips";

const day = (date: string, margin_balance: number | null, short_balance: number | null = 1): ChipsMarginDay => ({
  date,
  close: 10,
  volume_lots: 1,
  margin_buy: 0,
  margin_sell: 0,
  margin_redeem: 0,
  margin_balance,
  margin_change: 0,
  margin_limit: 100,
  margin_usage_pct: 1,
  short_sell: 0,
  short_buy: 0,
  short_redeem: 0,
  short_balance,
  short_change: 0,
  short_margin_pct: 1,
  offset: 0,
  margin_cost: 10,
  maintenance_pct: 166.67,
});

const week = (date: string, big_pct: number): ChipsHolderWeek => ({
  date,
  big_pct,
  big_holders: 1,
  big_pct_change: null,
  big_holders_change: null,
  over400_pct: big_pct,
  over400_holders: 1,
  over400_pct_change: null,
  over400_holders_change: null,
});

const source = (dataset: string, provider: string, title: string) => ({
  dataset,
  title,
  provider,
  gov_id: 1,
  dataset_url: "https://data.gov.tw/dataset/1",
  source_urls: [],
  attribution: "",
});

const chips = (margin: ChipsMarginDay[], holders: ChipsHolderWeek[]): ChipsResponse => ({
  ticker: "2330.TW",
  margin,
  holders,
  meta: {
    margin_start: margin[0]?.date ?? null,
    margin_end: margin.at(-1)?.date ?? null,
    cost_start: null,
    holders_start: holders[0]?.date ?? null,
    holders_end: holders.at(-1)?.date ?? null,
    estimates: ["margin_cost", "maintenance_pct"],
    estimate_label: "本站估算",
    margin_rate: 0.6,
    sources: [
      source("MI_MARGN", "臺灣證券交易所", "融資融券與可借券賣出額度 > 融資融券餘額"),
      source("STOCK_DAY_ALL", "臺灣證券交易所", "盤後資訊 > 個股日成交資訊"),
      source("TDCC_OD_1-5", "臺灣集中保管結算所", "集保戶股權分散表"),
    ],
    license: "政府資料開放授權條款第1版",
    license_url: "https://data.gov.tw/license",
  },
});

describe("數字格式", () => {
  it("張數與人數是千分位整數；增減帶正負號，負號是真正的減號", () => {
    expect(count(34223)).toBe("34,223");
    expect(count(457, true)).toBe("+457");
    expect(count(-1500, true)).toBe("−1,500");
    expect(count(0, true)).toBe("0");
    expect(count(null)).toBe("—");
  });

  it("百分比（數值本身已是 %）、百分點變化與價格", () => {
    expect(percent(0.52788)).toBe("0.53%");
    expect(percent(160.42, 1)).toBe("160.4%");
    expect(percent(undefined)).toBe("—");
    expect(pp(0.01)).toBe("+0.01");
    expect(pp(-0.2)).toBe("−0.20");
    expect(pp(0)).toBe("0.00");
    expect(pp(null)).toBe("—");
    expect(price(2535.123)).toBe("2,535.12");
    expect(price(null)).toBe("—");
  });
});

describe("latest", () => {
  it("取最新一天、最新一週與前一週的日期", () => {
    const r = latest(chips([day("2026-10-14", 1), day("2026-10-15", 2)], [week("2026-10-02", 84.77), week("2026-10-08", 84.78)]));
    expect(r.day?.date).toBe("2026-10-15");
    expect(r.week?.date).toBe("2026-10-08");
    expect(r.prevWeek).toBe("2026-10-02");
  });

  it("沒有資料時是 null", () => {
    expect(latest(chips([], []))).toEqual({ day: null, week: null, prevWeek: null });
    expect(latest(chips([], [week("2026-10-02", 1)])).prevWeek).toBeNull();
  });
});

describe("sourceLine", () => {
  it("依提供機關合併資料集名稱，附授權條款", () => {
    expect(sourceLine(chips([], []))).toBe(
      "資料來源：臺灣證券交易所（政府資料開放平臺「融資融券與可借券賣出額度 > 融資融券餘額」「盤後資訊 > 個股日成交資訊」資料集）、" +
        "臺灣集中保管結算所（「集保戶股權分散表」資料集），依政府資料開放授權條款第1版利用。",
    );
  });
});

describe("niceTicks", () => {
  it("刻度是 1、2、5 × 10ⁿ 的倍數並涵蓋資料範圍", () => {
    expect(niceTicks(30500, 34223)).toEqual([30000, 32000, 34000, 36000]);
    expect(niceTicks(8, 50)).toEqual([0, 20, 40, 60]);
  });

  it("整數資料的間距至少是 1；全部相同時上下各留一格", () => {
    expect(niceTicks(3, 4)).toEqual([3, 4]);
    expect(niceTicks(5, 5)).toEqual([4, 5, 6]);
    expect(niceTicks(0, 0)).toEqual([0, 1]);
  });
});

describe("linePath", () => {
  it("依索引等距排列，值越大越上面", () => {
    const { points, segments } = linePath([0, 10, 5], { width: 100, height: 50, lo: 0, hi: 10 });
    expect(points).toEqual([
      { x: 0, y: 50 },
      { x: 50, y: 0 },
      { x: 100, y: 25 },
    ]);
    expect(segments).toEqual(["M0,50L50,0L100,25"]);
  });

  it("缺值把線斷成兩段；只有一個點時畫在中間", () => {
    const { points, segments } = linePath([1, null, 1, 1], { width: 30, height: 10, lo: 0, hi: 2 });
    expect(points[1]).toBeNull();
    expect(segments).toEqual(["M0,5", "M20,5L30,5"]);
    expect(linePath([7], { width: 80, height: 10, lo: 6, hi: 8 }).points).toEqual([{ x: 40, y: 5 }]);
  });
});

describe("nearestIndex", () => {
  it("指標的 x → 最近的資料點，超出範圍時夾在兩端", () => {
    expect(nearestIndex(0, 100, 5)).toBe(0);
    expect(nearestIndex(60, 100, 5)).toBe(2);
    expect(nearestIndex(63, 100, 5)).toBe(3);
    expect(nearestIndex(500, 100, 5)).toBe(4);
    expect(nearestIndex(-5, 100, 5)).toBe(0);
    expect(nearestIndex(10, 100, 1)).toBe(0);
  });
});
