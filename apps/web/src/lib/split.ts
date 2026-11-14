import type { Split } from "./chain";

/**
 * The contract's split_amounts, in TypeScript: floor each share, give the
 * remainder to the first recipient, so the parts always sum to the invoice.
 * An empty split means 100% to the issuer. Tested against the contract's own vectors.
 */
export function splitAmounts(amount: bigint, splits: Split[], issuer: string): { account_id: string; bps: number; amount: bigint }[] {
  const list = splits.length ? splits : [{ account_id: issuer, bps: 10_000 }];
  const out = list.map((s) => ({ ...s, amount: (amount * BigInt(s.bps)) / 10_000n }));
  const rest = amount - out.reduce((a, s) => a + s.amount, 0n);
  out[0]!.amount += rest;
  return out;
}
