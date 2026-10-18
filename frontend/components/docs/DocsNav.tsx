"use client";

/**
 * 文件中心的左側目錄：頂部搜尋，下面依分組列出每個主題；目前所在的主題用琥珀標記。
 * 手機上收成頁首一個「目錄」開關（原生 <details>），點開才看到搜尋與完整目錄。
 */

import { ChevronDown, Search } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useState } from "react";
import { DOC_GROUPS, DOCS, docHref, getDoc, isDocSlug, searchDocs } from "@/lib/docs";

function current(pathname: string) {
  const slug = pathname.replace(/\/+$/, "").split("/")[2] ?? "";
  return isDocSlug(slug) ? slug : null;
}

function DocsSearch() {
  const [q, setQ] = useState("");
  const hits = searchDocs(q);
  const id = useId();
  return (
    <div role="search" className="relative">
      <label htmlFor={id} className="sr-only">
        搜尋文件
      </label>
      <Search size={15} aria-hidden="true" className="pointer-events-none absolute top-1/2 left-0 -translate-y-1/2 text-ink-3" />
      <input
        id={id}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="搜尋文件，例如 Rank IC"
        className="hairline-b h-10 w-full bg-transparent pl-6 text-sm text-ink placeholder:text-ink-3 focus:border-b-accent-mark focus:outline-none"
      />
      {q.trim() && (
        <ul aria-label="搜尋結果" className="mt-2 space-y-0.5">
          {hits.length === 0 ? (
            <li className="py-1.5 text-sm text-ink-3">找不到「{q.trim()}」</li>
          ) : (
            hits.map(({ doc, heading }) => (
              <li key={doc.slug}>
                <Link href={docHref(doc.slug, heading?.id)} onClick={() => setQ("")} className="block rounded-[3px] px-2 py-1.5 text-sm text-ink hover:bg-surface-2">
                  {doc.title}
                  {heading && <span className="ml-1.5 text-xs text-ink-3">· {heading.label}</span>}
                </Link>
              </li>
            ))
          )}
        </ul>
      )}
    </div>
  );
}

function Groups({ active }: { active: string | null }) {
  return (
    <nav aria-label="文件目錄" className="space-y-6">
      {DOC_GROUPS.map((g) => (
        <div key={g.key}>
          <p className="mb-1.5 text-xs text-ink-3">{g.label}</p>
          <ul className="space-y-0.5">
            {DOCS.filter((d) => d.group === g.key).map((d) => {
              const on = d.slug === active;
              return (
                <li key={d.slug}>
                  <Link
                    href={docHref(d.slug)}
                    aria-current={on ? "page" : undefined}
                    className={`relative block py-1 pl-3 text-sm transition-colors duration-150 ${
                      on
                        ? "font-semibold text-ink before:absolute before:top-1/2 before:left-0 before:size-1.5 before:-translate-y-1/2 before:rounded-full before:bg-accent-mark"
                        : "text-ink-2 hover:text-ink"
                    }`}
                  >
                    {d.title}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

export default function DocsNav() {
  const active = current(usePathname());
  return (
    <>
      <details className="group hairline-b mb-6 lg:hidden">
        <summary className="flex cursor-pointer list-none items-center justify-between py-3 text-sm text-ink [&::-webkit-details-marker]:hidden">
          <span>
            <span className="text-ink-3">目錄</span>
            {active && <span className="ml-2 font-semibold">{getDoc(active).title}</span>}
          </span>
          <ChevronDown size={16} aria-hidden="true" className="text-ink-3 transition-transform duration-150 group-open:rotate-180" />
        </summary>
        <div className="space-y-6 pb-6">
          <DocsSearch />
          <Groups active={active} />
        </div>
      </details>
      <div className="sticky top-20 hidden max-h-[calc(100dvh-6rem)] space-y-7 overflow-y-auto pb-8 lg:block">
        <DocsSearch />
        <Groups active={active} />
      </div>
    </>
  );
}
