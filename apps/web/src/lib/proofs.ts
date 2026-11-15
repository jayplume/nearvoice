/**
 * Finds the transaction behind each status change of an invoice, so every
 * status links to its proof. The contract records the block timestamp (ms) of
 * creation, payment and closing; NearBlocks lists every receipt the contract
 * executed with its block timestamp (ns) and transaction hash. A receipt
 * matches when its method, caller and millisecond agree with the invoice.
 */
import type { ChainInvoice } from "./chain";
import { INVOICES, USDC } from "./config";

/** NearBlocks API v3 (v1 is switched off on 22 Nov 2026). Keyless: about 8 requests a minute per visitor. */
const API = "https://api-testnet.nearblocks.io/v3";

export interface Receipt {
  method: string;
  from: string;
  ms: number;
  hash: string;
  ok: boolean;
}

/** One page of NearBlocks v3 `accounts/{id}/receipts`, as receipts executed by the invoice contract. */
export function parseReceipts(body: unknown): { receipts: Receipt[]; next?: string } {
  const b = body as { data?: any[] | null; meta?: { next_page?: string | null } | null };
  const rows = Array.isArray(b?.data) ? b.data : [];
  const receipts: Receipt[] = [];
  for (const t of rows) {
    if (t?.receiver_account_id !== INVOICES) continue;
    const ns = String(t.block?.block_timestamp ?? t.included_in_block_timestamp ?? "");
    if (!/^\d+$/.test(ns)) continue;
    receipts.push({
      method: t.actions?.[0]?.method ?? "",
      from: t.predecessor_account_id,
      ms: Math.floor(Number(BigInt(ns) / 1_000_000n)),
      hash: t.transaction_hash,
      ok: t.outcome?.status !== false,
    });
  }
  return { receipts, next: b?.meta?.next_page ?? undefined };
}

/**
 * The contract's most recent receipts (up to `pages` × 100), newest first.
 * A rate-limited or failed page ends the walk with what was read so far.
 */
export async function contractReceipts(pages = 2, fetcher: typeof fetch = fetch): Promise<Receipt[]> {
  const out: Receipt[] = [];
  let next: string | undefined;
  for (let i = 0; i < pages; i++) {
    const url = `${API}/accounts/${INVOICES}/receipts?limit=100${next ? `&next=${encodeURIComponent(next)}` : ""}`;
    let res: Response;
    try {
      res = await fetcher(url);
    } catch {
      break;
    }
    if (!res.ok) break;
    const page = parseReceipts(await res.json());
    out.push(...page.receipts);
    next = page.next;
    if (!next) break;
  }
  return out;
}

export interface InvoiceProofs {
  created?: string;
  paid?: string;
  closed?: string;
}

export function proofsFor(inv: ChainInvoice, receipts: Receipt[]): InvoiceProofs {
  const find = (method: string, from: string | null, ms: number | null) => (ms === null ? undefined : receipts.find((r) => r.ok && r.method === method && (from === null || r.from === from) && r.ms === ms)?.hash);
  return {
    created: find("create_invoice", inv.issuer, inv.created_ms),
    // Payments and refunds arrive as ft_on_transfer from the token contract.
    paid: find("ft_on_transfer", USDC, inv.paid_ms),
    closed: inv.status === "cancelled" ? find("cancel_invoice", inv.issuer, inv.closed_ms) : inv.status === "refunded" ? find("ft_on_transfer", USDC, inv.closed_ms) : undefined,
  };
}
