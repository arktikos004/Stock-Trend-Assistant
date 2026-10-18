import { useId, type ReactNode } from "react";

/**
 * 資料區塊：不加框、不加陰影。明體小標題與一行說明，下面一道細線，內容靠留白分組。
 * 只用在真正需要分組的地方，不拿來包每一段文字。
 */
export default function Panel({
  title,
  description,
  actions,
  children,
  id,
  className = "",
  bodyClassName = "pt-5",
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
    <section id={id} aria-labelledby={title ? headingId : undefined} className={className}>
      {(title || actions) && (
        <header className="hairline-b flex flex-wrap items-end justify-between gap-x-4 gap-y-2 pb-3">
          <div className="min-w-0">
            {title && (
              <h2 id={headingId} className="font-serif text-[17px] font-semibold leading-snug text-ink">
                {title}
              </h2>
            )}
            {description && <p className="mt-1 text-xs text-ink-3">{description}</p>}
          </div>
          {actions}
        </header>
      )}
      <div className={bodyClassName}>{children}</div>
    </section>
  );
}
