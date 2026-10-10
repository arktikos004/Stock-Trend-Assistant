import { CircleAlert, CircleCheck, CircleDashed, ShieldX, type LucideIcon } from "lucide-react";
import type { ModelStatus } from "@/lib/api";

/**
 * 模型監控狀態（規則見 docs/monitor_prereg.md）。「正常」不用綠色：台股的綠代表下跌。
 * 失效警示用實心深色底，不用紅色，免得和「漲」混淆；每個狀態都有圖示與文字。
 */
export const MODEL_STATUS: Record<ModelStatus, { text: string; note: string; tone: BadgeTone; icon: LucideIcon }> = {
  normal: { text: "正常", note: "線上表現沒有顯著差於回測", tone: "accent", icon: CircleCheck },
  watch: { text: "留意", note: "最近 20 個到期日的平均 Rank IC 為負（描述性提示，不是檢定）", tone: "warn", icon: CircleAlert },
  breakdown: { text: "失效警示", note: "線上 Rank IC 顯著低於回測（單尾 5%）", tone: "solid", icon: ShieldX },
  insufficient: { text: "資料不足", note: "已到期的交易日不足 20 天，不判定", tone: "neutral", icon: CircleDashed },
};

export type BadgeTone = "neutral" | "accent" | "up" | "down" | "hold" | "warn" | "solid";
