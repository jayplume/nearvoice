import { describe, expect, it } from "vitest";
import { relayRefusals, validHandle } from "../src/relay-policy.js";

const C = "invoices.nearvoice.testnet";
const ok = { senderId: "ada.nearvoice.testnet", receiverId: C, actions: [{ kind: "functionCall", methodName: "create_invoice", gas: 50_000_000_000_000n, deposit: 0n }] };

describe("relay policy", () => {
  it("relays a Nearvoice account's call to the invoice contract", () => {
    expect(relayRefusals(ok, C, "nearvoice.testnet")).toEqual([]);
  });
  it("refuses other contracts, outside accounts, transfers, deposits, unknown methods and big gas", () => {
    expect(relayRefusals({ ...ok, receiverId: "usdc.nearvoice.testnet" }, C, "nearvoice.testnet")).toContain(`only calls to ${C} are relayed`);
    expect(relayRefusals({ ...ok, senderId: "mallory.testnet" }, C, "nearvoice.testnet")[0]).toMatch(/only Nearvoice accounts/);
    expect(relayRefusals({ ...ok, actions: [{ kind: "transfer" }] }, C, "nearvoice.testnet")).toContain("transfer actions are not relayed");
    const bad = relayRefusals({ ...ok, actions: [{ kind: "functionCall", methodName: "ft_on_transfer", gas: 300_000_000_000_000n, deposit: 1n }] }, C, "nearvoice.testnet");
    expect(bad).toEqual(["ft_on_transfer is not relayed", "relayed calls cannot attach a deposit", "at most 100 Tgas per relayed call"]);
  });
});

describe("handles", () => {
  it("accepts simple names and refuses reserved or malformed ones", () => {
    expect(validHandle("ada-studio")).toBe(true);
    expect(validHandle("ab")).toBe(false);
    expect(validHandle("Ada")).toBe(false);
    expect(validHandle("ada--x")).toBe(false);
    expect(validHandle("-ada")).toBe(false);
    expect(validHandle("relay")).toBe(false);
  });
});
