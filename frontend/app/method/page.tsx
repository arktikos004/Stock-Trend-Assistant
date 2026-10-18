"use client";

/**
 * 舊的「方法與限制」單頁已拆成文件中心（/docs/<主題>）。外部連結與舊截圖還會帶著 /method#段落 進來：
 * 依錨點轉到對應的主題頁（lib/docs.ts 的 methodRedirect），不認得的錨點回文件中心首頁。
 */

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect } from "react";
import { methodRedirect } from "@/lib/docs";

export default function MethodRedirect() {
  const router = useRouter();
  useEffect(() => {
    router.replace(methodRedirect(window.location.hash));
  }, [router]);
  return (
    <p className="py-10 text-sm text-ink-2">
      「方法與限制」已移到
      <Link href="/docs" className="font-medium link">
        文件中心
      </Link>
      ，正在轉過去。
    </p>
  );
}
