import type { Metadata } from "next";

export const metadata: Metadata = { title: "監控" };

export default function MonitorLayout({ children }: { children: React.ReactNode }) {
  return children;
}
