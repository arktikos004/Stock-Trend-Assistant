/**
 * K 線圖的價量計算。公式依 XQ 內建腳本（XScript_Preset：Stochastic、RSI、XAverage、MACD 指標、WeightedClose、Bias），
 * 小型範例都是手算的；另外檢查沒有未來資料、資料不足時不畫，以及短區間從完整序列取得長週期的值。
 */

import { describe, expect, it } from "vitest";
import type { Candle } from "@/lib/api";
import {
  bias,
  computeOverlay,
  macd,
  paneNote,
  pendingNote,
  priceDecimals,
  priorLevels,
  rsi,
  sma,
  stochastic,
  volumeSignals,
  weightedClose,
  xaverage,
} from "@/lib/indicators";

/** H、L、C 的 K 棒；開盤取收盤、量固定，只在需要時覆寫 */
const bar = (time: string, high: number, low: number, close: number, volume = 1000, open = close): Candle => ({
  time,
  open,
  high,
  low,
  close,
  volume,
});

const day = (i: number) => new Date(Date.UTC(2026, 0, 1) + i * 86_400_000).toISOString().slice(0, 10);

/** 固定種子的隨機 K 線：測試沒有未來資料與暖機規則用 */
function randomCandles(n: number, seed = 7): Candle[] {
  let s = seed;
  const rand = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return s / 2147483648;
  };
  const out: Candle[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close * (1 + (rand() - 0.5) * 0.02);
    close = open * (1 + (rand() - 0.5) * 0.05);
    const high = Math.max(open, close) * (1 + rand() * 0.01);
    const low = Math.min(open, close) * (1 - rand() * 0.01);
    out.push({ time: day(i), open, high, low, close, volume: Math.round(1_000_000 * (0.5 + rand())) });
  }
  return out;
}

/** 證交所開放資料 2330.TW 2026-10-02～2026-10-15（candles-twse.json） */
const TSMC: Candle[] = [
  ["2026-10-02", 2505, 2515, 2495, 2500, 15792206],
  ["2026-10-05", 2550, 2580, 2545, 2575, 26800187],
  ["2026-10-06", 2575, 2590, 2565, 2585, 19953802],
  ["2026-10-07", 2565, 2585, 2560, 2585, 15562183],
  ["2026-10-08", 2550, 2575, 2550, 2550, 22655193],
  ["2026-10-12", 2510, 2550, 2510, 2540, 22573768],
  ["2026-10-13", 2500, 2510, 2490, 2490, 40700261],
  ["2026-10-14", 2505, 2535, 2490, 2490, 24880940],
  ["2026-10-15", 2420, 2450, 2420, 2440, 58177711],
].map(([time, open, high, low, close, volume]) => ({ time, open, high, low, close, volume }) as Candle);

describe("sma", () => {
  it("前 n−1 根是 null，之後是最近 n 根收盤的平均", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([null, null, 2, 3, 4]);
  });
});

describe("bias（乖離率）", () => {
  it("（收盤 − N 日均線）÷ N 日均線 × 100；均線還沒有值時是 null", () => {
    const b = bias([10, 10, 10, 13], 2);
    expect(b.slice(0, 3)).toEqual([null, 0, 0]);
    expect(b[3]).toBeCloseTo(((13 - 11.5) / 11.5) * 100, 12);
  });
});

