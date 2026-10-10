import { Activity, LayoutDashboard, ListFilter, ListOrdered, type LucideIcon } from "lucide-react";

/** 主要頁面：桌機在頂列、手機在底部分頁列，兩處同一組。個股頁從搜尋或表格進入，不放分頁。 */
export const NAV: readonly { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "總覽", icon: LayoutDashboard },
  { href: "/scan", label: "排序", icon: ListOrdered },
  { href: "/screener", label: "篩選", icon: ListFilter },
  { href: "/monitor", label: "監控", icon: Activity },
];

/** 靜態站的網址可能帶結尾斜線（/scan/），比對前先去掉 */
export function isActive(pathname: string, href: string): boolean {
  const p = pathname.replace(/\/+$/, "") || "/";
  return href === "/" ? p === "/" : p === href || p.startsWith(`${href}/`);
}
