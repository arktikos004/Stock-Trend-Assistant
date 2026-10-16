import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getUpDown, setUpDown } from "@/lib/updown";

/** 測試環境是 Node、沒有 DOM：換上最小的 <html>、localStorage 與 window 替身 */
function stubBrowser({ blocked = false } = {}) {
  const attrs = new Map<string, string>();
  const stored = new Map<string, string>();
  vi.stubGlobal("document", {
    documentElement: {
      getAttribute: (name: string) => attrs.get(name) ?? null,
      setAttribute: (name: string, value: string) => void attrs.set(name, value),
    },
  });
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => {
      if (blocked) throw new Error("SecurityError");
      stored.set(key, value);
    },
  });
  vi.stubGlobal("window", new EventTarget());
  return { attrs, stored };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("漲跌顏色", () => {
  it("沒設定過（<html> 沒有 data-updown）是紅漲綠跌", () => {
    stubBrowser();
    expect(getUpDown()).toBe("red-up");
  });

  it("不認得的值一律當紅漲綠跌", () => {
    const { attrs } = stubBrowser();
    for (const value of ["", "GREEN-UP", "green", "1", "null"]) {
      attrs.set("data-updown", value);
      expect(getUpDown()).toBe("red-up");
    }
    attrs.set("data-updown", "green-up");
    expect(getUpDown()).toBe("green-up");
  });

  it("切換時套到 <html data-updown>、存進 localStorage，並通知訂閱者", () => {
    const { attrs, stored } = stubBrowser();
    const onChange = vi.fn();
    window.addEventListener("updownchange", onChange);

    setUpDown("green-up");
    expect(attrs.get("data-updown")).toBe("green-up");
    expect(stored.get("updown")).toBe("green-up");
    expect(getUpDown()).toBe("green-up");

    setUpDown("red-up");
    expect(attrs.get("data-updown")).toBe("red-up");
    expect(stored.get("updown")).toBe("red-up");
    expect(getUpDown()).toBe("red-up");
    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it("存不了（無痕模式等）時不丟例外，這次瀏覽仍然套用", () => {
    const { attrs } = stubBrowser({ blocked: true });
    expect(() => setUpDown("green-up")).not.toThrow();
    expect(attrs.get("data-updown")).toBe("green-up");
    expect(getUpDown()).toBe("green-up");
  });
});

/** globals.css 的規則：選擇器 → 宣告（先去掉註解；@media 裡的規則照樣列出） */
function cssRules(): Map<string, Map<string, string>> {
  const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  const rules = new Map<string, Map<string, string>>();
  for (const [, head, body] of css.matchAll(/([^{}]*)\{([^{}]*)\}/g)) {
    const decls = new Map<string, string>();
    for (const decl of body.split(";")) {
      const i = decl.indexOf(":");
      if (i > 0) decls.set(decl.slice(0, i).trim(), decl.slice(i + 1).trim());
    }
    rules.set(head.split(";").pop()!.trim().replace(/\s+/g, " "), decls);
  }
  return rules;
}

const isUpDown = (name: string) => name.split("-").some((part) => part === "up" || part === "down");
const flip = (name: string) => name.split("-").map((part) => (part === "up" ? "down" : part === "down" ? "up" : part)).join("-");

describe("globals.css 的綠漲紅跌", () => {
  const rules = cssRules();

  it.each([
    [':root, :root[data-theme="dark"]', ':root[data-updown="green-up"]'],
    [':root[data-theme="light"]', ':root[data-theme="light"][data-updown="green-up"]'],
    [':root[data-theme="system"]', ':root[data-theme="system"][data-updown="green-up"]'],
  ])("%s：每個漲跌 token 都對調，其他 token 不動", (theme, swapped) => {
    const base = rules.get(theme);
    const swap = rules.get(swapped);
    expect(base).toBeDefined();
    expect(swap).toBeDefined();
    const names = [...base!.keys()].filter(isUpDown);
    expect(names).toEqual(expect.arrayContaining(["--up", "--down", "--chart-up", "--chart-down"]));
    expect([...swap!.keys()].sort()).toEqual([...names].sort());
    for (const name of names) {
      // 對調的是實際色值：若改成 var(--up) 之類的參照，對調後會再被換一次
      expect(base!.get(name)).not.toMatch(/var\(/);
      expect(swap!.get(name)).toBe(base!.get(flip(name)));
    }
  });

  it("深色的對調寫在深色區塊之後（兩者權重相同，後寫的生效）", () => {
    const order = [...rules.keys()];
    expect(order.indexOf(':root[data-updown="green-up"]')).toBeGreaterThan(order.indexOf(':root, :root[data-theme="dark"]'));
  });
});
