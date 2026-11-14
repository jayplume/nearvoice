import { readFileSync } from "node:fs";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex } from "@noble/hashes/utils";
import { describe, expect, it } from "vitest";
import {
  type InvoiceDetails,
  canonical,
  centsToUnits,
  checkReport,
  formatCents,
  lineCents,
  open,
  parseCents,
  quotePayment,
  PAY_FROM,
  recoverAddress,
  seal,
  sha256Hex,
  tdxReportData,
  toCsv,
  totalCents,
  verifyResponse,
} from "../src/index.js";

const details: InvoiceDetails = {
  v: 1,
  number: "NV-0001",
  from: { name: "Ada Studio" },
  to: { name: "Acme, Inc.", email: "ap@acme.test" },
  items: [
    { description: "Logo design", quantity: 3, unitCents: 40_000 },
    { description: "Rush fee", quantity: 1, unitCents: 15_000 },
    { description: "Revisions", quantity: 1.5, unitCents: 6_667 },
  ],
  issuedOn: "2026-11-14",
  dueOn: "2026-12-01",
  currency: "USDC",
};

describe("money", () => {
  it("parses and formats cents exactly", () => {
    expect(parseCents("$1,250.5")).toBe(125_050n);
    expect(parseCents("0.07")).toBe(7n);
    expect(formatCents(125_050n, { symbol: true })).toBe("$1,250.50");
    expect(centsToUnits(125_050n)).toBe(1_250_500_000n);
    expect(() => parseCents("12.345")).toThrow();
  });
  it("totals lines with fractional quantities to the cent", () => {
    expect(lineCents({ description: "x", quantity: 1.5, unitCents: 6_667 })).toBe(10_001n);
    expect(totalCents(details)).toBe(120_000n + 15_000n + 10_001n);
  });
});

describe("sealing", () => {
  it("round-trips and proves the copy matches the chain", async () => {
    const s = await seal(details);
    expect(s.digest).toBe(await sha256Hex(canonical(details)));
    const o = await open(s.sealed, s.key, s.digest);
    expect(o.details).toEqual(details);
    expect(o.matchesChain).toBe(true);
  });
  it("says so when the chain digest does not match", async () => {
    const s = await seal(details);
    expect((await open(s.sealed, s.key, "0".repeat(64))).matchesChain).toBe(false);
  });
  it("refuses a wrong key or tampered ciphertext", async () => {
    const s = await seal(details);
    const other = await seal(details);
    await expect(open(s.sealed, other.key, s.digest)).rejects.toThrow();
    const tampered = `${s.sealed.slice(0, -2)}${s.sealed.endsWith("A") ? "B" : "A"}A`;
    await expect(open(tampered, s.key, s.digest)).rejects.toThrow();
  });
  it("encrypts: the sealed text does not contain the client's name", async () => {
    expect((await seal(details)).sealed).not.toContain("Acme");
  });
});

describe("csv", () => {
  it("quotes commas and quotes, uses CRLF and plain dollar amounts", () => {
    const csv = toCsv([
      { number: "NV-1", client: 'Acme, "the" Inc.', issuedOn: "2026-11-14", dueOn: "2026-12-01", paidOn: "", amountCents: 125_050n, currency: "USDC", status: "open", payer: "", proof: "x" },
    ]);
    const [, row] = csv.split("\r\n");
    expect(row).toBe('NV-1,"Acme, ""the"" Inc.",2026-11-14,2026-12-01,,1250.50,USDC,open,,x');
  });
});

describe("attestation (real report from NEAR AI Cloud)", () => {
  const fx = JSON.parse(readFileSync(new URL("./fixtures/report.json", import.meta.url), "utf8"));
  it("passes every local check with the nonce we sent", () => {
    const checks = checkReport(fx.report, fx.nonce, fx.model);
    expect(checks.filter((c) => !c.ok)).toEqual([]);
    expect(checks.length).toBeGreaterThan(10);
  });
  it("fails freshness with any other nonce", () => {
    const checks = checkReport(fx.report, "ab".repeat(32), fx.model);
    expect(checks.find((c) => c.label === "Gateway: fresh nonce")?.ok).toBe(false);
  });
  it("reads report_data out of the raw TDX quote", () => {
    expect(tdxReportData(fx.report.gateway_attestation.intel_quote)).toBe(fx.report.gateway_attestation.report_data);
  });
});

describe("response signatures", () => {
  const priv = secp256k1.utils.randomPrivateKey();
  const address = `0x${bytesToHex(keccak_256(secp256k1.getPublicKey(priv, false).slice(1)).slice(-20))}`;
  const sign = (msg: string) => {
    const enc = new TextEncoder();
    const m = enc.encode(msg);
    const p = enc.encode(`\x19Ethereum Signed Message:\n${m.length}`);
    const full = new Uint8Array(p.length + m.length);
    full.set(p);
    full.set(m, p.length);
    const sig = secp256k1.sign(keccak_256(full), priv);
    return `0x${sig.toCompactHex()}${(sig.recovery + 27).toString(16)}`;
  };
  it("recovers the signer of a personal_sign message", () => {
    expect(recoverAddress("hello", sign("hello")).toLowerCase()).toBe(address.toLowerCase());
  });
  it("accepts a response whose hashes and signer match, and rejects an edited one", async () => {
    const requestBody = '{"model":"m","messages":[]}';
    const responseText = '{"choices":[]}';
    const signedText = `m:${await sha256Hex(requestBody)}:${await sha256Hex(responseText)}`;
    const good = await verifyResponse({ requestBody, responseText, signedText, signature: sign(signedText), model: "m", allowedSigners: [address] });
    expect(good.ok).toBe(true);
    const bad = await verifyResponse({ requestBody, responseText: `${responseText} `, signedText, signature: sign(signedText), model: "m", allowedSigners: [address] });
    expect(bad.responseHashMatch).toBe(false);
    expect(bad.ok).toBe(false);
  });
});

describe("1Click quote", () => {
  it("asks for an exact USDC output on NEAR and reads the quote", async () => {
    let sent: any;
    const fake = async (_u: string, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ quote: { amountIn: "252580276", amountInFormatted: "252.580276", amountInUsd: "252.49", amountOut: "250000000", amountOutUsd: "249.91", timeEstimate: 35 } }));
    };
    const q = await quotePayment(PAY_FROM[0]!, 250_000_000n, "ada.near", fake);
    expect(sent).toMatchObject({ dry: true, swapType: "EXACT_OUTPUT", amount: "250000000", recipient: "ada.near", refundTo: "ada.near", refundType: "INTENTS" });
    expect(q.amountOut).toBe(250_000_000n);
    expect(q.feeUsd).toBe(2.58);
  });
});
