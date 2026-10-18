"use client";

/**
 * 頂列右側的資料戳記，取代原本的全站狀態列：平常只寫「基準日」，連到監控頁。
 * 兩種情況才多說：超過 48 小時沒更新（琥珀，可能已過期），或存證鏈驗證不符（實心墨色，不用紅色）。
 * 本機開發（即時後端）沒有 meta.json，只顯示讀得到的項目。
 */

import { ShieldX, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { api, ledgerSnapshot, siteMeta, STATIC_DATA } from "@/lib/api";
import { taipeiTime } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

const STALE_HOURS = 48;

export default function DataStamp({ className = "" }: { className?: string }) {
  const meta = useAsync(STATIC_DATA ? "meta" : null, async () => {
    const m = await siteMeta();
    return { ...m, stale: Date.now() - Date.parse(m.generated_at) > STALE_HOURS * 3600 * 1000 };
  });
  const monitor = useAsync("monitor", () => api.monitor());
  const snapshot = useAsync("ledger", ledgerSnapshot);

  const base = monitor.data?.base_date ?? meta.data?.data_as_of;
  const ledger = (snapshot.error ? null : snapshot.data) ?? monitor.data?.ledger;
  const broken = ledger != null && ledger.available && ledger.ok === false;
  if (!base) return null;

  return (
    <Link href="/monitor" className={`flex items-center gap-2 whitespace-nowrap text-xs text-ink-3 hover:text-ink ${className}`}>
      <span>基準日 {base.slice(5).replace("-", "/")}</span>
      {STATIC_DATA && meta.data?.stale && (
        <span className="flex items-center gap-1 text-warn" title={`${taipeiTime(meta.data.generated_at)} 更新`}>
          <TriangleAlert size={13} aria-hidden="true" />
          可能已過期
        </span>
      )}
      {broken && (
        <span className="flex items-center gap-1 rounded-[3px] bg-ink px-1.5 py-0.5 font-semibold text-background">
          <ShieldX size={13} aria-hidden="true" />
          存證不符
        </span>
      )}
    </Link>
  );
}
