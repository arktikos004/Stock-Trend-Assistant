"use client";

/**
 * 總覽的第一屏：先回答三件事——資料是哪一天的、模型效果如何、目前有什麼限制——再看排序表。
 * 每一項只寫一兩行；定義與但書在「方法與限制」頁（HelpLink）。
 * 模型效果的主數字是即時記錄的技能檢定，狀態照預先聲明（含事後重建或補寫）。
 */

import type { ReactNode } from "react";
import Badge from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Feedback";
import HelpLink, { type MethodSection } from "@/components/ui/HelpLink";
import type { LedgerSnapshot, MonitorResponse, RankResponse, SiteMeta } from "@/lib/api";
import { fixed, taipeiTime } from "@/lib/format";
import { MODEL_STATUS, skillTest } from "@/lib/status";

function Fact({ label, help, children }: { label: string; help: MethodSection; children: ReactNode }) {
  return (
    <div className="bg-surface px-4 py-3.5">
      <dt className="flex items-baseline justify-between gap-2 text-sm font-semibold text-ink-2">
        {label}
        <HelpLink to={help} className="text-sm font-normal" />
      </dt>
      <dd className="mt-1 space-y-0.5 text-sm leading-relaxed text-ink-2">{children}</dd>
    </div>
  );
}

export default function TodayFacts({
  rank,
  model,
  meta,
  snapshot,
}: {
  rank: RankResponse | undefined;
  model: MonitorResponse["model"] | undefined;
  meta: (SiteMeta & { stale: boolean }) | undefined;
  snapshot: LedgerSnapshot | null | undefined;
}) {
  const status = model ? MODEL_STATUS[model.status] : null;
  const skill = model ? skillTest(model) : null;
  const sealed = snapshot?.verified_through != null && rank != null && rank.base_date <= snapshot.verified_through;

  return (
    <dl aria-label="今日的資料、模型效果與限制" className="mb-5 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
      <Fact label="資料日期" help="ledger">
        {rank ? (
          <>
            <p className="text-lg font-semibold text-ink">基準日 {rank.base_date}</p>
            <p>
              {meta && `${taipeiTime(meta.generated_at)} 更新${meta.stale ? "（可能已過期）" : ""}；`}
              {sealed ? "已串入存證鏈" : rank.basis === "recomputed" ? "重新評分，沒有存證" : "已記錄，等待上鏈"}
            </p>
          </>
        ) : (
          <Skeleton className="h-12 w-full" />
        )}
      </Fact>
      <Fact label="模型效果" help="model">
        {model && status && skill ? (
          <>
            <p className="flex flex-wrap items-center gap-2 text-lg font-semibold text-ink">
              {skill.t == null ? "還不能檢定" : skill.passed ? "達到技能檢定門檻" : "尚未達技能檢定門檻"}
              <Badge tone={status.tone} icon={status.icon} title={status.note}>
                {status.text}
              </Badge>
            </p>
            {skill.t != null && (
              <p>
                {skill.label} t {fixed(skill.t, 2)}（門檻 {skill.threshold}）
              </p>
            )}
          </>
        ) : (
          <Skeleton className="h-12 w-full" />
        )}
      </Fact>
      <Fact label="主要限制" help="reading">
        <p className="text-lg font-semibold text-ink">名次是相對位置，不是漲跌預測</p>
        <p>線上成績還不能下結論；不構成投資建議</p>
      </Fact>
    </dl>
  );
}
