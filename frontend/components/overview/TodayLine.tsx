"use client";

/**
 * 總覽標題下的一行：資料是哪一天的、這份排序有沒有存證、模型目前的狀態。
 * 每一項只寫幾個字，項目之間只用留白分開；換行時整項（連同提示圖示）一起換，不會把一半留在行尾。
 * 技能檢定的數字與定義收在提示裡（點開才看到）。
 */

import { ShieldCheck, ShieldX } from "lucide-react";
import type { ReactNode } from "react";
import Badge from "@/components/ui/Badge";
import { Skeleton } from "@/components/ui/Feedback";
import Hint from "@/components/ui/Hint";
import type { LedgerSnapshot, MonitorResponse, RankResponse, SiteMeta } from "@/lib/api";
import { fixed, taipeiTime } from "@/lib/format";
import { MODEL_STATUS, skillTest } from "@/lib/status";

const Item = ({ children, className = "" }: { children: ReactNode; className?: string }) => (
  <span className={`inline-flex items-center gap-1.5 whitespace-nowrap ${className}`}>{children}</span>
);

export default function TodayLine({
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
  if (!rank) return <Skeleton className="h-5 w-80 max-w-full" />;
  const status = model ? MODEL_STATUS[model.status] : null;
  const skill = model ? skillTest(model) : null;
  const sealed = snapshot?.verified_through != null && rank.base_date <= snapshot.verified_through;
  const broken = snapshot != null && snapshot.available && !snapshot.ok;

  return (
    <p className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-ink-2">
      <Item>基準日 {rank.base_date}</Item>
      {meta && (
        <Item className={meta.stale ? "text-warn" : undefined}>
          {taipeiTime(meta.generated_at)} 更新{meta.stale && "，可能已過期"}
        </Item>
      )}
      <Item className="text-ink">
        {broken ? (
          <>
            <ShieldX size={14} aria-hidden="true" />
            存證驗證不符
          </>
        ) : sealed ? (
          <>
            <ShieldCheck size={14} className="text-accent" aria-hidden="true" />
            {snapshot?.head ? `第 ${snapshot.head.number} 節已存證，驗證通過` : "已存證，驗證通過"}
          </>
        ) : (
          <span className="text-ink-2">{rank.basis === "recomputed" ? "重新評分，沒有存證" : "已記錄，等待上鏈"}</span>
        )}
        <Hint to="ledger" anchor="chain" label="存證">
          <p>每天的排序在排程保存資料庫之後串成雜湊鏈的一節；之後任何一列被改動，驗證都會失敗。只能證明上鏈之後沒有被修改。</p>
        </Hint>
      </Item>
      {status && skill && (
        <Item>
          模型
          <Badge tone={status.tone} icon={status.icon}>
            {status.text}
          </Badge>
          <Hint to="model" anchor="skill" label="模型效果">
            <p>
              {skill.t == null
                ? "到期日還不夠，不能做技能檢定。"
                : `${skill.label} t ${fixed(skill.t, 2)}，${skill.passed ? "已達" : "尚未達"}技能檢定門檻 ${skill.threshold}。`}
              「{status.text}」：{status.note}。
            </p>
            <p>名次是相對位置，不是漲跌預測；線上成績還不能下結論，不構成投資建議。</p>
          </Hint>
        </Item>
      )}
    </p>
  );
}
