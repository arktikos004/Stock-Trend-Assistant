"use client";

import { RotateCcw } from "lucide-react";
import { useState } from "react";

/**
 * 查詢日期：只能選靜態站保留的範圍（最近 60 個交易日）；留空＝最新收盤。
 * 非交易日會對齊到之前最近的交易日（由 api 處理）。
 */
export default function DateQuery({
  value,
  sessions,
  onChange,
}: {
  value: string | null;
  sessions: string[] | null;
  onChange: (date: string | null) => void;
}) {
  const [draft, setDraft] = useState(value ?? "");
  const min = sessions?.[0];
  const max = sessions?.[sessions.length - 1];
  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        onChange(draft || null);
      }}
    >
      <label className="flex flex-col gap-1 text-xs text-ink-3">
        查詢日期（留空＝最新收盤）
        <input
          type="date"
          value={draft}
          min={min}
          max={max}
          onChange={(e) => setDraft(e.target.value)}
          className="h-9 rounded-md border border-border bg-surface px-2 text-sm text-ink focus:border-accent"
        />
      </label>
      <button type="submit" className="h-9 rounded-md bg-accent px-4 text-sm font-semibold text-accent-fg transition-colors duration-150 hover:bg-accent-hover">
        查詢
      </button>
      {value && (
        <button
          type="button"
          onClick={() => {
            setDraft("");
            onChange(null);
          }}
          className="inline-flex h-9 items-center gap-1 px-2 text-sm text-accent hover:underline"
        >
          <RotateCcw size={14} aria-hidden="true" />
          回到最新收盤
        </button>
      )}
      {min && <span className="text-xs text-ink-3">可查 {min} 至 {max}</span>}
    </form>
  );
}
