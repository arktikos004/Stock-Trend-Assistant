"use client";

/**
 * 存證面板：讀每日排程在上鏈之後才匯出的快照（ledger.json），節數、待上鏈的列、驗證截至哪一天、最新一節都是同一個時間點。
 * 主要只寫狀態；雜湊、驗證指令與編號的對照收在「技術細節」。
 * 還沒有快照的網站資料（新版上線後第一次排程之前），改用 monitor.json 的摘要，不顯示雜湊。
 */

import { ExternalLink, ShieldCheck, ShieldX } from "lucide-react";
import { Fragment } from "react";
import Badge from "@/components/ui/Badge";
import CopyButton from "@/components/ui/CopyButton";
import { Skeleton } from "@/components/ui/Feedback";
import Panel from "@/components/ui/Panel";
import type { LedgerSnapshot, MonitorResponse } from "@/lib/api";
import LedgerStars from "@/components/overview/LedgerStars";
import Hint from "@/components/ui/Hint";
import { taipeiTime } from "@/lib/format";
import { LINKS, REPO_URL } from "@/lib/links";

// 指令只在參數之間換行，不在「--chain」這類參數中間斷開
const VERIFY_PARTS = ["python ledger.py verify", "--db predictions.db", "--chain chain.jsonl"];
const VERIFY_CMD = VERIFY_PARTS.join(" ");

const total = (rows: Record<string, number>) => (rows.predictions ?? 0) + (rows.rank_predictions ?? 0);

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

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="shrink-0 text-ink-2">{label}</dt>
      <dd className="text-right text-ink">{children}</dd>
    </div>
  );
}

/** 待上鏈的基準日：最多列 3 天 */
export function pendingDays(days: string[]): string {
  if (days.length === 0) return "";
  const shown = days.slice(0, 3).join("、");
  return days.length > 3 ? `${shown} 等 ${days.length} 天` : shown;
}

export default function LedgerPanel({
  snapshot,
  fallback,
  className,
}: {
  snapshot: LedgerSnapshot | null | undefined; // undefined＝讀取中；null＝這一版網站資料沒有快照
  fallback: MonitorResponse["ledger"] | undefined;
  className?: string;
}) {
  const ok = snapshot ? snapshot.ok : fallback?.ok;
  const available = snapshot ? snapshot.available : fallback?.available;
  const badge = available ? (
    ok ? (
      <Badge tone="neutral" icon={ShieldCheck}>
        驗證通過
      </Badge>
    ) : (
      <Badge tone="solid" icon={ShieldX}>
        驗證不符
      </Badge>
    )
  ) : undefined;

  if (snapshot === undefined || (snapshot === null && !fallback)) {
    return (
      <Panel className={className} title="存證">
        <div className="space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-4 w-1/2" />
        </div>
      </Panel>
    );
  }

  if (snapshot === null) {
    // 舊版網站資料：只有匯出當下的摘要
    return (
      <Panel className={className} title="存證" actions={badge}>
        {!fallback?.available ? (
          <p className="text-sm text-ink-2">這次匯出沒有取得存證鏈檔，下一次每日排程會重試。</p>
        ) : (
          <>
            <LedgerStars entries={fallback.entries} verified={fallback.ok} />
            <dl className="mt-4 space-y-2 text-sm">
              <Row label="鏈節">{fallback.entries} 節</Row>
              <Row label="已上鏈">
                排序 {(fallback.chained.rank_predictions ?? 0).toLocaleString()} 列，方向 {(fallback.chained.predictions ?? 0).toLocaleString()} 列
              </Row>
              <Row label="等待上鏈">{total(fallback.pending).toLocaleString()} 列</Row>
            </dl>
            <p className="mt-3 text-xs leading-relaxed text-ink-2">這是網站資料匯出當下的摘要；下一次每日排程之後，這裡會換成上鏈之後的完整快照。</p>
          </>
        )}
      </Panel>
    );
  }

  const head = snapshot.head;
  const pending = total(snapshot.pending);
  return (
    <Panel className={className} title="存證" description={`快照 ${taipeiTime(snapshot.snapshot_at)}（上鏈之後匯出）`} actions={badge}>
      {!snapshot.available ? (
        <p className="text-sm text-ink-2">這次匯出沒有取得存證鏈檔，下一次每日排程會重試。</p>
      ) : (
        <>
          <LedgerStars entries={snapshot.entries} verified={snapshot.ok} />
          <dl className="mt-4 space-y-2 text-sm">
            <Row label="驗證截至">{snapshot.verified_through ? `${snapshot.verified_through} 的基準日` : "—"}</Row>
            <Row label="尚未上鏈">{pending > 0 ? `${pending.toLocaleString()} 列（基準日 ${pendingDays(snapshot.pending_base_dates)}）` : "沒有"}</Row>
            {head && (
              <Row label="最新一節">
                第 {head.number} 節，{taipeiTime(head.recorded_at)} 寫入
              </Row>
            )}
          </dl>
          {snapshot.problems.length > 0 && <p className="mt-3 text-sm text-ink">{snapshot.problems[0]}</p>}
          <p className="mt-3 text-sm text-ink-2">
            只能證明上鏈之後沒有被修改。
            <Hint to="ledger" className="ml-1" />
          </p>

          <details className="hairline-t mt-4 pt-3 text-xs">
            <summary className="cursor-pointer text-ink-2 hover:text-ink">技術細節：雜湊與自己驗證</summary>
            {head && (
              <dl className="mt-2 space-y-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-3">本節寫入</dt>
                  <dd className="text-ink">
                    排序 {(head.rows.rank_predictions ?? 0).toLocaleString()} 列，方向 {(head.rows.predictions ?? 0).toLocaleString()} 列
                  </dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-ink-3">已上鏈</dt>
                  <dd className="text-ink">
                    排序 {(snapshot.chained.rank_predictions ?? 0).toLocaleString()} 列，方向 {(snapshot.chained.predictions ?? 0).toLocaleString()} 列
                  </dd>
                </div>
                <Hash label="本節雜湊" value={head.hash} />
                <Hash label="前一節雜湊" value={head.prev_hash} />
                <p className="text-ink-3">
                  第 {head.number} 節＝chain.jsonl 的第 {head.number} 行（鏈節欄位 seq {head.seq}，從 0 起算）。
                </p>
              </dl>
            )}
            <p className="mt-3 text-ink-2">自己驗證：下載 ledger.py、predictions.db 與 chain.jsonl 後執行</p>
            <div className="mt-1.5 flex items-center gap-1 rounded-[3px] bg-surface-2 py-1 pl-2.5 pr-1">
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
            <p className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
              <a className="inline-flex items-center gap-1 link" href={LINKS.ledger} target="_blank" rel="noopener noreferrer">
                下載方式與驗證說明
                <ExternalLink size={12} aria-hidden="true" />
              </a>
              {head?.run_id && (
                <a
                  className="inline-flex items-center gap-1 link"
                  href={`${REPO_URL}/actions/runs/${head.run_id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  寫入這一節的排程紀錄
                  <ExternalLink size={12} aria-hidden="true" />
                </a>
              )}
            </p>
          </details>
        </>
      )}
    </Panel>
  );
}
