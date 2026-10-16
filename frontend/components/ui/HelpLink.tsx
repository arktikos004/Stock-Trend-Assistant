import Link from "next/link";
import type { ReactNode } from "react";

/** 「方法與限制」頁的段落：各頁的數字旁只放一個短連結，定義與但書集中寫在那一頁 */
export type MethodSection = "reading" | "rank" | "model" | "backtest" | "direction" | "screener" | "chips" | "ledger" | "market" | "data";

export default function HelpLink({ to, children = "說明", className = "" }: { to: MethodSection; children?: ReactNode; className?: string }) {
  return (
    <Link href={`/method#${to}`} className={`whitespace-nowrap font-medium text-accent hover:underline ${className}`}>
      {children}
    </Link>
  );
}
