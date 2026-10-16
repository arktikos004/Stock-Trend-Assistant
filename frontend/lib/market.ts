/**
 * 大盤多空標籤：加權指數的 5 日報酬、20 日均線乖離與上漲家數比三項同向，才標偏多或偏空，其餘是中性。
 * 只描述最近的狀態，不是預測；規則與數字來源寫在方法與限制頁（#market）。
 */

import type { MarketResponse } from "@/lib/api";
import type { BadgeTone } from "@/lib/status";

export type MarketBias = "偏多" | "中性" | "偏空";

/** 偏多用漲的色、偏空用跌的色（台股：紅漲綠跌），中性不用紅綠 */
export const MARKET_BIAS_TONE: Record<MarketBias, BadgeTone> = { 偏多: "up", 中性: "neutral", 偏空: "down" };

// 只看這三項；舊版站上資料或 NaN 可能讓欄位缺值
type BiasInputs = { [K in "breadth_up" | "ma20_bias" | "ret_5d"]?: MarketResponse[K] | null };

const finite = (v: number | null | undefined): v is number => Number.isFinite(v);

/** 剛好在門檻上（50%、0）的值不算任何一邊；任一項缺值或不是有限數值時回 null，不顯示標籤 */
export function marketBias({ breadth_up, ma20_bias, ret_5d }: BiasInputs): MarketBias | null {
  if (!finite(breadth_up) || !finite(ma20_bias) || !finite(ret_5d)) return null;
  if (breadth_up > 0.5 && ma20_bias > 0 && ret_5d > 0) return "偏多";
  if (breadth_up < 0.5 && ma20_bias < 0 && ret_5d < 0) return "偏空";
  return "中性";
}
