/** Reads from NEAR testnet, moving to the next RPC when one rate-limits. No keys involved. */
import { INVOICES, RPCS, USDC } from "./config";

export interface Split {
  account_id: string;
  bps: number;
}

export interface ChainInvoice {
  id: number;
  issuer: string;
  token: string;
  amount: string;
  due_ms: number;
  splits: Split[];
  status: "open" | "paid" | "cancelled" | "refunded";
  sealed: string;
  digest: string;
  created_ms: number;
  payer: string | null;
  paid_ms: number | null;
  closed_ms: number | null;
}

export interface Profile {
  name: string;
  default_splits: Split[];
  paused: boolean;
  max_invoice: string;
}

export interface Stats {
  invoices: number;
  open: number;
  paid: number;
  cancelled: number;
  refunded: number;
  volume_paid: string;
}

let preferred = 0;

export async function rpc<T>(method: string, params: unknown): Promise<T> {
  let last: unknown;
  for (let i = 0; i < RPCS.length; i++) {
    const idx = (preferred + i) % RPCS.length;
    try {
      const r = await fetch(RPCS[idx]!, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "nv", method, params }) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const out = await r.json();
      if (out.error) throw new Error(JSON.stringify(out.error).slice(0, 160));
      preferred = idx;
      return out.result as T;
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 120 * (i + 1)));
    }
  }
  throw last instanceof Error ? last : new Error(String(last));
}

export async function view<T>(contract: string, method: string, args: Record<string, unknown> = {}): Promise<T> {
  const r = await rpc<{ result: number[]; error?: string }>("query", {
    request_type: "call_function",
    finality: "optimistic",
    account_id: contract,
    method_name: method,
    args_base64: btoa(JSON.stringify(args)),
  });
  if (r.error) throw new Error(r.error);
  return JSON.parse(new TextDecoder().decode(new Uint8Array(r.result))) as T;
}

export const getInvoice = (id: number) => view<ChainInvoice | null>(INVOICES, "get_invoice", { id });
export const listByIssuer = (account_id: string) => view<ChainInvoice[]>(INVOICES, "list_by_issuer", { account_id, limit: 50 });
export const listByPayer = (account_id: string) => view<ChainInvoice[]>(INVOICES, "list_by_payer", { account_id, limit: 50 });
export const listRecent = (limit = 20) => view<ChainInvoice[]>(INVOICES, "list_recent", { limit });
export const getStats = () => view<Stats>(INVOICES, "stats");
export const getProfile = (account_id: string) => view<Profile>(INVOICES, "get_profile", { account_id });
export const usdcBalance = async (account_id: string) => BigInt(await view<string>(USDC, "ft_balance_of", { account_id }));
export const faucetReadyAt = (account_id: string) => view<number>(USDC, "faucet_ready_at", { account_id });

export async function accountExists(id: string): Promise<boolean> {
  try {
    await rpc("query", { request_type: "view_account", finality: "final", account_id: id });
    return true;
  } catch {
    return false;
  }
}
