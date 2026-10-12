"use client";

/**
 * 排名表上方固定顯示的技能檢定橫條：線上 Rank IC 的 Newey–West t 有沒有達到門檻（規則見 docs/monitor_prereg.md）。
 * 數值讀 /api/monitor，達到門檻時文字跟著換。這是說明，不是警示，所以用中性色。
 * strip＝貼在面板內、表格正上方的整列；box＝面板內文裡的小框。
 */

import { Info } from "lucide-react";
import HelpLink from "@/components/ui/HelpLink";
import { api } from "@/lib/api";
import { fixed } from "@/lib/format";
import { skillTest } from "@/lib/status";
import { useAsync } from "@/lib/useAsync";

export default function SkillBanner({ variant = "strip" }: { variant?: "strip" | "box" }) {
  const monitor = useAsync("monitor", () => api.monitor());
  const model = monitor.data?.model;
  if (!model) return null;
  const skill = skillTest(model);
  const frame = variant === "strip" ? "border-b border-border px-4 py-2.5" : "rounded-md border border-border px-3 py-2";

  return (
    <p role="note" className={`flex items-start gap-2 bg-surface-2 text-sm leading-relaxed text-ink-2 ${frame}`}>
      <Info size={16} className="mt-0.5 shrink-0 text-ink-3" aria-hidden="true" />
      <span>
        {skill.t == null ? (
          <>到期的交易日還不夠，模型效果還不能檢定。</>
        ) : (
          <>
            <span className="font-semibold text-ink">{skill.passed ? "模型效果達到技能檢定門檻" : "模型效果尚未達技能檢定門檻"}</span>：{skill.label} t {fixed(skill.t, 2)}（門檻 {skill.threshold}）。
          </>
        )}
        <HelpLink to="model" className="ml-1" />
      </span>
    </p>
  );
}
