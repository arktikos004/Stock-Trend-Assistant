"use client";

/**
 * 點開才看到的提醒：數字或標籤旁的小圖示按鈕，按下以原生 popover 顯示一兩句提醒，附連到文件中心對應段落的連結。
 * popover="auto"：Esc、點外面或開另一個提示都會關，關閉後焦點回到按鈕。開啟時依按鈕位置固定定位，下方放不下就放上方；捲動或縮放就關。
 * 沒有給內容時用該主題的一句話摘要（lib/docs.ts）。
 * 提示框只在瀏覽器裡畫，經 portal 放進 body：按鈕常在一段文字（<p>）裡，框內的段落不能巢狀在 <p> 下。
 * 由 popoverTarget 開啟的 popover，鍵盤順序緊接在按鈕之後，不受它在 DOM 裡的位置影響。
 */

import { Info } from "lucide-react";
import Link from "next/link";
import { useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { docHref, getDoc, type DocSlug } from "@/lib/docs";

const WIDTH = 304;
const GAP = 8;
const EDGE = 16;

type ToggleLike = Event & { newState?: string };

const subscribe = () => () => {};
/** 伺服器端與水合時是 false，之後是 true */
const useClient = () => useSyncExternalStore(subscribe, () => true, () => false);

export default function Hint({
  to,
  anchor,
  label,
  children,
  className = "",
}: {
  to: DocSlug;
  anchor?: string;
  /** 螢幕閱讀器念的名稱：「〈label〉的提醒」；預設是主題標題 */
  label?: string;
  children?: ReactNode;
  className?: string;
}) {
  const doc = getDoc(to);
  const id = useId();
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const client = useClient();

  useEffect(() => {
    const el = panel.current;
    const btn = button.current;
    if (!el || !btn) return;
    const close = () => el.hidePopover();
    const place = (measured: boolean) => {
      const r = btn.getBoundingClientRect();
      const w = Math.min(WIDTH, window.innerWidth - 2 * EDGE);
      el.style.width = `${w}px`;
      el.style.left = `${Math.min(Math.max(EDGE, r.left + r.width / 2 - w / 2), window.innerWidth - w - EDGE)}px`;
      const h = measured ? el.offsetHeight : 0;
      const below = r.bottom + GAP;
      const above = r.top - GAP - h;
      el.style.top = `${measured && below + h > window.innerHeight - EDGE && above > EDGE ? above : below}px`;
    };
    const onBefore = (e: Event) => {
      if ((e as ToggleLike).newState === "open") place(false);
    };
    const onToggle = (e: Event) => {
      const isOpen = (e as ToggleLike).newState === "open";
      setOpen(isOpen);
      if (isOpen) {
        place(true);
        window.addEventListener("scroll", close, { capture: true, passive: true });
        window.addEventListener("resize", close);
      } else {
        window.removeEventListener("scroll", close, { capture: true });
        window.removeEventListener("resize", close);
      }
    };
    el.addEventListener("beforetoggle", onBefore);
    el.addEventListener("toggle", onToggle);
    return () => {
      el.removeEventListener("beforetoggle", onBefore);
      el.removeEventListener("toggle", onToggle);
      window.removeEventListener("scroll", close, { capture: true });
      window.removeEventListener("resize", close);
    };
  }, [client]);

  return (
    <>
      <button
        ref={button}
        type="button"
        popoverTarget={id}
        aria-expanded={open}
        aria-label={`${label ?? doc.title}的提醒`}
        className={`-my-1 inline-flex size-6 shrink-0 items-center justify-center rounded-full align-middle text-ink-3 transition-colors duration-150 hover:text-ink aria-expanded:text-accent ${className}`}
      >
        <Info size={14} strokeWidth={1.8} aria-hidden="true" />
      </button>
      {client &&
        createPortal(
          <div
            ref={panel}
            id={id}
            popover="auto"
            className="fixed inset-auto m-0 rounded-[4px] border border-border bg-surface p-4 text-left text-sm leading-relaxed font-normal text-ink-2 shadow-(--shadow-pop)"
          >
            <div className="space-y-2">{children ?? <p>{doc.summary}</p>}</div>
            <Link href={docHref(to, anchor)} className="link mt-3 inline-block font-medium">
              文件：{doc.title}
            </Link>
          </div>,
          document.body,
        )}
    </>
  );
}
