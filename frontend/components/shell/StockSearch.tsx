"use client";

/**
 * 代號搜尋（combobox）：清單一律來自 /api/stocks（唯一事實來源），前端不內建清單。
 * 輸入代號或名稱過濾，上下鍵選擇、Enter 打開個股頁、Esc 收起。
 */

import { Search } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useMemo, useState } from "react";
import { api } from "@/lib/api";
import { code } from "@/lib/format";
import { useAsync } from "@/lib/useAsync";

const MAX_RESULTS = 8;

export default function StockSearch({
  className = "",
  autoFocus = false,
  onNavigate,
}: {
  className?: string;
  autoFocus?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const listId = useId();
  const stocks = useAsync("stocks", () => api.stocks());
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);

  const results = useMemo(() => {
    const all = stocks.data?.stocks ?? [];
    const q = query.trim().toLowerCase();
    const hits = q ? all.filter((s) => s.ticker.toLowerCase().includes(q) || s.name.toLowerCase().includes(q)) : all;
    return hits.slice(0, MAX_RESULTS);
  }, [stocks.data, query]);

  const go = (ticker: string) => {
    router.push(`/stock?t=${encodeURIComponent(ticker)}`);
    setQuery("");
    setOpen(false);
    onNavigate?.();
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, results.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open && results[active]) {
      e.preventDefault();
      go(results[active].ticker);
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  };

  const showList = open && results.length > 0;
  const showEmpty = open && query.trim() !== "" && results.length === 0 && !stocks.loading;

  return (
    <div className={`relative ${className}`}>
      <Search size={16} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
      <input
        type="search"
        role="combobox"
        aria-label="搜尋台灣 50 成分股"
        aria-expanded={showList}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={showList ? `${listId}-${active}` : undefined}
        autoFocus={autoFocus}
        placeholder="搜尋代號或名稱，如 2330"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        onKeyDown={onKeyDown}
        className="h-9 w-full rounded-md border border-border bg-surface-2 pl-8 pr-3 text-sm text-ink outline-none transition-colors duration-150 placeholder:text-ink-3 focus:border-accent focus:bg-surface"
      />
      {showList && (
        <ul
          id={listId}
          role="listbox"
          aria-label="搜尋結果"
          className="absolute right-0 z-40 mt-1 max-h-80 w-full min-w-56 overflow-auto rounded-md border border-border bg-surface py-1 shadow-(--shadow-pop)"
        >
          {results.map((s, i) => (
            <li
              key={s.ticker}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              // mousedown 而不是 click：搶在 input 失焦收起清單之前
              onMouseDown={(e) => {
                e.preventDefault();
                go(s.ticker);
              }}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-2 text-sm ${
                i === active ? "bg-surface-2 text-ink" : "text-ink-2"
              }`}
            >
              <span className="truncate">{s.name}</span>
              <span className="text-xs text-ink-3">{code(s.ticker)}</span>
            </li>
          ))}
        </ul>
      )}
      {showEmpty && (
        <p className="absolute right-0 z-40 mt-1 w-full min-w-56 rounded-md border border-border bg-surface px-3 py-2 text-xs text-ink-3 shadow-(--shadow-pop)">
          找不到「{query.trim()}」。本站只有台灣 50 成分股的資料。
        </p>
      )}
    </div>
  );
}
