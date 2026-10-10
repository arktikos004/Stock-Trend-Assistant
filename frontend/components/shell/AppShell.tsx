"use client";

/**
 * 全站外框：桌機是頂列分頁，手機是底部五鈕分頁列（最後一鈕開選單）；兩處同一組頁面。
 * 頂列下方是狀態列（基準日、存證、模型監控），每一頁都看得到；頁尾放全站的授權顯名與免責。
 * 分頁切換走 client-side navigation，外框與狀態列不會重建。
 */

import { Menu, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useRef, useState } from "react";
import { LINKS } from "@/lib/links";
import BrandMark from "./BrandMark";
import MenuDrawer from "./MenuDrawer";
import { isActive, NAV } from "./nav";
import StatusStrip from "./StatusStrip";
import StockSearch from "./StockSearch";

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const menu = useRef<HTMLDialogElement>(null);
  const [searching, setSearching] = useState(false);
  const openMenu = () => menu.current?.showModal();

  return (
    <>
      <a href="#main" className="skip-link">
        跳到主要內容
      </a>

      <header className="sticky top-0 z-30 border-b border-border bg-surface">
        <div className="mx-auto flex h-14 w-full max-w-[1280px] items-center gap-3 px-4 lg:gap-6 lg:px-6">
          <Link href="/" className="flex shrink-0 items-center gap-2 rounded-md text-[15px] font-semibold text-ink">
            <BrandMark />
            <span className="hidden xl:inline">台股相對強弱排序與預測存證平台</span>
            <span className="xl:hidden">台股排序存證</span>
          </Link>

          <nav aria-label="主要頁面" className="hidden h-full md:flex">
            {NAV.map(({ href, label }) => {
              const active = isActive(pathname, href);
              return (
                <Link
                  key={href}
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex h-full items-center px-3 text-sm transition-colors duration-150 ${
                    active
                      ? "font-semibold text-ink after:absolute after:inset-x-3 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent after:shadow-[0_0_10px_var(--accent-glow)]"
                      : "text-ink-2 hover:text-ink"
                  }`}
                >
                  {label}
                </Link>
              );
            })}
          </nav>

          <div className="ml-auto flex items-center gap-1.5">
            <StockSearch className="hidden w-64 sm:block" />
            <button
              type="button"
              onClick={() => setSearching((v) => !v)}
              aria-expanded={searching}
              aria-label={searching ? "收起搜尋" : "搜尋股票"}
              className="flex size-10 items-center justify-center rounded-md text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink sm:hidden"
            >
              {searching ? <X size={19} aria-hidden="true" /> : <Search size={19} aria-hidden="true" />}
            </button>
            <button
              type="button"
              onClick={openMenu}
              aria-haspopup="dialog"
              className="hidden h-9 items-center gap-1.5 rounded-md border border-border px-3 text-sm text-ink-2 transition-colors duration-150 hover:bg-surface-2 hover:text-ink md:flex"
            >
              <Menu size={16} aria-hidden="true" />
              選單
            </button>
          </div>
        </div>
        {searching && (
          <div className="border-t border-border px-4 py-2 sm:hidden">
            <StockSearch autoFocus onNavigate={() => setSearching(false)} />
          </div>
        )}
      </header>

      <StatusStrip />

      <div className="pb-tabbar flex flex-1 flex-col">
        <main id="main" tabIndex={-1} className="mx-auto w-full max-w-[1280px] flex-1 px-4 pt-6 outline-none lg:px-6">
          {children}
        </main>

        <footer className="mx-auto mt-10 w-full max-w-[1280px] px-4 text-xs leading-relaxed text-ink-3 lg:px-6">
          <div className="border-t border-border py-6">
          <p>台股相對強弱排序與預測存證平台：研究工具，不構成投資建議。</p>
          <p className="mt-1">
            K 線資料來自臺灣證券交易所開放資料，依
            <a className="mx-1 underline hover:text-ink" href={LINKS.openDataLicense} target="_blank" rel="noopener noreferrer">
              政府資料開放授權條款
            </a>
            利用；模型訓練用的歷史價格只在內部研究使用，不對外提供。圖表：
            <a className="ml-1 underline hover:text-ink" href={LINKS.tradingView} target="_blank" rel="noopener noreferrer">
              TradingView Lightweight Charts™
            </a>
            。
          </p>
          <p className="mt-1">
            <a className="underline hover:text-ink" href={LINKS.dataSources} target="_blank" rel="noopener noreferrer">
              資料來源與授權
            </a>
            <span className="mx-2" aria-hidden="true">
              |
            </span>
            <a className="underline hover:text-ink" href={LINKS.repo} target="_blank" rel="noopener noreferrer">
              原始碼
            </a>
          </p>
          </div>
        </footer>
      </div>

      <nav
        aria-label="主要頁面"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="grid h-16 grid-cols-5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = isActive(pathname, href);
            return (
              <li key={href} className="flex">
                <Link
                  href={href}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-1 flex-col items-center justify-center gap-1 text-xs transition-colors duration-150 ${
                    active ? "font-semibold text-accent" : "text-ink-2"
                  }`}
                >
                  <Icon
                    size={20}
                    strokeWidth={active ? 2.2 : 1.8}
                    className={active ? "drop-shadow-[0_0_6px_var(--accent-glow)]" : undefined}
                    aria-hidden="true"
                  />
                  {label}
                </Link>
              </li>
            );
          })}
          <li className="flex">
            <button
              type="button"
              onClick={openMenu}
              aria-haspopup="dialog"
              className="flex flex-1 flex-col items-center justify-center gap-1 text-xs text-ink-2"
            >
              <Menu size={20} strokeWidth={1.8} aria-hidden="true" />
              選單
            </button>
          </li>
        </ul>
      </nav>

      <MenuDrawer ref={menu} />
    </>
  );
}
