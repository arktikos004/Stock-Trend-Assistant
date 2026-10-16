/**
 * K 線圖的價量計算：均線、乖離率、KD、RSI、MACD、前高／前低、放量突破／跌破。
 * 公式與起算方式依 XQ 內建腳本（XScript_Preset 的 Stochastic、RSI、XAverage、MACD 指標、WeightedClose、Bias），
 * XQ 的 CurrentBar = 1 對應這裡第一根有完整視窗的 K 棒。每個值只用當根與更早的 K 棒（沒有未來資料）。
 * 指標用完整累積序列計算再切到畫面區間；資料不足、或起算值的影響還沒衰減的位置一律是 null，不畫。
 */

import type { Candle } from "@/lib/api";

export type Series = (number | null)[];

export const MA_PERIODS = [5, 10, 20, 60, 120] as const;
export const BIAS_PERIODS = [5, 10, 20] as const;
export const RSI_PERIODS = [6, 12] as const;
export type MaPeriod = (typeof MA_PERIODS)[number];
export type BiasPeriod = (typeof BIAS_PERIODS)[number];
export type RsiPeriod = (typeof RSI_PERIODS)[number];

/** 遞迴指標累積到這麼多根才畫：起算值（K、D 的 50、RSI 的第一個平均、EMA 的第一個值）的影響要先衰減 */
export const WARMUP = { kd: 32, rsi6: 45, rsi12: 95, macd: 120 } as const;

/** 回看視窗：前高／前低與量能基準都用前 20 個交易日（約一個月） */
export const LOOKBACK = 20;
/** 量能達前 20 日均量幾倍算「放量」 */
export const VOLUME_SURGE = 2;

/** 簡單移動平均；前 n−1 根不足樣本回 null */
export function sma(values: number[], n: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

/** 乖離率（%）：XQ Bias＝（收盤 ÷ |均線| − sign(均線)）× 100，股價時就是（收盤 − 均線）÷ 均線 × 100 */
export function bias(closes: number[], n: number): Series {
  return sma(closes, n).map((m, i) => {
    if (m === null) return null;
    const c = closes[i];
    if (m !== 0) return (c / Math.abs(m) - Math.sign(m)) * 100;
    return c > 0 ? 999 : c < 0 ? -999 : 0;
  });
}

/**
 * KD（XQ Stochastic）：RSV＝100 ×（C − n 日最低）÷（n 日最高 − n 日最低），最高等於最低時 50；
 * 第一根 K、D 都是 50，之後 K＝（K₋₁ ×（rsvt − 1）＋ RSV）÷ rsvt、D＝（D₋₁ ×（kt − 1）＋ K）÷ kt。
 */
export function stochastic(candles: Candle[], n = 9, rsvt = 3, kt = 3): { rsv: Series; k: Series; d: Series } {
  const len = candles.length;
  const rsv: Series = new Array(len).fill(null);
  const k: Series = new Array(len).fill(null);
  const d: Series = new Array(len).fill(null);
  for (let i = n - 1; i < len; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - n + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    const r = hi !== lo ? (100 * (candles[i].close - lo)) / (hi - lo) : 50;
    rsv[i] = r;
    if (i === n - 1) {
      k[i] = 50;
      d[i] = 50;
    } else {
      const ki = ((k[i - 1] as number) * (rsvt - 1) + r) / rsvt;
      k[i] = ki;
      d[i] = ((d[i - 1] as number) * (kt - 1) + ki) / kt;
    }
  }
  return { rsv, k, d };
}

/**
 * RSI（XQ）：第一個值用 n 日漲幅、跌幅的簡單平均，之後 avg＝avg₋₁＋（x − avg₋₁）÷ n；
 * RSI＝100 × 平均漲幅 ÷（平均漲幅＋平均跌幅），兩者都是 0 時記為 0。
 */
export function rsi(values: number[], n: number): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= n) return out;
  let up = 0;
  let down = 0;
  for (let i = 1; i <= n; i++) {
    const move = values[i] - values[i - 1];
    up += Math.max(move, 0);
    down += Math.max(-move, 0);
  }
  up /= n;
  down /= n;
  for (let i = n; i < values.length; i++) {
    if (i > n) {
      const move = values[i] - values[i - 1];
      up += (Math.max(move, 0) - up) / n;
      down += (Math.max(-move, 0) - down) / n;
    }
    out[i] = up + down === 0 ? 0 : (100 * up) / (up + down);
  }
  return out;
}

/** 指數平均（XQ XAverage）：以第一個值起算，α＝2 ÷（n＋1） */
export function xaverage(values: number[], n: number): number[] {
  const alpha = 2 / (n + 1);
  const out: number[] = [];
  values.forEach((v, i) => out.push(i === 0 ? v : out[i - 1] + alpha * (v - out[i - 1])));
  return out;
}

