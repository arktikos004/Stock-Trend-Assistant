import { runInNewContext } from "node:vm";
import { describe, expect, it } from "vitest";
import { THEME_BOOT_SCRIPT } from "@/lib/theme-boot";

/** 在沒有 DOM 的沙盒裡執行開機腳本，回傳它設在 <html> 上的屬性 */
function boot(storage: Record<string, string> | "blocked" | "missing") {
  const attrs: Record<string, string> = {};
  const sandbox: Record<string, unknown> = {
    document: { documentElement: { setAttribute: (name: string, value: string) => void (attrs[name] = value) } },
  };
  if (storage === "blocked") {
    // 封鎖網站資料時，連讀 localStorage 這個屬性都會丟例外
    Object.defineProperty(sandbox, "localStorage", {
      get() {
        throw new Error("SecurityError");
      },
    });
  } else if (storage !== "missing") {
    sandbox.localStorage = { getItem: (key: string) => storage[key] ?? null };
  }
  runInNewContext(THEME_BOOT_SCRIPT, sandbox);
  return attrs;
}

const DEFAULTS = { "data-theme": "dark", "data-updown": "red-up" };

describe("THEME_BOOT_SCRIPT", () => {
  it("沒存過：深色、紅漲綠跌", () => {
    expect(boot({})).toEqual(DEFAULTS);
  });

  it("套用存過的主題與漲跌顏色", () => {
    expect(boot({ theme: "light", updown: "green-up" })).toEqual({ "data-theme": "light", "data-updown": "green-up" });
    expect(boot({ theme: "system", updown: "red-up" })).toEqual({ "data-theme": "system", "data-updown": "red-up" });
  });

  it("不認得的值改用預設", () => {
    expect(boot({ theme: "blue", updown: "GREEN-UP" })).toEqual(DEFAULTS);
  });

  it("localStorage 不能用時不丟例外，照樣套用預設", () => {
    expect(boot("blocked")).toEqual(DEFAULTS);
    expect(boot("missing")).toEqual(DEFAULTS);
  });
});