describe("stochastic（KD 9,3,3）", () => {
  it("第一個完整的 9 根視窗 K、D 都是 50（XQ：CurrentBar = 1），之前是 null", () => {
    const { rsv, k, d } = stochastic(randomCandles(12));
    expect(k.slice(0, 8)).toEqual(Array(8).fill(null));
    expect(d.slice(0, 8)).toEqual(Array(8).fill(null));
    expect([k[8], d[8]]).toEqual([50, 50]);
    expect(rsv[8]).not.toBeNull();
    expect(k[9]).toBeCloseTo((2 * 50 + (rsv[9] as number)) / 3, 12);
  });

  it("RSV＝100 ×（C − 最低）÷（最高 − 最低），K＝（2K₋₁＋RSV）÷ 3，D＝（2D₋₁＋K）÷ 3（手算，n = 3）", () => {
    const candles = [
      bar(day(0), 10, 8, 9),
      bar(day(1), 11, 9, 10),
      bar(day(2), 12, 10, 11), // 視窗 8～12：RSV 75，但第一根 K = D = 50
      bar(day(3), 12, 12, 12), // 視窗 9～12：RSV 100
      bar(day(4), 12, 12, 12), // 視窗 10～12：RSV 100
    ];
    const { rsv, k, d } = stochastic(candles, 3, 3, 3);
    expect(rsv).toEqual([null, null, 75, 100, 100]);
    const k3 = (2 * 50 + 100) / 3;
    const d3 = (2 * 50 + k3) / 3;
    const k4 = (2 * k3 + 100) / 3;
    const d4 = (2 * d3 + k4) / 3;
    expect(k).toEqual([null, null, 50, k3, k4]);
    expect(d[3]).toBeCloseTo(d3, 12);
    expect(d[4]).toBeCloseTo(d4, 12);
  });

  it("最高等於最低時 RSV＝50", () => {
    const flat = [0, 1, 2, 3].map((i) => bar(day(i), 20, 20, 20));
    const { rsv, k, d } = stochastic(flat, 3, 3, 3);
    expect(rsv).toEqual([null, null, 50, 50]);
    expect(k).toEqual([null, null, 50, 50]);
    expect(d).toEqual([null, null, 50, 50]);
  });
});

describe("rsi", () => {
  it("第一個值用 N 日漲跌幅的簡單平均，之後 avg＝avg₋₁＋（x − avg₋₁）÷ N（手算，N = 3）", () => {
    // 漲跌：+1、−1、+2、0、−3
    const r = rsi([10, 11, 10, 12, 12, 9], 3);
    expect(r.slice(0, 3)).toEqual([null, null, null]);
    expect(r[3]).toBeCloseTo(75, 12); // 平均漲 1、平均跌 1/3
    expect(r[4]).toBeCloseTo(75, 12); // 2/3、2/9
    expect(r[5]).toBeCloseTo(1200 / 43, 12); // 4/9、31/27
  });

  it("全平盤時平均漲跌都是 0，依 XQ 記為 0；只漲不跌是 100", () => {
    expect(rsi([5, 5, 5, 5, 5], 3)).toEqual([null, null, null, 0, 0]);
    expect(rsi([1, 2, 3, 4, 5], 3)).toEqual([null, null, null, 100, 100]);
  });
});

describe("xaverage、weightedClose、macd", () => {
  it("EMA 以第一個值起算，α＝2 ÷（N＋1）", () => {
    expect(xaverage([2, 4, 6], 3)).toEqual([2, 3, 4.5]);
  });

  it("MACD 用的價格＝（最高＋最低＋2 × 收盤）÷ 4", () => {
    expect(weightedClose(bar(day(0), 12, 8, 11))).toBe(10.5);
  });

  it("DIF＝快 EMA − 慢 EMA，MACD＝DIF 的 EMA，OSC＝DIF − MACD（手算，1、3、3）", () => {
    const candles = [4, 8, 4].map((v, i) => bar(day(i), v, v, v));
    expect(macd(candles, 1, 3, 3)).toEqual({ dif: [0, 2, -1], macd: [0, 1, 0], osc: [0, 1, -1] });
  });

  it("預設 12、26、9：第一根的 DIF、MACD、OSC 都是 0", () => {
    const m = macd(randomCandles(3));
    expect([m.dif[0], m.macd[0], m.osc[0]]).toEqual([0, 0, 0]);
  });
});

describe("priorLevels、volumeSignals", () => {
  const base = Array.from({ length: 20 }, (_, i) => bar(day(i), 10, 9, 9.5, 100));

  it("前高／前低＝最後一根之前 20 根的最高價、最低價（不含最後一根）；不足 21 根是 null", () => {
    expect(priorLevels(base)).toBeNull();
    const withPeak = base.map((c, i) => (i === 3 ? { ...c, high: 13 } : i === 5 ? { ...c, low: 7 } : c));
    expect(priorLevels([...withPeak, bar(day(20), 50, 1, 20)])).toEqual({ high: 13, low: 7 });
  });

  it("量 ≥ 前 20 日均量 × 2，收盤高於前 20 日最高＝突破、低於最低＝跌破；量不夠或不足 20 根時沒有訊號", () => {
    expect(volumeSignals([...base, bar(day(20), 11, 10, 10.5, 200)])[20]).toBe("breakout");
    expect(volumeSignals([...base, bar(day(20), 9, 8, 8.5, 200)])[20]).toBe("breakdown");
    expect(volumeSignals([...base, bar(day(20), 11, 10, 10.5, 199)])[20]).toBeNull();
    expect(volumeSignals([...base, bar(day(20), 10, 9, 9.8, 500)])[20]).toBeNull(); // 放量但沒有突破
    expect(volumeSignals(base).every((s) => s === null)).toBe(true);
  });
});

