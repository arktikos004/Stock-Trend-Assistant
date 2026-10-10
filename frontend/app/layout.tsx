import type { Metadata, Viewport } from "next";
import AppShell from "@/components/shell/AppShell";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "台股相對強弱排序與預測存證平台", template: "%s｜台股排序存證" },
  description:
    "台灣 50 成分股的每日相對強弱排序。每筆預測先寫入雜湊鏈存證，到期後公開成績，並依預先聲明的規則監控模型是否失效。研究工具，不構成投資建議。",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f5f6f8" },
    { media: "(prefers-color-scheme: dark)", color: "#0e1116" },
  ],
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant" data-theme="light" suppressHydrationWarning className="h-full antialiased">
      <head>
        {/* 首次繪製前套用已儲存的主題，避免深淺閃爍 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
