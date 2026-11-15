import { describe, expect, it } from "vitest";
import type { ChainInvoice } from "../lib/chain";
import { contractReceipts, parseReceipts, proofsFor } from "../lib/proofs";

const INV = "invoices.nearvoice.testnet";
const USDC = "usdc.nearvoice.testnet";
// The shape NearBlocks v3 returns for accounts/{id}/receipts (trimmed), with invoice #5's real receipts.
const row = (method: string, from: string, ns: string, hash: string, status = true) => ({
  actions: [{ action: "FUNCTION_CALL", method }],
  block: { block_hash: "x", block_height: "1", block_timestamp: ns },
  outcome: { status },
  predecessor_account_id: from,
  receiver_account_id: INV,
  transaction_hash: hash,
});
const page = {
  data: [
    row("ft_on_transfer", USDC, "1794685085123456789", "Cxfx5HVcooUp7MpFJWsiVjTAqSA65yDMug4sD1BbBn3v"),
    row("create_invoice", "ada-okafor.nearvoice.testnet", "1794684100987654321", "5VHS1vEhAAAA"),
    row("create_invoice", "someone.nearvoice.testnet", "1794684100987654321", "WRONGISSUER", true),
    { ...row("ft_on_transfer", USDC, "1794685085123456789", "FAILED", false) },
    { ...row("ft_transfer", "x.testnet", "1", "OTHERCONTRACT"), receiver_account_id: USDC },
  ],
  meta: { next_page: "cursor-2" },
};

const inv = {
  id: 5,
  issuer: "ada-okafor.nearvoice.testnet",
  status: "paid",
  created_ms: 1794684100987,
  paid_ms: 1794685085123,
  closed_ms: null,
} as unknown as ChainInvoice;

describe("NearBlocks v3 receipts", () => {
  it("keeps only the invoice contract's receipts, with millisecond times", () => {
    const { receipts, next } = parseReceipts(page);
    expect(receipts.map((r) => r.hash)).toEqual(["Cxfx5HVcooUp7MpFJWsiVjTAqSA65yDMug4sD1BbBn3v", "5VHS1vEhAAAA", "WRONGISSUER", "FAILED"]);
    expect(receipts[0]!.ms).toBe(1794685085123);
    expect(next).toBe("cursor-2");
  });
  it("matches each status to its transaction by method, caller and millisecond", () => {
    const p = proofsFor(inv, parseReceipts(page).receipts);
    expect(p).toEqual({ created: "5VHS1vEhAAAA", paid: "Cxfx5HVcooUp7MpFJWsiVjTAqSA65yDMug4sD1BbBn3v", closed: undefined });
  });
  it("reads an empty or malformed answer as no receipts", () => {
    expect(parseReceipts({ data: null, errors: [{ message: "Not Found" }] }).receipts).toEqual([]);
    expect(parseReceipts(null).receipts).toEqual([]);
  });
  it("asks v3 with limit and the opaque cursor, and stops on a rate limit", async () => {
    const asked: string[] = [];
    const fake = (async (u: string) => {
      asked.push(u);
      return asked.length === 1 ? new Response(JSON.stringify(page)) : new Response("{}", { status: 429 });
    }) as unknown as typeof fetch;
    const out = await contractReceipts(3, fake);
    expect(asked[0]).toBe(`https://api-testnet.nearblocks.io/v3/accounts/${INV}/receipts?limit=100`);
    expect(asked[1]).toContain("&next=cursor-2");
    expect(asked).toHaveLength(2);
    expect(out).toHaveLength(4);
  });
});
