import type { Metadata } from "next";
import { notFound } from "next/navigation";
import DocArticle from "@/components/docs/DocArticle";
import { DOCS, getDoc, isDocSlug } from "@/lib/docs";

// 靜態站：每個主題在建置時產生一頁，沒有列在目錄裡的網址一律 404
export const dynamicParams = false;

export function generateStaticParams() {
  return DOCS.map((d) => ({ slug: d.slug }));
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params;
  return isDocSlug(slug) ? { title: getDoc(slug).title, description: getDoc(slug).summary } : {};
}

export default async function DocPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  if (!isDocSlug(slug)) notFound();
  return <DocArticle slug={slug} />;
}