/** MACD 用的價格（XQ WeightedClose）：（最高＋最低＋2 × 收盤）÷ 4 */
export const weightedClose = (c: Pick<Candle, "high" | "low" | "close">) => (c.high + c.low + 2 * c.close) / 4;

/** MACD（XQ）：DIF＝快 EMA − 慢 EMA，MACD＝DIF 的 EMA，OSC＝DIF − MACD */
export function macd(candles: Candle[], fast = 12, slow = 26, signal = 9): { dif: number[]; macd: number[]; osc: number[] } {
  const price = candles.map(weightedClose);
  const f = xaverage(price, fast);
  const s = xaverage(price, slow);
  const dif = f.map((v, i) => v - s[i]);
  const sig = xaverage(dif, signal);
  return { dif, macd: sig, osc: dif.map((v, i) => v - sig[i]) };
}

/** 最後一根之前 LOOKBACK 根的最高價／最低價；樣本不足回 null */
export function priorLevels(candles: Candle[]): { high: number; low: number } | null {
  if (candles.length < LOOKBACK + 1) return null;
  const window = candles.slice(-LOOKBACK - 1, -1);
  return {
    high: Math.max(...window.map((c) => c.high)),
    low: Math.min(...window.map((c) => c.low)),
  };
}

export type VolumeSignal = "breakout" | "breakdown";

/**
 * 放量突破：當日量 ≥ 前 20 日均量 × 2，且收盤站上前 20 日最高價。
 * 放量跌破：同樣放量，且收盤跌破前 20 日最低價。回傳與 candles 等長的陣列，無訊號為 null。
 */
export function volumeSignals(candles: Candle[]): (VolumeSignal | null)[] {
  return candles.map((c, i) => {
    if (i < LOOKBACK) return null;
    const window = candles.slice(i - LOOKBACK, i);
    const avgVol = window.reduce((s, w) => s + w.volume, 0) / LOOKBACK;
    if (avgVol <= 0 || c.volume < avgVol * VOLUME_SURGE) return null;
    if (c.close > Math.max(...window.map((w) => w.high))) return "breakout";
    if (c.close < Math.min(...window.map((w) => w.low))) return "breakdown";
    return null;
  });
}

/** 價格軸用的小數位數：資料實際用到幾位就顯示幾位（最多 2 位；證交所 1,000 元以上的股價是整數） */
export function priceDecimals(candles: Candle[]): number {
  const places = (v: number) => [0, 1].find((d) => Math.abs(v * 10 ** d - Math.round(v * 10 ** d)) < 1e-6) ?? 2;
  return Math.max(0, ...candles.flatMap((c) => [c.open, c.high, c.low, c.close].map(places)));
}

export type ItemKey =
  | `ma${MaPeriod}`
  | `bias${BiasPeriod}`
  | "kd"
  | `rsi${RsiPeriod}`
  | "macd"
  | "levels"
  | "signals";

/** 每一項至少要累積幾根 K 棒才畫得出來 */
export const NEEDS: Record<ItemKey, number> = {
  ma5: 5,
  ma10: 10,
  ma20: 20,
  ma60: 60,
  ma120: 120,
  bias5: 5,
  bias10: 10,
  bias20: 20,
  kd: WARMUP.kd,
  rsi6: WARMUP.rsi6,
  rsi12: WARMUP.rsi12,
  macd: WARMUP.macd,
  levels: LOOKBACK + 1,
  signals: LOOKBACK + 1,
};

/** need＝需要幾根；have＝到畫面最後一根為止累積了幾根 */
export type Readiness = Record<ItemKey, { need: number; have: number }>;

export interface Overlay {
  /** 用完整累積序列計算（true），或只有畫面上的 K 棒（false） */
  fromHistory: boolean;
  /** 以下陣列都和畫面上的 K 棒對齊 */
  prevClose: Series;
  ma: Record<MaPeriod, Series>;
  bias: Record<BiasPeriod, Series>;
  kd: { k: Series; d: Series };
  rsi: Record<RsiPeriod, Series>;
  macd: { dif: Series; macd: Series; osc: Series };
  signals: (VolumeSignal | null)[];
  /** 畫面最後一根之前 20 根的最高價、最低價 */
  levels: { high: number; low: number } | null;
  readiness: Readiness;
}

/** 完整序列含畫面區間時，取區間之前的歷史接上畫面上的 K 棒；否則只用畫面上的 K 棒 */
function baseSeries(visible: Candle[], history?: Candle[] | null): { base: Candle[]; offset: number } | null {
  if (!history || visible.length === 0) return null;
  const offset = history.findIndex((c) => c.time === visible[0].time);
  if (offset < 0 || offset + visible.length > history.length) return null;
  for (let i = 0; i < visible.length; i++) {
    if (history[offset + i].time !== visible[i].time) return null;
  }
  return { base: [...history.slice(0, offset), ...visible], offset };
}

