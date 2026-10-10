import type { Metadata } from "next";

export const metadata: Metadata = { title: "篩選器" };

export default function ScreenerLayout({ children }: { children: React.ReactNode }) {
  return children;
}
