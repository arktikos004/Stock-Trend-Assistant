import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// 只測 lib/ 的純函式（不渲染元件）；@ 對應專案根目錄，與 tsconfig 的 paths 一致
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: { include: ["lib/**/*.test.ts"] },
});
