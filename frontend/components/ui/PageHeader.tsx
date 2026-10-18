import type { ReactNode } from "react";

/** 頁面標題：明體 h1、一行說明，右側可放這一頁的主要控制項。說明文字限制行長；wide 給一排短項目的狀態列（不必限制行長）。 */
export default function PageHeader({
  title,
  description,
  actions,
  wide = false,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <div className={wide ? "min-w-0" : "min-w-0 max-w-[72ch]"}>
        <h1 className="font-serif text-[28px] font-semibold leading-tight text-ink sm:text-[30px]">{title}</h1>
        {description && <div className="mt-2 text-sm leading-relaxed text-ink-2">{description}</div>}
      </div>
      {actions}
    </div>
  );
}
