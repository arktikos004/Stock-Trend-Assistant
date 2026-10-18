import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import type { BadgeTone } from "@/lib/status";

const TONE: Record<BadgeTone, string> = {
  neutral: "border-transparent text-ink-2",
  up: "border-transparent bg-up-soft text-up",
  down: "border-transparent bg-down-soft text-down",
  hold: "border-transparent bg-hold-soft text-hold",
  warn: "border-transparent bg-warn-soft text-warn",
  solid: "border-transparent bg-ink text-background",
};

/** 狀態徽章：顏色只是輔助，文字一定在。中性的只是文字（附圖示），不加框；需要注意的用淡底色，警示用實心墨色。 */
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
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-[3px] border px-1.5 py-[3px] text-xs font-semibold leading-none ${TONE[tone]} ${className}`}
    >
      {Icon && <Icon size={13} strokeWidth={2} aria-hidden="true" />}
      {children}
    </span>
  );
}
