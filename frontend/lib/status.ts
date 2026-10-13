import { CircleAlert, CircleCheck, CircleDashed, ShieldX, type LucideIcon } from "lucide-react";
import type { ModelStatus, MonitorResponse } from "@/lib/api";

/**
 * 模型監控狀態（規則見 docs/monitor_prereg.md）。「正常」不用綠色：台股的綠代表下跌。
 * 失效警示用實心深色底，不用紅色，免得和「漲」混淆；每個狀態都有圖示與文字。
 */
export const MODEL_STATUS: Record<ModelStatus, { text: string; note: string; brief: string; tone: BadgeTone; icon: LucideIcon }> = {
  normal: { text: "正常", note: "線上表現沒有顯著差於回測", brief: "失效檢定未觸發", tone: "accent", icon: CircleCheck },
  watch: {
    text: "留意",
    note: "最近 20 個到期日的平均 Rank IC 為負（描述性提示，不是檢定）",
    brief: "留意：近 20 日平均 IC 為負；失效檢定未觸發",
    tone: "warn",
    icon: CircleAlert,
  },
  breakdown: { text: "失效警示", note: "線上 Rank IC 顯著低於回測（單尾 5%）", brief: "失效警示：線上顯著低於回測", tone: "solid", icon: ShieldX },
  insufficient: { text: "資料不足", note: "已到期的交易日不足 20 天，不判定", brief: "到期日不足 20 天，失效檢定不判定", tone: "neutral", icon: CircleDashed },
};

export type BadgeTone = "neutral" | "accent" | "up" | "down" | "hold" | "warn" | "solid";

/**
 * 技能檢定（線上 Rank IC 的 Newey–West t 對門檻）的結論與樣本：排名表上方的橫條和狀態列共用。
 * 主數字是即時記錄（前瞻）的 t；含事後重建或補寫的全部到期日另外寫出。舊版站上資料沒有分組時退回全部到期日。
 */
export function skillTest(model: MonitorResponse["model"]) {
  const threshold = model.thresholds.skill_t[0] ?? 2;
  const live = model.groups?.live;
  const rebuilt = model.n_days - model.n_live_days;
  const t = live ? live.t_nw : model.t_skill;
  return {
    threshold,
    t,
    passed: t != null && t >= threshold,
    label: live ? "即時記錄的" : "線上",
    sample: live
      ? `${live.n_days} 天；含事後重建或補寫的 ${model.n_days} 天為 ${model.t_skill == null ? "—" : model.t_skill.toFixed(2)}`
      : `${model.n_days} 個到期日${rebuilt > 0 ? `，其中 ${rebuilt} 日是事後重建` : ""}`,
  };
}
