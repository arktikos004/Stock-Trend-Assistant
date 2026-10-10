"use client";

import { useEffect, useEffectEvent, useState } from "react";
import { ApiError } from "@/lib/api";

/**
 * 依 key 載入一次資料；key 改變就重新載入，key 為 null 時不載入。
 * setState 只在非同步回呼裡發生，切換 key 時舊請求的結果會被丟掉。
 */
export function useAsync<T>(key: string | null, load: () => Promise<T>) {
  const [state, setState] = useState<{ key: string | null; data?: T; error?: unknown }>({ key: null });
  const run = useEffectEvent(load);

  useEffect(() => {
    if (key === null) return;
    let cancelled = false;
    run().then(
      (data) => {
        if (!cancelled) setState({ key, data });
      },
      (error: unknown) => {
        if (!cancelled) setState({ key, error });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [key]);

  const settled = key !== null && state.key === key;
  return {
    data: settled ? state.data : undefined,
    error: settled ? state.error : undefined,
    loading: key !== null && !settled,
  };
}

/**
 * 錯誤說明：404 代表「這一份還沒產生」（新功能上線後要等下一次每日排程），其餘照後端訊息。
 */
export function errorText(error: unknown, notYet: string): string {
  if (error instanceof ApiError && error.status === 404) return notYet;
  if (error instanceof ApiError) return error.message;
  return "讀取失敗。重新整理頁面再試一次。";
}
