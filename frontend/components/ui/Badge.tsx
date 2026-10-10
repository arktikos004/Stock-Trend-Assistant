import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { BadgeTone } from "@/lib/status";

const TONE: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-border",
  accent: "bg-accent-soft text-accent border-transparent",
  up: "bg-up-soft text-up border-transparent",
  down: "bg-down-soft text-down border-transparent",
  hold: "bg-hold-soft text-hold border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  solid: "bg-ink text-surface border-transparent",
};

/** 狀態徽章：顏色只是輔助，文字一定在。 */
export default function Badge({
  tone = "neutral",
  icon: Icon,
  children,
  className = "",
  title,
}: {
  tone?: BadgeTone;
  icon?: LucideIcon;
  children: ReactNode;
  className?: string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-md border px-1.5 py-0.5 text-xs font-semibold leading-none ${TONE[tone]} ${className}`}
    >
      {Icon && <Icon size={13} strokeWidth={2.2} aria-hidden="true" />}
      {children}
    </span>
  );
}