describe("computeOverlay", () => {
  it("2330.TW 2026-10-15：前一日收盤 2,490、MA5 2,502", () => {
    const o = computeOverlay(TSMC, TSMC);
    const last = TSMC.length - 1;
    expect(o.prevClose[last]).toBe(2490);
    expect(o.ma[5][last]).toBe(2502);
    expect(o.ma[10][last]).toBeNull();
    expect(o.prevClose[0]).toBeNull();
  });

  it("均線與乖離率要 N 根；KD、RSI、MACD 依 WARMUP 才有值（32、45、95、120 根）", () => {
    const o = computeOverlay(randomCandles(150));
    const firstValue = (s: (number | null)[]) => s.findIndex((v) => v !== null);
    expect(firstValue(o.ma[5])).toBe(4);
    expect(firstValue(o.ma[120])).toBe(119);
    expect(firstValue(o.bias[20])).toBe(19);
    expect(firstValue(o.kd.k)).toBe(31);
    expect(firstValue(o.kd.d)).toBe(31);
    expect(firstValue(o.rsi[6])).toBe(44);
    expect(firstValue(o.rsi[12])).toBe(94);
    expect(firstValue(o.macd.dif)).toBe(119);
    expect(firstValue(o.macd.macd)).toBe(119);
    expect(firstValue(o.macd.osc)).toBe(119);
    expect(o.ma[120].slice(119).every((v) => v !== null)).toBe(true);
  });

  it("沒有未來資料：改動後面的 K 棒，前面的值都不變", () => {
    const candles = randomCandles(150);
    const changed = candles.map((c, i) => (i === 149 ? { ...c, high: c.high * 2, close: c.close * 1.9, volume: c.volume * 9 } : c));
    const a = computeOverlay(candles);
    const b = computeOverlay(changed);
    const head = (s: (number | null)[] | (string | null)[]) => s.slice(0, 149);
    for (const p of [5, 10, 20, 60, 120] as const) expect(head(b.ma[p])).toEqual(head(a.ma[p]));
    for (const p of [5, 10, 20] as const) expect(head(b.bias[p])).toEqual(head(a.bias[p]));
    expect(head(b.kd.k)).toEqual(head(a.kd.k));
    expect(head(b.kd.d)).toEqual(head(a.kd.d));
    expect(head(b.rsi[6])).toEqual(head(a.rsi[6]));
    expect(head(b.rsi[12])).toEqual(head(a.rsi[12]));
    expect(head(b.macd.dif)).toEqual(head(a.macd.dif));
    expect(head(b.macd.macd)).toEqual(head(a.macd.macd));
    expect(head(b.macd.osc)).toEqual(head(a.macd.osc));
    expect(head(b.signals)).toEqual(head(a.signals));
    expect(b.ma[5][149]).not.toEqual(a.ma[5][149]);
  });

  it("短區間的第一根從完整序列取得長週期的值與前一日收盤", () => {
    const history = randomCandles(150);
    const full = computeOverlay(history, history);
    const o = computeOverlay(history.slice(140), history);
    expect(o.fromHistory).toBe(true);
    expect(o.ma[120][0]).toBe(full.ma[120][140]);
    expect(o.ma[120][0]).not.toBeNull();
    expect(o.kd.k[0]).toBe(full.kd.k[140]);
    expect(o.rsi[12][0]).toBe(full.rsi[12][140]);
    expect(o.macd.osc[0]).toBe(full.macd.osc[140]);
    expect(o.prevClose[0]).toBe(history[139].close);
    expect(o.ma[5]).toHaveLength(10);
  });

  it("前高前低以畫面最後一根為準，往前的 20 根可以來自完整序列", () => {
    const history = randomCandles(150);
    const visible = history.slice(130, 135);
    const prior = history.slice(114, 134);
    expect(computeOverlay(visible, history).levels).toEqual({
      high: Math.max(...prior.map((c) => c.high)),
      low: Math.min(...prior.map((c) => c.low)),
    });
  });

  it("沒有完整序列，或完整序列不含畫面區間時，只用畫面上的 K 棒計算", () => {
    const history = randomCandles(150);
    const visible = history.slice(140);
    const alone = computeOverlay(visible);
    expect(alone.fromHistory).toBe(false);
    expect(alone.ma[5][3]).toBeNull();
    expect(alone.ma[5][4]).not.toBeNull();
    expect(alone.ma[10][9]).not.toBeNull();
    expect(alone.kd.k.every((v) => v === null)).toBe(true);
    expect(alone.prevClose[0]).toBeNull();
    expect(alone.levels).toBeNull();

    const other = randomCandles(150, 99).map((c, i) => ({ ...c, time: day(i + 500) }));
    expect(computeOverlay(visible, other).fromHistory).toBe(false);
    expect(computeOverlay(visible, history.slice(0, 145)).fromHistory).toBe(false);
    expect(computeOverlay([], history).ma[5]).toEqual([]);
  });

  it("每一項記下需要幾根、到畫面最後一根為止有幾根", () => {
    const history = randomCandles(150);
    const o = computeOverlay(history.slice(30, 40), history);
    expect(o.readiness.kd).toEqual({ need: 32, have: 40 });
    expect(o.readiness.rsi12).toEqual({ need: 95, have: 40 });
    expect(o.readiness.ma60).toEqual({ need: 60, have: 40 });
    expect(o.readiness.levels).toEqual({ need: 21, have: 40 });
    expect(o.readiness.signals).toEqual({ need: 21, have: 40 });
    expect(computeOverlay(TSMC).readiness.macd).toEqual({ need: 120, have: 9 });
  });
});

