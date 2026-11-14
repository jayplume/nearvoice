/**
 * Serves the Vercel functions in /api on http://localhost:3000 for local
 * development, so `pnpm dev` works without the Vercel CLI. Each request is
 * turned into a Web Request and handed to the same POST(req) export Vercel calls.
 *   RELAYER_KEY=... NEARAI_API_KEY=... pnpm dev:api
 */
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir } from "node:os";

// Local convenience: secrets from .env, and the relayer key from the NEAR CLI's credentials folder.
if (existsSync(".env")) process.loadEnvFile(".env");
const cred = `${homedir()}/.near-credentials/testnet/${process.env.RELAYER_ACCOUNT ?? "nearvoice.testnet"}.json`;
if (!process.env.RELAYER_KEY && existsSync(cred)) process.env.RELAYER_KEY = JSON.parse(readFileSync(cred, "utf8")).private_key;

type Load = () => Promise<{ POST: (r: Request) => Promise<Response> }>;
const routes: Partial<Record<string, Load>> = {
  "/api/relay": () => import("../api/relay.js"),
  "/api/onboard": () => import("../api/onboard.js"),
  "/api/ai": () => import("../api/ai.js"),
  "/api/attest": () => import("../api/attest.js"),
};

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost:3000");
  const load = routes[url.pathname];
  if (!load || req.method !== "POST") {
    res.writeHead(load ? 405 : 404, { "Content-Type": "application/json" }).end(JSON.stringify({ error: load ? "POST only" : "no such route" }));
    return;
  }
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
  headers.set("x-forwarded-for", req.socket.remoteAddress ?? "local");
  const started = Date.now();
  const out = await (await load()).POST(new Request(url, { method: "POST", headers, body: Buffer.concat(chunks) }));
  const outHeaders: Record<string, string> = {};
  out.headers.forEach((v, k) => {
    outHeaders[k] = v;
  });
  res.writeHead(out.status, outHeaders);
  res.end(Buffer.from(await out.arrayBuffer()));
  console.log(`${out.status} ${url.pathname} ${Date.now() - started} ms`);
}).listen(3000, () => console.log("Nearvoice API on http://localhost:3000"));
