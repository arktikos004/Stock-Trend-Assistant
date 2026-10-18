import { describe, expect, it } from "vitest";
import { DOC_GROUPS, DOCS, docHref, methodRedirect, neighbours, searchDocs } from "./docs";

// 舊「方法與限制」單頁的段落 id：外部連結與舊截圖還會用到，每一個都要轉到對應的主題頁
const OLD_METHOD_SECTIONS = [
  "reading",
  "rank",
  "model",
  "baselines",
  "tradable",
  "backtest",
  "direction",
  "screener",
  "chips",
  "ledger",
  "market",
  "chart",
  "data",
];

describe("docs registry", () => {
  it("has unique slugs in known groups, each with headings", () => {
    const slugs = DOCS.map((d) => d.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    const groups = new Set(DOC_GROUPS.map((g) => g.key));
    for (const doc of DOCS) {
      expect(groups.has(doc.group)).toBe(true);
      expect(doc.headings.length).toBeGreaterThan(0);
      const ids = doc.headings.map((h) => h.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("lists every group at least once, in group order", () => {
    const order = DOC_GROUPS.map((g) => g.key);
    const seen = DOCS.map((d) => order.indexOf(d.group));
    expect([...seen].sort((a, b) => a - b)).toEqual(seen);
    expect(new Set(seen).size).toBe(order.length);
  });

  it("redirects every old method anchor to its topic page", () => {
    for (const id of OLD_METHOD_SECTIONS) expect(methodRedirect(`#${id}`)).toBe(docHref(id as never));
    expect(methodRedirect("")).toBe("/docs");
    expect(methodRedirect("#no-such-section")).toBe("/docs");
  });

  it("finds topics by title, keyword and heading", () => {
    expect(searchDocs("融資").map((h) => h.doc.slug)).toContain("chips");
    expect(searchDocs("rank ic").map((h) => h.doc.slug)).toContain("model");
    const hit = searchDocs("技能檢定").find((h) => h.doc.slug === "model");
    expect(hit?.heading?.id).toBe("skill");
    expect(searchDocs("   ")).toEqual([]);
  });

  it("links neighbours in reading order", () => {
    expect(neighbours("reading").prev).toBeNull();
    expect(neighbours("reading").next?.slug).toBe("rank");
    expect(neighbours("data").next).toBeNull();
  });
});