/** 畫面上的 K 棒加上疊加層與副圖：在完整序列上計算、套用暖機門檻，再切到畫面區間 */
export function computeOverlay(visible: Candle[], history?: Candle[] | null): Overlay {
  const found = baseSeries(visible, history);
  const base = found?.base ?? visible;
  const offset = found?.offset ?? 0;
  const closes = base.map((c) => c.close);
  // 暖機：第 i 根（從 0 起算）在 i + 1 ≥ 門檻時才畫，然後切到畫面區間
  const cut = (s: Series, need: number): Series => s.slice(offset).map((v, k) => (offset + k + 1 >= need ? v : null));

  const ma = Object.fromEntries(MA_PERIODS.map((p) => [p, cut(sma(closes, p), p)])) as Record<MaPeriod, Series>;
  const biasOut = Object.fromEntries(BIAS_PERIODS.map((p) => [p, cut(bias(closes, p), p)])) as Record<BiasPeriod, Series>;
  const st = stochastic(base);
  const rsiOut = Object.fromEntries(RSI_PERIODS.map((p) => [p, cut(rsi(closes, p), WARMUP[`rsi${p}`])])) as Record<RsiPeriod, Series>;
  const m = macd(base);
  const have = offset + visible.length;

  return {
    fromHistory: found !== null,
    prevClose: visible.map((_, k) => (offset + k > 0 ? base[offset + k - 1].close : null)),
    ma,
    bias: biasOut,
    kd: { k: cut(st.k, WARMUP.kd), d: cut(st.d, WARMUP.kd) },
    rsi: rsiOut,
    macd: { dif: cut(m.dif, WARMUP.macd), macd: cut(m.macd, WARMUP.macd), osc: cut(m.osc, WARMUP.macd) },
    signals: volumeSignals(base).slice(offset),
    levels: priorLevels(base),
    readiness: Object.fromEntries(Object.entries(NEEDS).map(([key, need]) => [key, { need, have }])) as Readiness,
  };
}

const ready = (r: Readiness, key: ItemKey) => r[key].have >= r[key].need;
const join = (xs: (string | number)[]) => xs.join("／");

/**
 * 還畫不出來的項目寫成一行，例如「目前 10 個交易日；KD 需 32 個，…」；全部都畫得出來時回 null。
 * 乖離率 N 和 N 日均線同時有值，不另列
 */
export function pendingNote(r: Readiness): string | null {
  const parts: string[] = [];
  const ma = MA_PERIODS.filter((p) => !ready(r, `ma${p}`));
  if (ma.length) parts.push(`MA${join(ma)} 需 ${join(ma.map((p) => NEEDS[`ma${p}`]))} 個`);
  if (!ready(r, "levels") || !ready(r, "signals")) parts.push(`前高前低與放量訊號需 ${NEEDS.levels} 個`);
  if (!ready(r, "kd")) parts.push(`KD 需 ${NEEDS.kd} 個`);
  const rs = RSI_PERIODS.filter((p) => !ready(r, `rsi${p}`));
  if (rs.length === RSI_PERIODS.length) parts.push(`RSI 需 ${join(rs.map((p) => NEEDS[`rsi${p}`]))} 個`);
  else if (rs.length) parts.push(`RSI${rs[0]} 需 ${NEEDS[`rsi${rs[0]}`]} 個`);
  if (!ready(r, "macd")) parts.push(`MACD 需 ${NEEDS.macd} 個`);
  return parts.length ? `目前 ${r.kd.have} 個交易日；${parts.join("，")}` : null;
}

export type IndicatorKind = "kd" | "rsi" | "macd" | "bias";

export const INDICATOR_ITEMS: Record<IndicatorKind, { label: string; items: ItemKey[] }> = {
  kd: { label: "KD", items: ["kd"] },
  rsi: { label: "RSI", items: ["rsi6", "rsi12"] },
  macd: { label: "MACD", items: ["macd"] },
  bias: { label: "乖離率", items: ["bias5", "bias10", "bias20"] },
};

/** 選到的副圖一條線都畫不出來時的說明；至少有一條時回 null */
export function paneNote(kind: IndicatorKind, r: Readiness): string | null {
  const { label, items } = INDICATOR_ITEMS[kind];
  if (items.some((key) => ready(r, key))) return null;
  const gap = /^[A-Za-z]/.test(label) ? " " : "";
  return `${label}${gap}需 ${join(items.map((key) => NEEDS[key]))} 個交易日，目前 ${r[items[0]].have} 個`;
}