describe("priceDecimals", () => {
  it("價格軸只用資料實際需要的小數位數（最多 2 位）", () => {
    expect(priceDecimals(TSMC)).toBe(0);
    expect(priceDecimals([bar(day(0), 153, 151.5, 152.5)])).toBe(1);
    expect(priceDecimals([bar(day(0), 10.05, 9.87, 9.9), bar(day(1), 12, 11, 11.5)])).toBe(2);
    expect(priceDecimals([bar(day(0), 152.3, 151.1, 152.2)])).toBe(1); // 152.3 × 10 的浮點誤差不算第 2 位
  });
});

describe("pendingNote、paneNote", () => {
  it("還畫不出來的項目寫成一行（乖離率 N 與 N 日均線同時有值，不另列）；全部都畫得出來時是 null", () => {
    const history = randomCandles(150);
    expect(pendingNote(computeOverlay(history.slice(0, 10)).readiness)).toBe(
      "目前 10 個交易日；MA20／60／120 需 20／60／120 個，前高前低與放量訊號需 21 個，KD 需 32 個，RSI 需 45／95 個，MACD 需 120 個",
    );
    expect(pendingNote(computeOverlay(history.slice(0, 50)).readiness)).toBe(
      "目前 50 個交易日；MA60／120 需 60／120 個，RSI12 需 95 個，MACD 需 120 個",
    );
    expect(pendingNote(computeOverlay(history).readiness)).toBeNull();
  });

  it("選到的副圖完全畫不出來時才有說明", () => {
    const short = computeOverlay(TSMC).readiness;
    expect(paneNote("kd", short)).toBe("KD 需 32 個交易日，目前 9 個");
    expect(paneNote("rsi", short)).toBe("RSI 需 45／95 個交易日，目前 9 個");
    expect(paneNote("macd", short)).toBe("MACD 需 120 個交易日，目前 9 個");
    expect(paneNote("bias", short)).toBeNull(); // 乖離率 5 已經有值
    expect(paneNote("bias", computeOverlay(TSMC.slice(0, 3)).readiness)).toBe("乖離率需 5／10／20 個交易日，目前 3 個");
    expect(paneNote("rsi", computeOverlay(randomCandles(50)).readiness)).toBeNull(); // RSI6 已經有值
  });
});
