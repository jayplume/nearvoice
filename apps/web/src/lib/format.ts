import { formatCents, unitsToCents } from "@nearvoice/core";

export const usdc = (units: bigint | string) => formatCents(unitsToCents(typeof units === "string" ? BigInt(units) : units), { symbol: true });
export const date = (ms: number) => new Date(ms).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const isoDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const short = (a: string) => (a.length > 28 ? `${a.slice(0, 12)}…${a.slice(-10)}` : a);
export function ago(ms: number) {
  const s = Math.round((Date.now() - ms) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}
export const STATUS_LABEL = { open: "Awaiting payment", paid: "Paid", cancelled: "Cancelled", refunded: "Refunded" } as const;
