/** Server-side configuration. Secrets come only from the environment; nothing is stored between requests. */
export const NETWORK_RPCS = ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org"];
export const INVOICES = process.env.INVOICES_CONTRACT ?? "invoices.nearvoice.testnet";
export const ACCOUNT_SUFFIX = process.env.ACCOUNT_SUFFIX ?? "nearvoice.testnet";
export const RELAYER = process.env.RELAYER_ACCOUNT ?? "nearvoice.testnet";

export function secret(name: "RELAYER_KEY" | "NEARAI_API_KEY"): string {
  const v = process.env[name];
  if (!v) throw new HttpError(503, `${name} is not configured on this deployment`);
  return v;
}

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body, (_k, v) => (typeof v === "bigint" ? v.toString() : v)), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" },
  });

/** Runs a handler and turns thrown HttpErrors into JSON responses. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

/** Best-effort per-instance rate limit (serverless instances do not share memory; the chain is the real limit). */
const hits = new Map<string, number[]>();
export function rateLimit(key: string, max: number, windowMs: number) {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) throw new HttpError(429, "Too many requests, try again in a few minutes");
  list.push(now);
  hits.set(key, list);
}
