import { z } from "zod";

/** One billed line. Prices are in cents to stay exact. */
export const LineItem = z.object({
  description: z.string().trim().min(1, "Describe the line").max(200),
  quantity: z.number().positive().max(1_000_000),
  unitCents: z.number().int().nonnegative().max(1_000_000_000_00),
});
export type LineItem = z.infer<typeof LineItem>;

/** Everything private about an invoice. Encrypted before it leaves the browser. */
export const InvoiceDetails = z.object({
  v: z.literal(1),
  number: z.string().trim().min(1).max(40),
  from: z.object({ name: z.string().trim().min(1).max(80), email: z.string().trim().max(120).optional() }),
  to: z.object({ name: z.string().trim().min(1).max(80), email: z.string().trim().max(120).optional() }),
  items: z.array(LineItem).min(1, "Add at least one line").max(50),
  notes: z.string().max(1_000).optional(),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  currency: z.literal("USDC"),
});
export type InvoiceDetails = z.infer<typeof InvoiceDetails>;

/** A line's total in cents. Quantities may be fractional (hours); the result rounds half up to the cent. */
export function lineCents(item: LineItem): bigint {
  // Work in thousandths of a unit to keep fractional quantities exact.
  const q = BigInt(Math.round(item.quantity * 1000));
  return (q * BigInt(item.unitCents) + 500n) / 1000n;
}

export function totalCents(details: Pick<InvoiceDetails, "items">): bigint {
  return details.items.reduce((a, i) => a + lineCents(i), 0n);
}

/** Canonical JSON (sorted keys) so the same details always produce the same digest. */
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  const o = value as Record<string, unknown>;
  return `{${Object.keys(o)
    .filter((k) => o[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${canonical(o[k])}`)
    .join(",")}}`;
}
