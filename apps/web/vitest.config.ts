import { defineConfig } from "vitest/config";

export default defineConfig({
  define: { __COMMIT__: JSON.stringify("test") },
  test: { environment: "jsdom", include: ["src/test/**/*.test.{ts,tsx}"] },
});
