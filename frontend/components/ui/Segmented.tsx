"use client";

/**
 * 分段切換：一組互斥的選項（模式、區間、篩選範圍）。用 aria-pressed 標示目前選項。
 * 沒有底框：選項是文字，目前的選項是墨色加一道琥珀底線。
 */
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
  const pad = size === "sm" ? "min-h-8 px-2 text-xs" : "min-h-9 px-2.5 text-sm";
  return (
    <div role="group" aria-label={label} className="inline-flex max-w-full gap-1 overflow-x-auto">
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            title={o.title}
            aria-pressed={active}
            onClick={() => onChange(o.value)}
            className={`relative shrink-0 whitespace-nowrap transition-colors duration-150 ${pad} ${
              active
                ? "font-semibold text-ink after:absolute after:inset-x-2 after:bottom-0.5 after:h-0.5 after:bg-accent-mark"
                : "text-ink-3 hover:text-ink"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
