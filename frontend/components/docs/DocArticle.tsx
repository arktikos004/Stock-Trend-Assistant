"use client";

/** 文件中心的一篇主題：明體標題、一句摘要、內容，最後是目錄順序裡的上一篇與下一篇。 */

import { ArrowLeft, ArrowRight } from "lucide-react";
import Link from "next/link";
import { TOPICS } from "@/components/docs/topics";
import DocsToc from "@/components/docs/DocsToc";
import { docHref, getDoc, neighbours, type DocSlug } from "@/lib/docs";

export default function DocArticle({ slug }: { slug: DocSlug }) {
  const doc = getDoc(slug);
  const Topic = TOPICS[slug];
  const { prev, next } = neighbours(slug);
  return (
    <div className="grid grid-cols-1 gap-12 xl:grid-cols-[minmax(0,1fr)_11rem]">
      <article className="min-w-0 max-w-[68ch]">
        <header className="mb-10">
          <h1 className="font-serif text-[30px] font-semibold leading-tight text-ink">{doc.title}</h1>
          <p className="mt-3 text-base leading-relaxed text-ink-2">{doc.summary}</p>
        </header>
        <div className="space-y-12">
          <Topic />
        </div>
        <nav aria-label="上一篇與下一篇" className="hairline-t mt-16 grid grid-cols-2 gap-6 pt-6 text-sm">
          {prev ? (
            <Link href={docHref(prev.slug)} className="group">
              <span className="flex items-center gap-1 text-xs text-ink-3">
                <ArrowLeft size={13} aria-hidden="true" />
                上一篇
              </span>
              <span className="mt-1 block font-serif text-base text-ink group-hover:underline">{prev.title}</span>
            </Link>
          ) : (
            <span />
          )}
          {next && (
            <Link href={docHref(next.slug)} className="group text-right">
              <span className="flex items-center justify-end gap-1 text-xs text-ink-3">
                下一篇
                <ArrowRight size={13} aria-hidden="true" />
              </span>
              <span className="mt-1 block font-serif text-base text-ink group-hover:underline">{next.title}</span>
            </Link>
          )}
        </nav>
      </article>
      <DocsToc slug={slug} />
    </div>
  );
}
