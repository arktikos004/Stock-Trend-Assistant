"use client";

import Link from "next/link";

/** 頁面導覽：儀表板 ↔ 全池掃描 ↔ 篩選器。current 標示目前頁。 */
export default function NavTabs({ current }: { current: "dashboard" | "scan" | "screener" }) {
  const tabs = [
    { key: "dashboard", label: "儀表板", href: "/" },
    { key: "scan", label: "全池掃描", href: "/scan" },
    { key: "screener", label: "篩選器", href: "/screener" },
  ] as const;
  return (
    <nav className="flex gap-1 rounded-lg bg-surface-2 p-1">
      {tabs.map((t) => {
        const active = t.key === current;
        return (
          <Link
            key={t.key}
            href={t.href}
            className="rounded-md px-3 py-1.5 text-sm font-medium transition"
            style={
              active
                ? { background: "var(--surface)", color: "var(--ink)", boxShadow: "var(--shadow-sm)" }
                : { color: "var(--ink-3)" }
            }
          >
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
