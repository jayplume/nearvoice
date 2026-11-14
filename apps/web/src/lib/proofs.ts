/**
 * Finds the transaction behind each status change of an invoice, so every
 * status links to its proof. The contract records the block timestamp (ms) of
 * creation, payment and closing; NearBlocks lists every receipt the contract
 * executed with its block timestamp (ns) and transaction hash. A receipt
 * matches when its method, caller and millisecond agree with the invoice.
 */
import type { ChainInvoice } from "./chain";
import { INVOICES, USDC } from "./config";

const API = "https://api-testnet.nearblocks.io/v1";

export interface Receipt {
  method: string;
  from: string;
  ms: number;
  hash: string;
  ok: boolean;
}

/** The contract's most recent receipts (up to `pages` × 100), newest first. */
export async function contractReceipts(pages = 3): Promise<Receipt[]> {
  const out: Receipt[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < pages; i++) {
    const url = `${API}/account/${INVOICES}/receipts?per_page=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`;
    const res = await fetch(url);
    if (!res.ok) break;
    const body = await res.json();
    for (const t of body.txns ?? []) {
      if (t.receiver_account_id !== INVOICES) continue;
      out.push({
        method: t.actions?.[0]?.method ?? "",
        from: t.predecessor_account_id,
        ms: Math.floor(Number(BigInt(String(t.block_timestamp)) / 1_000_000n)),
        hash: t.transaction_hash,
        ok: t.receipt_outcome?.status !== false,
      });
    }
    cursor = body.cursor;
    if (!cursor || (body.txns ?? []).length < 100) break;
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
