import type { Metadata } from "next";
import Link from "next/link";
import { DOC_GROUPS, DOCS, docHref } from "@/lib/docs";

export const metadata: Metadata = { title: "文件中心" };

/** 文件中心首頁：一句說明，接著依分組列出每個主題與它的一句話摘要。 */
export default function DocsIndex() {
  return (
    <div className="max-w-[68ch]">
      <h1 className="font-serif text-[30px] font-semibold leading-tight text-ink">文件中心</h1>
      <p className="mt-3 text-base leading-relaxed text-ink-2">網站上每個數字怎麼算、驗證到哪裡、還有什麼沒驗證。各頁數字旁的提示都連到這裡的對應段落。</p>
      <div className="mt-12 space-y-12">
        {DOC_GROUPS.map((g) => (
          <section key={g.key} aria-labelledby={`group-${g.key}`}>
            <h2 id={`group-${g.key}`} className="font-serif text-xl font-semibold text-ink">
              {g.label}
            </h2>
            <ul className="mt-3">
              {DOCS.filter((d) => d.group === g.key).map((d) => (
                <li key={d.slug} className="hairline-b">
                  <Link href={docHref(d.slug)} className="group block py-4">
                    <span className="block text-base font-semibold text-ink group-hover:underline">{d.title}</span>
                    <span className="mt-1 block text-sm leading-relaxed text-ink-2">{d.summary}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
