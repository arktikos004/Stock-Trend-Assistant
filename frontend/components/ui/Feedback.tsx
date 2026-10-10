import { CircleAlert, type LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

/** 載入中的骨架：與資料到了之後同樣大小，版面不會跳動。 */
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`rounded bg-surface-3 motion-safe:animate-pulse ${className}`} />;
}

/** 表格骨架：幾列等高的灰條 */
export function TableSkeleton({ rows = 6, label }: { rows?: number; label: string }) {
  return (
    <div role="status" aria-label={label} className="space-y-2.5 py-1">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-7 w-full" />
      ))}
    </div>
  );
}

/** 空狀態：說明為什麼是空的，以及下一步可以做什麼。 */
export function EmptyState({
  icon: Icon,
  title,
  children,
  action,
}: {
  icon?: LucideIcon;
  title: ReactNode;
  children?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-10 text-center">
      {Icon && <Icon size={22} className="text-ink-3" aria-hidden="true" />}
      <p className="text-sm font-medium text-ink">{title}</p>
      {children && <div className="max-w-[48ch] text-xs leading-relaxed text-ink-3">{children}</div>}
      {action}
    </div>
  );
}

/** 錯誤與提醒：寫出發生什麼、怎麼處理。 */
export function Notice({
  tone = "neutral",
  icon: Icon = CircleAlert,
  children,
  action,
}: {
  tone?: "neutral" | "warn" | "error";
  icon?: LucideIcon;
  children: ReactNode;
  action?: ReactNode;
}) {
  const style =
    tone === "error"
      ? "border-up/30 bg-up-soft text-ink"
      : tone === "warn"
        ? "border-warn/30 bg-warn-soft text-ink"
        : "border-border bg-surface-2 text-ink-2";
  const iconColor = tone === "error" ? "text-up" : tone === "warn" ? "text-warn" : "text-ink-3";
  return (
    <div role={tone === "error" ? "alert" : "status"} className={`flex items-start gap-2.5 rounded-lg border px-4 py-3 text-sm ${style}`}>
      <Icon size={17} className={`mt-0.5 shrink-0 ${iconColor}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 leading-relaxed">{children}</div>
      {action}
    </div>
  );
}
