import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __COMMIT__: JSON.stringify("test") },
  resolve: { alias: { "@nearvoice/core": fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url)) } },
  test: { environment: "jsdom", include: ["src/test/**/*.test.{ts,tsx}"] },
});
