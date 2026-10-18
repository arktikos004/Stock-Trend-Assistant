import type { Metadata, Viewport } from "next";
import { Noto_Serif_TC } from "next/font/google";
import AppShell from "@/components/shell/AppShell";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";
import "./globals.css";

// 標題與股名的明體：建置時自帶字檔（不連 Google），中文字依 unicode-range 分片、用到才下載
const ming = Noto_Serif_TC({ subsets: ["latin"], display: "swap", preload: false, variable: "--font-ming" });

export const metadata: Metadata = {
  title: { default: "台股相對強弱排序與預測存證平台", template: "%s｜台股排序存證" },
  description:
    "台灣 50 成分股的每日相對強弱排序。每筆預測先寫入雜湊鏈存證，到期後公開成績，並依預先聲明的規則監控模型是否失效。研究工具，不構成投資建議。",
};

// 預設是深色「野外版」（與作業系統設定無關），瀏覽器外框跟著用夜空藍
export const viewport: Viewport = {
  themeColor: "#0a1021",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-Hant" data-theme="dark" suppressHydrationWarning className={`h-full antialiased ${ming.variable}`}>
      <head>
        {/* 首次繪製前套用已儲存的主題與漲跌顏色，避免閃爍 */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body className="flex min-h-full flex-col">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
