import type { ReactNode } from "react";
import DocsNav from "@/components/docs/DocsNav";

/** 文件中心：左側分組目錄與搜尋（手機收成「目錄」開關），右邊是主題內容。 */
export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="grid grid-cols-1 gap-x-14 pt-4 lg:grid-cols-[13rem_minmax(0,1fr)]">
      <aside className="lg:pt-1">
        <DocsNav />
      </aside>
      <div className="min-w-0">{children}</div>
    </div>
  );
}
