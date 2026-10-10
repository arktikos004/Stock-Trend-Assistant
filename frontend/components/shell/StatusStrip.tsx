"use client";

/**
 * 頂列下方的狀態列：基準日、資料更新時間、存證鏈、模型監控、篩選候選數。
 * 每日排程失敗時線上會停在上一版，超過 48 小時沒更新就以警示色標出，避免把過期資料當成最新。
 * 本機開發（即時後端）沒有 meta.json，只顯示讀得到的項目。
 */

import { ShieldCheck, ShieldX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { api, siteMeta, STATIC_DATA } from "@/lib/api";
import { taipeiTime } from "@/lib/format";
import { MODEL_STATUS } from "@/lib/status";
import { useAsync } from "@/lib/useAsync";

const STALE_HOURS = 48;

function Item({ label, children, href }: { label: string; children: ReactNode; href?: string }) {
  const body = (
    <>
      <dt className="text-ink-3">{label}</dt>
      <dd className="flex items-center gap-1 font-semibold text-ink">{children}</dd>
    </>
  );
  return (
    <div className="flex shrink-0 items-center gap-1.5 border-l border-border pl-4 first:border-l-0 first:pl-0">
      {href ? (
        <Link href={href} className="flex items-center gap-1.5 rounded-sm hover:underline">
          {body}
        </Link>
      ) : (
        body
      )}
    </div>
  );
}

const Pending = () => <span className="inline-block h-3 w-12 rounded-sm bg-surface-3 motion-safe:animate-pulse" aria-label="讀取中" />;

export default function StatusStrip() {
  const meta = useAsync(STATIC_DATA ? "meta" : null, async () => {
    const m = await siteMeta();
    return { ...m, stale: Date.now() - Date.parse(m.generated_at) > STALE_HOURS * 3600 * 1000 };
  });
  const monitor = useAsync("monitor", () => api.monitor());
  const screener = useAsync("screener", () => api.screener());

  const m = monitor.data;
  const status = m ? MODEL_STATUS[m.model.status] : null;
  const ledger = m?.ledger;

  return (
    <div className="border-b border-border bg-surface-2">
      <dl
        aria-label="資料狀態"
        className="mx-auto flex w-full max-w-[1280px] items-center gap-x-4 overflow-x-auto whitespace-nowrap px-4 py-2 text-xs [scrollbar-width:none] lg:px-6"
      >
        <Item label="基準日">{m ? m.base_date : monitor.error ? "—" : <Pending />}</Item>
        {STATIC_DATA && (
          <Item label="資料更新">
            {meta.data ? (
              meta.data.stale ? (
                <span className="flex items-center gap-1 text-warn">
                  <TriangleAlert size={13} aria-hidden="true" />
                  {taipeiTime(meta.data.generated_at)}，可能已過期
                </span>
              ) : (
                taipeiTime(meta.data.generated_at)
              )
            ) : meta.error ? (
              "—"
            ) : (
              <Pending />
            )}
          </Item>
        )}
        <Item label="存證鏈" href="/monitor#ledger">
          {ledger ? (
            ledger.available ? (
              <>
                {ledger.entries} 節
                {ledger.ok ? (
                  <span className="flex items-center gap-0.5 font-normal text-ink-2">
                    <ShieldCheck size={13} className="text-accent" aria-hidden="true" />
                    驗證通過
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5 rounded-sm bg-ink px-1 text-surface">
                    <ShieldX size={13} aria-hidden="true" />
                    驗證不符
                  </span>
                )}
              </>
            ) : (
              "這次匯出沒有鏈檔"
            )
          ) : monitor.error ? (
            "—"
          ) : (
            <Pending />
          )}
        </Item>
        <Item label="模型監控" href="/monitor">
          {status ? (
            <>
              <status.icon size={13} className={status.tone === "accent" ? "text-accent" : status.tone === "warn" ? "text-warn" : "text-ink-2"} aria-hidden="true" />
              {status.text}
            </>
          ) : monitor.error ? (
            "—"
          ) : (
            <Pending />
          )}
        </Item>
        <Item label="篩選候選" href="/screener">
          {screener.data ? (
            <span className="flex gap-2">
              <span>T1 {screener.data.counts.T1}</span>
              <span>T2 {screener.data.counts.T2}</span>
              <span>T3 {screener.data.counts.T3}</span>
            </span>
          ) : screener.error ? (
            "—"
          ) : (
            <Pending />
          )}
        </Item>
      </dl>
    </div>
  );
}
