"use client";

import { Check, Copy } from "lucide-react";
import { useState } from "react";

/** 複製一段文字（雜湊、指令）。複製成功後圖示與文字改成「已複製」約 2 秒。 */
export default function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => setCopied(false),
        );
      }}
      aria-label={copied ? `已複製${label}` : `複製${label}`}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors duration-150 hover:bg-surface-2 hover:text-ink"
    >
      {copied ? <Check size={15} aria-hidden="true" /> : <Copy size={15} aria-hidden="true" />}
      <span className="sr-only" aria-live="polite">
        {copied ? "已複製" : ""}
      </span>
    </button>
  );
}
