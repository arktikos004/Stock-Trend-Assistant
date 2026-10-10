import type { Metadata } from "next";

export const metadata: Metadata = { title: "個股" };

export default function StockLayout({ children }: { children: React.ReactNode }) {
  return children;
}
