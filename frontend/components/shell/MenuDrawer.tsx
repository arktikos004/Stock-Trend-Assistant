"use client";

/**
 * 選單抽屜（原生 <dialog>）：主題、規則文件、存證鏈、資料來源與授權。
 * showModal() 讓焦點留在抽屜裡、Esc 可關；關閉後瀏覽器把焦點還給開啟它的按鈕。
 */

import { ExternalLink, Monitor, Moon, Sun, X } from "lucide-react";
import type { Ref } from "react";
import { LINKS } from "@/lib/links";
import { setThemeMode, useThemeMode, type ThemeMode } from "@/lib/theme";

const THEMES: { value: ThemeMode; label: string; icon: typeof Sun }[] = [
  { value: "light", label: "淺色", icon: Sun },
  { value: "dark", label: "深色", icon: Moon },
  { value: "system", label: "跟隨系統", icon: Monitor },
];

const DOCS: { href: string; label: string; note: string }[] = [
  { href: LINKS.ledger, label: "存證鏈與驗證方式", note: "ledger 分支：每日預測的雜湊鏈與驗證指令" },
  { href: LINKS.monitorRules, label: "監控規則", note: "失效門檻與例外報表的預先聲明" },
  { href: LINKS.screenerRules, label: "篩選器規則", note: "綜合評分權重與分層的預先聲明" },
  { href: LINKS.dataSources, label: "資料來源與授權", note: "證交所、集保開放資料與使用限制" },
  { href: LINKS.repo, label: "原始碼", note: "GitHub：模型、排程與網站程式" },
];

export default function MenuDrawer({ ref }: { ref: Ref<HTMLDialogElement> }) {
  const theme = useThemeMode();
  return (
    <dialog
      ref={ref}
      aria-labelledby="menu-title"
      // 點到抽屜外的遮罩就關閉
      onClick={(e) => {
        if (e.target === e.currentTarget) e.currentTarget.close();
      }}
      className="m-0 ml-auto h-dvh max-h-dvh w-[min(22rem,100vw)] max-w-none border-0 border-l border-border bg-surface p-0 text-ink shadow-(--shadow-pop)"
    >
      <div className="flex h-full flex-col">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <h2 id="menu-title" className="text-base font-semibold">
            選單
          </h2>
          <form method="dialog">
            <button
              type="submit"
              aria-label="關閉選單"
              className="flex size-9 items-center justify-center rounded-md text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
            >
              <X size={18} aria-hidden="true" />
            </button>
          </form>
        </div>

        <div className="flex-1 space-y-7 overflow-y-auto px-4 py-5">
          <section aria-labelledby="menu-theme">
            <h3 id="menu-theme" className="mb-2 text-xs font-semibold text-ink-3">
              外觀
            </h3>
            <div role="radiogroup" aria-labelledby="menu-theme" className="grid grid-cols-3 gap-1 rounded-md border border-border bg-surface-2 p-1">
              {THEMES.map(({ value, label, icon: Icon }) => {
                const active = theme === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setThemeMode(value)}
                    className={`flex min-h-10 flex-col items-center justify-center gap-0.5 rounded-[5px] text-xs font-medium transition-colors duration-150 ${
                      active ? "bg-surface text-ink ring-1 ring-border-strong" : "text-ink-2 hover:text-ink"
                    }`}
                  >
                    <Icon size={16} aria-hidden="true" />
                    {label}
                  </button>
                );
              })}
            </div>
          </section>

          <section aria-labelledby="menu-docs">
            <h3 id="menu-docs" className="mb-1 text-xs font-semibold text-ink-3">
              規則與資料
            </h3>
            <ul className="divide-y divide-border">
              {DOCS.map((d) => (
                <li key={d.href}>
                  <a
                    href={d.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-start justify-between gap-3 py-3"
                  >
                    <span>
                      <span className="block text-sm font-medium text-ink group-hover:underline">{d.label}</span>
                      <span className="mt-0.5 block text-xs text-ink-3">{d.note}</span>
                    </span>
                    <ExternalLink size={14} className="mt-1 shrink-0 text-ink-3" aria-label="另開新分頁" />
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <p className="text-xs leading-relaxed text-ink-3">
            研究工具，不構成投資建議。資料每個交易日收盤後更新，不是即時行情。
          </p>
        </div>
      </div>
    </dialog>
  );
}
