"use client";

/** 分段切換：一組互斥的選項（模式、區間、篩選範圍）。用 aria-pressed 標示目前選項。 */
export default function Segmented<T extends string>({
  label,
  options,
  value,
  onChange,
  size = "md",
}: {
  label: string;
  options: readonly { value: T; label: string; title?: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: "sm" | "md";
}) {
  const pad = size === "sm" ? "min-h-8 px-2.5 text-xs" : "min-h-9 px-3 text-sm";
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full gap-0.5 overflow-x-auto rounded-md border border-border bg-surface-2 p-0.5">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`shrink-0 whitespace-nowrap rounded-[5px] font-medium transition-colors duration-150 ${pad} ${
              active ? "bg-surface text-ink ring-1 ring-border-strong" : "text-ink-2 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
