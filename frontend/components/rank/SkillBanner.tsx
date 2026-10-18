"use client";

/**
 * 排名表上方的技能檢定：線上 Rank IC 的 Newey–West t 有沒有達到門檻（規則見 docs/monitor_prereg.md）。
 * 頁面上只留一行短標籤，數字與定義點開提示才看到。這是說明，不是警示，所以用中性色。
 * strip＝排序表正上方的一列；box＝內文裡的一行。
 */

import Hint from "@/components/ui/Hint";
import { api } from "@/lib/api";
import { fixed } from "@/lib/format";
import { skillTest } from "@/lib/status";
import { useAsync } from "@/lib/useAsync";

export default function SkillBanner({ variant = "strip" }: { variant?: "strip" | "box" }) {
  const monitor = useAsync("monitor", () => api.monitor());
  const model = monitor.data?.model;
  if (!model) return null;
  const skill = skillTest(model);
  const frame = variant === "strip" ? "hairline-b py-3" : "";

  return (
    <p role="note" className={`flex flex-wrap items-center gap-x-2 text-sm text-ink-2 ${frame}`}>
      <span className="text-ink-3">技能檢定</span>
      <span className="text-ink">{skill.t == null ? "到期日還不夠" : skill.passed ? "已達門檻" : "尚未達門檻"}</span>
      <Hint to="model" anchor="skill" label="技能檢定">
        <p>
          {skill.t == null
            ? "到期的交易日還不夠，模型效果還不能檢定。"
            : `${skill.label} t ${fixed(skill.t, 2)}，門檻 ${skill.threshold}（文獻對新因子另用 3）。未達門檻代表線上成績還不能證明模型有預測力。`}
        </p>
      </Hint>
    </p>
  );
}
