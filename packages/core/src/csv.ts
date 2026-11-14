/** An accountant-ready CSV: one row per invoice, RFC 4180 quoting, plain ISO dates, amounts in dollars. */
import { formatCents } from "./money.js";

export interface CsvRow {
  number: string;
  client: string;
  issuedOn: string;
  dueOn: string;
  paidOn: string;
  amountCents: bigint;
  currency: string;
  status: string;
  payer: string;
  proof: string;
}

const HEADER = ["Invoice number", "Client", "Issue date", "Due date", "Paid date", "Amount", "Currency", "Status", "Paid by", "Proof (transaction or invoice record)"];

const cell = (v: string) => (/[",\n\r]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

export function toCsv(rows: CsvRow[]): string {
  const lines = [HEADER.map(cell).join(",")];
  for (const r of rows) {
    lines.push(
      [r.number, r.client, r.issuedOn, r.dueOn, r.paidOn, formatCents(r.amountCents).replace(/,/g, ""), r.currency, r.status, r.payer, r.proof].map((v) => cell(String(v))).join(","),
    );
  }
  return `${lines.join("\r\n")}\r\n`;
}
