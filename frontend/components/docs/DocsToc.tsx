"use client";

/**
 * 文件中心的右側「本頁內容」：這個主題的段落；捲到哪一段，那一段就用琥珀標記（IntersectionObserver）。
 * 只在寬螢幕顯示；手機上段落標題本身就是錨點。
 */

import { useEffect, useState } from "react";
import { getDoc, type DocSlug } from "@/lib/docs";

export default function DocsToc({ slug }: { slug: DocSlug }) {
  const { headings } = getDoc(slug);
  const [active, setActive] = useState<string | null>(headings[0]?.id ?? null);

  useEffect(() => {
    const sections = headings.map((h) => document.getElementById(h.id)).filter((el): el is HTMLElement => el !== null);
    if (sections.length === 0) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        if (visible[0]) setActive(visible[0].target.id);
      },
      { rootMargin: "-80px 0px -60% 0px" },
    );
    sections.forEach((s) => observer.observe(s));
    return () => observer.disconnect();
  }, [headings]);

  return (
    <nav aria-label="本頁內容" className="sticky top-20 hidden self-start xl:block">
      <p className="mb-2 text-xs text-ink-3">本頁內容</p>
      <ul className="hairline-l space-y-0.5">
        {headings.map((h) => {
          const on = h.id === active;
          return (
            <li key={h.id}>
              <a
                href={`#${h.id}`}
                aria-current={on ? "location" : undefined}
                className={`-ml-px block border-l py-1 pl-3 text-[13px] leading-snug transition-colors duration-150 ${
                  on ? "border-accent-mark text-ink" : "border-transparent text-ink-3 hover:text-ink"
                }`}
              >
                {h.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
