import type { ReactNode } from "react";

/** 頁面標題：一個 h1、一段說明，右側可放這一頁的主要控制項。 */
export default function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className="min-w-0 max-w-[72ch]">
        <h1 className="text-2xl font-semibold leading-tight tracking-tight text-ink">{title}</h1>
        {description && <div className="mt-1.5 text-sm leading-relaxed text-ink-2">{description}</div>}
      </div>
      {actions}
    </div>
  );
}
