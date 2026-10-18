"use client";

/**
 * 選單抽屜（原生 <dialog>）：外觀（野外版／桌上版／跟隨系統）、漲跌顏色、文件中心、規則文件、存證鏈、資料來源與授權。
 * showModal() 讓焦點留在抽屜裡、Esc 可關；關閉後瀏覽器把焦點還給開啟它的按鈕。
 */

import { BookOpen, ExternalLink, Monitor, Moon, Sun, TrendingDown, TrendingUp, X } from "lucide-react";
import Link from "next/link";
import type { Ref } from "react";
import { LINKS } from "@/lib/links";
import { setThemeMode, useThemeMode, type ThemeMode } from "@/lib/theme";
import { setUpDown, useUpDown, type UpDown } from "@/lib/updown";

const THEMES: { value: ThemeMode; label: string; note: string; icon: typeof Sun }[] = [
  { value: "dark", label: "野外版", note: "深色", icon: Moon },
  { value: "light", label: "桌上版", note: "淺色", icon: Sun },
  { value: "system", label: "跟隨系統", note: "依裝置", icon: Monitor },
];

const UPDOWNS: { value: UpDown; label: string }[] = [
  { value: "red-up", label: "紅漲綠跌（台股）" },
  { value: "green-up", label: "綠漲紅跌（美股）" },
];

const RULES: { href: string; label: string; note: string }[] = [
  { href: LINKS.ledger, label: "存證鏈與驗證方式", note: "ledger 分支：每日預測的雜湊鏈與驗證指令" },
  { href: LINKS.monitorRules, label: "監控規則", note: "失效門檻與例外報表的預先聲明" },
  { href: LINKS.baselineRules, label: "對照規則", note: "簡單因子對照與可成交性的預先聲明" },
  { href: LINKS.screenerRules, label: "篩選器規則", note: "綜合評分權重與分層的預先聲明" },
  { href: LINKS.dataSources, label: "資料來源與授權", note: "證交所、集保開放資料與使用限制" },
  { href: LINKS.repo, label: "原始碼", note: "GitHub：模型、排程與網站程式" },
];

const option = (active: boolean) =>
  `flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-[3px] text-xs transition-colors duration-150 ${
    active ? "bg-surface-2 font-semibold text-ink" : "text-ink-2 hover:text-ink"
  }`;

export default function MenuDrawer({ ref }: { ref: Ref<HTMLDialogElement> }) {
  const theme = useThemeMode();
  const upDown = useUpDown();
  // --up／--down 跟著目前的設定對調；預覽圖示要固定畫出這個主題的紅與綠
  const red = upDown === "red-up" ? "var(--up)" : "var(--down)";
  const green = upDown === "red-up" ? "var(--down)" : "var(--up)";
  const close = (e: React.MouseEvent<HTMLElement>) => (e.currentTarget.closest("dialog") as HTMLDialogElement | null)?.close();
  return (
    <dialog
      ref={ref}
      aria-labelledby="menu-title"
      // 點到抽屜外的遮罩就關閉
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="hairline-l m-0 ml-auto h-dvh max-h-dvh w-[min(22rem,100vw)] max-w-none border-0 bg-surface p-0 text-ink shadow-(--shadow-pop)"
    >
      <div className="flex h-full flex-col">
        <div className="hairline-b flex items-center justify-between px-5 py-3">
          <h2 id="menu-title" className="font-serif text-base font-semibold">
            選單
          </h2>
          <form method="dialog">
            <button
              type="submit"
              aria-label="關閉選單"
              className="flex size-9 items-center justify-center rounded-[3px] text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </form>
        </div>

        <div className="flex-1 space-y-8 overflow-y-auto px-5 py-6">
          <section aria-labelledby="menu-theme">
            <h3 id="menu-theme" className="mb-2 text-xs text-ink-3">
              外觀
            </h3>
            <div role="radiogroup" aria-labelledby="menu-theme" className="hairline-t hairline-b grid grid-cols-3 gap-1 py-1">
              {THEMES.map(({ value, label, note, icon: Icon }) => {
                const active = theme === value;
                return (
                  <button key={value} type="button" role="radio" aria-checked={active} onClick={() => setThemeMode(value)} className={option(active)}>
                    <Icon size={16} aria-hidden="true" className={active ? "text-accent" : undefined} />
                    {label}
                    <span className="text-[11px] font-normal text-ink-3">{note}</span>
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="menu-updown">
            <h3 id="menu-updown" className="mb-2 text-xs text-ink-3">
              漲跌顏色
            </h3>
            <div role="radiogroup" aria-labelledby="menu-updown" className="hairline-t hairline-b grid grid-cols-2 gap-1 py-1">
              {UPDOWNS.map(({ value, label }) => {
                const active = upDown === value;
                const [up, down] = value === "red-up" ? [red, green] : [green, red];
                return (
                  <button key={value} type="button" role="radio" aria-checked={active} onClick={() => setUpDown(value)} className={option(active)}>
                    <span className="flex gap-1" aria-hidden="true">
                      <TrendingUp size={16} style={{ color: up }} />
                      <TrendingDown size={16} style={{ color: down }} />
                    </span>
                    {label}
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="menu-docs">
            <h3 id="menu-docs" className="mb-1 text-xs text-ink-3">
              文件與規則
            </h3>
            <ul>
              <li className="hairline-b">
                <Link href="/docs" onClick={close} className="group flex items-start justify-between gap-3 py-3">
                  <span>
                    <span className="block font-serif text-[15px] font-semibold text-ink group-hover:underline">文件中心</span>
                    <span className="mt-0.5 block text-xs text-ink-3">每個數字怎麼算、驗證到哪裡、還有什麼沒驗證</span>
                  </span>
                  <BookOpen size={14} className="mt-1 shrink-0 text-ink-3" aria-hidden="true" />
                </Link>
              </li>
              {RULES.map((d) => (
                <li key={d.href} className="hairline-b last:border-b-0">
                  <a href={d.href} target="_blank" rel="noopener noreferrer" className="group flex items-start justify-between gap-3 py-3">
                    <span>
                      <span className="block text-sm text-ink group-hover:underline">{d.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-3">{d.note}</span>
                    </span>
                    <ExternalLink size={14} className="mt-1 shrink-0 text-ink-3" aria-label="另開新分頁" />
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <p className="text-xs leading-relaxed text-ink-3">研究工具，不構成投資建議。資料每個交易日收盤後更新，不是即時行情。</p>
        </div>
      </div>
    </dialog>
  );
}
