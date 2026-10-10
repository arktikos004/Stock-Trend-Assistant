"use client";

/**
 * 存證面板：鏈節數、最新一節的時間與寫入列數、雜湊，以及自己驗證的方法。
 * 雜湊直接讀 GitHub 上公開的 ledger 分支；讀不到時只顯示 monitor.json 的摘要。
 */

import { ExternalLink, ShieldCheck, ShieldX } from "lucide-react";
import { Fragment } from "react";
import Badge from "@/components/ui/Badge";
import CopyButton from "@/components/ui/CopyButton";
import { Skeleton } from "@/components/ui/Feedback";
import Panel from "@/components/ui/Panel";
import type { LedgerLink, MonitorResponse } from "@/lib/api";
import { taipeiTime } from "@/lib/format";
import { LINKS, REPO_URL } from "@/lib/links";

// 指令只在參數之間換行，不在「--chain」這類參數中間斷開
const VERIFY_PARTS = ["python ledger.py verify", "--db predictions.db", "--chain chain.jsonl"];
const VERIFY_CMD = VERIFY_PARTS.join(" ");

function Hash({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <dt className="shrink-0 text-xs text-ink-3">{label}</dt>
      <dd className="flex min-w-0 items-center gap-1">
        <code className="truncate font-mono text-xs text-ink" title={value}>
          {value.slice(0, 16)}…
        </code>
        <CopyButton text={value} label={label} />
      </dd>
    </div>
  );
}

export default function LedgerPanel({
  ledger,
  head,
  headFailed,
}: {
  ledger: MonitorResponse["ledger"] | undefined;
  head: LedgerLink | null | undefined;
  headFailed: boolean;
}) {
  const badge = ledger?.available ? (
    ledger.ok ? (
      <Badge tone="accent" icon={ShieldCheck}>
        驗證通過
      </Badge>
    ) : (
      <Badge tone="solid" icon={ShieldX}>
        驗證不符
      </Badge>
    )
  ) : undefined;

  return (
    <Panel title="存證" actions={badge}>
      {!ledger ? (
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      ) : !ledger.available ? (
        <p className="text-sm text-ink-2">這次匯出沒有取得存證鏈檔，下一次每日排程會重試。</p>
      ) : (
        <>
          <dl className="space-y-2 text-sm">
            <div className="flex justify-between gap-2">
              <dt className="text-ink-2">鏈節</dt>
              <dd className="font-semibold text-ink">{ledger.entries} 節</dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-2">已上鏈</dt>
              <dd className="text-ink">
                排序 {(ledger.chained.rank_predictions ?? 0).toLocaleString()} 列，方向 {(ledger.chained.predictions ?? 0).toLocaleString()} 列
              </dd>
            </div>
            <div className="flex justify-between gap-2">
              <dt className="text-ink-2">等待上鏈</dt>
              <dd className="text-ink">{((ledger.pending.predictions ?? 0) + (ledger.pending.rank_predictions ?? 0)).toLocaleString()} 列</dd>
            </div>
            {head && (
              <>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-2">最新一節</dt>
                  <dd className="text-ink">
                    第 {head.seq + 1} 節，{taipeiTime(head.recorded_at)} 寫入
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-2">本節寫入</dt>
                  <dd className="text-ink">
                    排序 {(head.ranges.rank_predictions?.rows ?? 0).toLocaleString()} 列，方向 {(head.ranges.predictions?.rows ?? 0).toLocaleString()} 列
                  </dd>
                </div>
              </>
            )}
          </dl>

          {head && (
            <dl className="mt-3 space-y-1 border-t border-border pt-3">
              <Hash label="本節雜湊" value={head.hash} />
              <Hash label="前一節雜湊" value={head.prev_hash} />
            </dl>
          )}
          {headFailed && <p className="mt-3 text-xs text-ink-3">GitHub 上的鏈檔暫時讀不到，這裡先不顯示雜湊。</p>}

          {ledger.problems.length > 0 && <p className="mt-3 text-xs text-ink">{ledger.problems[0]}</p>}

          <div className="mt-3 border-t border-border pt-3">
            <p className="text-xs text-ink-2">自己驗證：下載 ledger.py、predictions.db 與 chain.jsonl 後執行</p>
            <div className="mt-1.5 flex items-center gap-1 rounded-md bg-surface-2 py-1 pl-2.5 pr-1">
              <code className="min-w-0 flex-1 font-mono text-xs leading-relaxed text-ink">
                {VERIFY_PARTS.map((part, i) => (
                  <Fragment key={part}>
                    {i > 0 && " "}
                    <span className="whitespace-nowrap">{part}</span>
                  </Fragment>
                ))}
              </code>
              <CopyButton text={VERIFY_CMD} label="驗證指令" />
            </div>
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs">
              <a className="inline-flex items-center gap-1 text-accent hover:underline" href={LINKS.ledger} target="_blank" rel="noopener noreferrer">
                下載方式與驗證說明
                <ExternalLink size={12} aria-hidden="true" />
              </a>
              {head?.run_id && (
                <a
                  className="inline-flex items-center gap-1 text-accent hover:underline"
                  href={`${REPO_URL}/actions/runs/${head.run_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  寫入這一節的排程紀錄
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              )}
            </p>
          </div>
        </>
      )}
    </Panel>
  );
}
