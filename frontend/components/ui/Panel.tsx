import { useId, type ReactNode } from "react";

/**
 * 資料面板：細線框、8px 圓角、不加陰影；標題列與內容之間一條分隔線。
 * 面板只用在真正需要分組的地方，不拿來包每一段文字。
 */
export default function Panel({
  title,
  description,
  actions,
  children,
  id,
  className = "",
  bodyClassName = "p-4",
}: {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  id?: string;
  className?: string;
  bodyClassName?: string;
}) {
  const headingId = useId();
  return (
    <section
      id={id}
      aria-labelledby={title ? headingId : undefined}
      className={`rounded-lg border border-border bg-surface ${className}`}
    >
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-b border-border px-4 py-3">
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="text-[15px] font-semibold leading-snug text-ink">
                {title}
              </h2>
            )}
            {description && <p className="mt-0.5 text-xs text-ink-3">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
