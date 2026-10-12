"use client";

/**
 * 頂列下方的狀態列，三件事各有自己的狀態：資料（基準日與更新時間）、存證（驗證結果與截至哪一天）、
 * 模型效果（技能檢定的 t 值與失效檢定的結果）；最後附篩選候選數。資料有更新不代表模型有效，所以不合成一個燈號。
 * 每日排程失敗時線上會停在上一版，超過 48 小時沒更新就以警示色標出，避免把過期資料當成最新。
 * 本機開發（即時後端）沒有 meta.json，只顯示讀得到的項目。
 */

import { ShieldCheck, ShieldX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { api, ledgerSnapshot, siteMeta, STATIC_DATA } from "@/lib/api";
import { fixed, taipeiDate, taipeiTime } from "@/lib/format";
import { MODEL_STATUS, skillTest } from "@/lib/status";
import { useAsync } from "@/lib/useAsync";

const STALE_HOURS = 48;

function Item({ label, children, href }: { label: string; children: ReactNode; href?: string }) {
  const body = (
    <>
      <dt className="text-ink-3">{label}</dt>
      <dd className="flex items-center gap-1.5 font-semibold text-ink">{children}</dd>
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

/** 同一項裡的補充說明：一般字重、次要文字色 */
const Sub = ({ children }: { children: ReactNode }) => <span className="font-normal text-ink-2">{children}</span>;

const Pending = () => <span className="inline-block h-3 w-12 rounded-sm bg-surface-3 motion-safe:animate-pulse" aria-label="讀取中" />;

export default function StatusStrip() {
  const meta = useAsync(STATIC_DATA ? "meta" : null, async () => {
    const m = await siteMeta();
    return { ...m, stale: Date.now() - Date.parse(m.generated_at) > STALE_HOURS * 3600 * 1000 };
  });
  const monitor = useAsync("monitor", () => api.monitor());
  const screener = useAsync("screener", () => api.screener());
  const snapshot = useAsync("ledger", ledgerSnapshot);

  const m = monitor.data;
  const status = m ? MODEL_STATUS[m.model.status] : null;
  const skill = m ? skillTest(m.model) : null;
  // 存證：優先用上鏈之後的快照；舊版網站資料沒有快照時退回 monitor.json 的摘要
  const snap = snapshot.error ? null : snapshot.data;
  const ledger = snap ?? m?.ledger;
  const pending = ledger ? (ledger.pending.predictions ?? 0) + (ledger.pending.rank_predictions ?? 0) : 0;
  const through = snap ? snap.verified_through : ledger && "last_recorded_at" in ledger && ledger.last_recorded_at ? taipeiDate(ledger.last_recorded_at) : null;

  return (
    <div className="border-b border-border bg-surface-2">
      <dl
        aria-label="資料、存證與模型效果的狀態"
        className="mx-auto flex w-full max-w-[1280px] items-center gap-x-4 overflow-x-auto whitespace-nowrap px-4 py-2 text-xs [scrollbar-width:none] lg:px-6"
      >
        <Item label="資料">
          {m ? <>基準日 {m.base_date}</> : monitor.error ? "—" : <Pending />}
          {STATIC_DATA &&
            meta.data &&
            (meta.data.stale ? (
              <span className="flex items-center gap-1 text-warn">
                <TriangleAlert size={13} aria-hidden="true" />
                {taipeiTime(meta.data.generated_at)} 更新，可能已過期
              </span>
            ) : (
              <Sub>{taipeiTime(meta.data.generated_at)} 更新</Sub>
            ))}
        </Item>
        <Item label="存證" href="/monitor#ledger">
          {ledger ? (
            ledger.available ? (
              <>
                {ledger.ok ? (
                  <span className="flex items-center gap-0.5">
                    <ShieldCheck size={13} className="text-accent" aria-hidden="true" />
                    驗證通過
                  </span>
                ) : (
                  <span className="flex items-center gap-0.5 rounded-sm bg-ink px-1 text-surface">
                    <ShieldX size={13} aria-hidden="true" />
                    驗證不符
                  </span>
                )}
                <Sub>
                  {through ? `驗證截至 ${through}` : "還沒有鏈節"}
                  {pending > 0 && `，${pending.toLocaleString()} 列待上鏈`}
                </Sub>
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
        <Item label="模型效果" href="/monitor">
          {m && status && skill ? (
            <>
              {skill.t == null ? "技能檢定：到期日不足" : `技能檢定 t ${fixed(skill.t, 2)}，${skill.passed ? "已達" : "未達"}門檻 ${skill.threshold}`}
              <span className="flex items-center gap-1 font-normal text-ink-2">
                <status.icon size={13} className={status.tone === "accent" ? "text-accent" : status.tone === "warn" ? "text-warn" : "text-ink-2"} aria-hidden="true" />
                {status.brief}
              </span>
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
