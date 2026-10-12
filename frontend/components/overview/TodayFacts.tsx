"use client";

/**
 * 總覽的第一屏：先回答三件事——資料是哪一天的、模型效果如何、目前有什麼限制——再看排序表。
 * 數字都讀同一份匯出（meta.json、monitor.json、ledger.json）；讀不到的項目顯示「—」，不影響其他項目。
 * 模型效果的主數字是當日即時記錄的技能檢定（D4），狀態照預先聲明（含事後重建）。限制是說明，不用警示色。
 */

import Link from "next/link";
import type { ReactNode } from "react";
import Badge from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Feedback";
import type { LedgerSnapshot, MonitorResponse, RankResponse, SiteMeta } from "@/lib/api";
import { fixed, taipeiTime } from "@/lib/format";
import { MODEL_STATUS, skillTest } from "@/lib/status";

function Fact({ label, children, href, more }: { label: string; children: ReactNode; href?: string; more?: string }) {
  return (
    <div className="bg-surface px-4 py-3.5">
      <dt className="text-sm font-semibold text-ink-2">{label}</dt>
      <dd className="mt-1.5 space-y-1 text-sm leading-relaxed text-ink">{children}</dd>
      {href && more && (
        <dd className="mt-2">
          <Link href={href} className="text-sm font-medium text-accent hover:underline">
            {more}
          </Link>
        </dd>
      )}
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
    <dl aria-label="今天的資料、模型效果與限制" className="mb-5 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border md:grid-cols-3">
      <Fact label="資料是哪一天的">
        {rank ? (
          <>
            <p className="text-lg font-semibold">基準日 {rank.base_date}</p>
            <p className="text-ink-2">
              {meta ? `${taipeiTime(meta.generated_at)} 更新${meta.stale ? "，可能已過期" : ""}；` : ""}依 {rank.base_date} 收盤為止的資料，排序未來 5 個交易日。
            </p>
            <p className="text-ink-2">{sealed ? "這份排序已串入存證鏈。" : rank.basis === "recomputed" ? "這份排序是重新評分的結果，沒有存證。" : "這份排序已記錄，等待上鏈。"}</p>
          </>
        ) : (
          <Skeleton className="h-14 w-full" />
        )}
      </Fact>
      <Fact label="模型效果如何" href="/monitor" more="看模型監控">
        {model && status && skill ? (
          <>
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-lg font-semibold">{skill.t == null ? "還不能檢定" : skill.passed ? "達到技能檢定門檻" : "尚未達技能檢定門檻"}</span>
              <Badge tone={status.tone} icon={status.icon} title={status.note}>
                {status.text}
              </Badge>
            </p>
            {skill.t != null && (
              <p className="text-ink-2">
                {skill.label} Rank IC t 值 {fixed(skill.t, 2)}（門檻 {skill.threshold}；{skill.sample}）。
              </p>
            )}
            <p className="text-ink-2">狀態「{status.text}」：{status.note}。</p>
          </>
        ) : (
          <Skeleton className="h-14 w-full" />
        )}
      </Fact>
      <Fact label="目前有什麼限制" href="/scan" more="看排序的回測與期間">
        <ul className="list-disc space-y-1 pl-4 text-ink-2 marker:text-ink-3">
          <li>名次只是 49 檔之間的相對位置，排名靠前仍可能下跌；不是投資建議。</li>
          <li>線上成績還不到能下結論的程度；回測的組合報酬含用來選模型的 2025 年，不是獨立驗證。</li>
          <li>存證只能證明上鏈之後沒有被改過；2026-10-07 之前的紀錄是一次補上鏈的。</li>
        </ul>
      </Fact>
    </dl>
  );
}
