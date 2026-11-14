import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { type Plugin, defineConfig } from "vite";

const commit = (() => {
  try {
    return execSync("git rev-parse --short HEAD").toString().trim();
  } catch {
    return "dev";
  }
})();

// See src/shims/near-api-js-utils.ts: only the Meteor SDK's `near-api-js` import is redirected.
// The app bundles the shared package from its TypeScript source; Node (the API functions) uses its build.
const CORE = fileURLToPath(new URL("../../packages/core/src/index.ts", import.meta.url));
const SHIM = fileURLToPath(new URL("./src/shims/near-api-js-utils.ts", import.meta.url));
const fromMeteor = (importer?: string) => !!importer && importer.includes("@meteorwallet");

const meteorShim: Plugin = {
  name: "nearvoice:meteor-near-api-js-shim",
  enforce: "pre",
  resolveId(source, importer) {
    if (source === "near-api-js" && fromMeteor(importer)) return SHIM;
    return null;
  },
};

export default defineConfig({
  plugins: [meteorShim, react()],
  resolve: { alias: { "@nearvoice/core": CORE } },
  define: { global: "globalThis", "process.env": "{}", __COMMIT__: JSON.stringify(commit) },
  server: { port: 5176, proxy: { "/api": "http://localhost:3000" } },
  optimizeDeps: {
    esbuildOptions: {
      plugins: [
        {
          name: "nearvoice:meteor-near-api-js-shim",
          setup(build) {
            build.onResolve({ filter: /^near-api-js$/ }, (args) => (fromMeteor(args.importer) ? { path: SHIM } : undefined));
          },
        },
      ],
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
