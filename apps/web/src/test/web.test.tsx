import type { InvoiceDetails } from "@nearvoice/core";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InvoicePaper } from "../components/invoice";
import { StatusChip } from "../components/parts";
import { splitAmounts } from "../lib/split";
import { shareLink, vaultAll, vaultGet, vaultMerge, vaultPut } from "../lib/vault";

afterEach(cleanup);

const s = (account_id: string, bps: number) => ({ account_id, bps });

describe("splitAmounts matches the contract", () => {
  it("uses the contract's own test vector", () => {
    const parts = splitAmounts(250_000_000n, [s("a.testnet", 8_000), s("tax.testnet", 1_500), s("b.testnet", 500)], "x.testnet");
    expect(parts.map((p) => p.amount)).toEqual([200_000_000n, 37_500_000n, 12_500_000n]);
  });
  it("gives rounding dust to the first recipient and never loses a unit", () => {
    const parts = splitAmounts(1_000_001n, [s("a.testnet", 3_333), s("b.testnet", 3_333), s("c.testnet", 3_334)], "x.testnet");
    expect(parts.reduce((a, p) => a + p.amount, 0n)).toBe(1_000_001n);
    expect(parts[0]!.amount).toBe(333_301n);
  });
  it("pays the issuer everything when there is no split", () => {
    expect(splitAmounts(42n, [], "ada.nearvoice.testnet")).toEqual([{ account_id: "ada.nearvoice.testnet", bps: 10_000, amount: 42n }]);
  });
});

const details: InvoiceDetails = {
  v: 1,
  number: "NV-0007",
  from: { name: "Ada" },
  to: { name: "Lumen Labs" },
  items: [
    { description: "Design", quantity: 2.5, unitCents: 40_000 },
    { description: "QA", quantity: 1, unitCents: 12_345 },
  ],
  issuedOn: "2026-11-14",
  dueOn: "2026-11-28",
  currency: "USDC",
};

describe("InvoicePaper", () => {
  it("shows every line and the exact total", () => {
    render(<InvoicePaper details={details} />);
    expect(screen.getByText("Design")).toBeTruthy();
    expect(screen.getByText("1,000.00")).toBeTruthy();
    expect(screen.getByText("$1,123.45")).toBeTruthy();
    expect(screen.queryByText("PAID")).toBeNull();
  });
  it("is stamped when paid and veiled when sealed", () => {
    render(<InvoicePaper details={details} stamp="paid" stampNote="14 Nov" cipher="abc" />);
    expect(screen.getByText("PAID")).toBeTruthy();
    expect(screen.getByText(/only the link holder can read this/)).toBeTruthy();
  });
});

describe("StatusChip", () => {
  it("names each status in words a client understands", () => {
    render(<StatusChip status="open" />);
    expect(screen.getByText("Awaiting payment")).toBeTruthy();
  });
});

describe("invoice key vault", () => {
  beforeEach(() => localStorage.clear());
  it("keeps keys per invoice and merges a restored backup", () => {
    vaultPut(3, { key: "k3", number: "NV-3", client: "A", issuedOn: "2026-11-01", dueOn: "2026-11-15" });
    vaultMerge({ "9": { key: "k9", number: "NV-9", client: "B", issuedOn: "2026-11-02", dueOn: "2026-11-16" } });
    expect(vaultGet(3)?.key).toBe("k3");
    expect(Object.keys(vaultAll()).sort()).toEqual(["3", "9"]);
  });
  it("puts the key in the fragment, which browsers never send to a server", () => {
    const url = new URL(shareLink(12, "secret"));
    expect(url.pathname).toBe("/i/12");
    expect(url.hash).toBe("#k=secret");
    expect(url.search).toBe("");
  });
});
