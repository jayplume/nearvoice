/**
 * Money in Nearvoice is kept in whole cents in the UI and in token units on
 * chain. USDC has 6 decimals, so 1 cent = 10,000 units. All conversions are
 * integer arithmetic: no floating-point rounding ever touches an amount.
 */
export const USDC_DECIMALS = 6;
export const UNITS_PER_CENT = 10_000n;

export const centsToUnits = (cents: bigint): bigint => cents * UNITS_PER_CENT;
export const unitsToCents = (units: bigint): bigint => units / UNITS_PER_CENT;

/** "1,250.50" from 125050 cents. */
export function formatCents(cents: bigint, opts: { symbol?: boolean } = {}): string {
  const neg = cents < 0n;
  const a = neg ? -cents : cents;
  const whole = (a / 100n).toLocaleString("en-US");
  const frac = (a % 100n).toString().padStart(2, "0");
  return `${neg ? "−" : ""}${opts.symbol ? "$" : ""}${whole}.${frac}`;
}

/** Parses "1,250.5", "$1250.50" or "1250" into cents; throws on anything else. */
export function parseCents(input: string): bigint {
  const s = input.replace(/[$,\s]/g, "");
  if (!/^\d+(\.\d{1,2})?$/.test(s)) throw new Error(`"${input}" is not an amount in dollars and cents`);
  const [w, f = ""] = s.split(".");
  return BigInt(w!) * 100n + BigInt(f.padEnd(2, "0"));
}
