/**
 * One full paid-invoice flow on testnet, from the command line:
 * a freelancer account is created, issues a sealed invoice with an 85/15 split,
 * a client takes test USDC from the faucet and pays it, and the split arrives.
 *
 *   pnpm e2e
 */
import { type InvoiceDetails, centsToUnits, open, seal, totalCents } from "@nearvoice/core";
import { NEAR, call, createAccount, txUrl } from "./lib/near.js";

const INVOICES = "invoices.nearvoice.testnet";
const USDC = "usdc.nearvoice.testnet";
const FREELANCER = `e2e-${Date.now().toString(36)}.nearvoice.testnet`;
const TAX = "nearvoice-ops.testnet";
const CLIENT = "nearvoice-ops.testnet";

const view = async <T>(contract: string, method: string, args: object): Promise<T> => {
  const r = await fetch("https://near-testnet.drpc.org", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "call_function", finality: "optimistic", account_id: contract, method_name: method, args_base64: Buffer.from(JSON.stringify(args)).toString("base64") } }),
  }).then((x) => x.json());
  return JSON.parse(Buffer.from(r.result.result).toString());
};
const step = (label: string, s: { ok: boolean; hash: string; failure?: string }) => {
  console.log(`${s.ok ? "ok  " : "FAIL"} ${label}\n     ${txUrl(s.hash)}${s.failure ? `\n     ${s.failure}` : ""}`);
  if (!s.ok) process.exit(1);
};

step(`create freelancer ${FREELANCER}`, await createAccount("nearvoice.testnet", FREELANCER, NEAR(0.05)));

const details: InvoiceDetails = {
  v: 1,
  number: "NV-E2E-1",
  from: { name: "E2E Studio" },
  to: { name: "Acme, Inc." },
  items: [{ description: "Smoke test", quantity: 2, unitCents: 1_250 }],
  issuedOn: new Date().toISOString().slice(0, 10),
  dueOn: new Date(Date.now() + 7 * 86_400_000).toISOString().slice(0, 10),
  currency: "USDC",
};
const s = await seal(details);
const units = centsToUnits(totalCents(details));
const created = await call(FREELANCER, INVOICES, "create_invoice", {
  token: USDC,
  amount: units.toString(),
  due_ms: Date.now() + 7 * 86_400_000,
  splits: [
    { account_id: FREELANCER, bps: 8_500 },
    { account_id: TAX, bps: 1_500 },
  ],
  sealed: s.sealed,
  digest: s.digest,
});
step(`create invoice for ${units} units`, created);
const id = created.value as number;

const inv = await view<{ sealed: string; digest: string; status: string }>(INVOICES, "get_invoice", { id });
const opened = await open(inv.sealed, s.key, inv.digest);
console.log(`     decrypted from chain: ${opened.details.to.name}, matches chain digest: ${opened.matchesChain}`);

const faucet = await call(CLIENT, USDC, "faucet", {}).catch(() => null);
if (faucet?.ok) step("client takes test USDC", faucet);
step(
  `client pays invoice ${id}`,
  await call(CLIENT, USDC, "ft_transfer_call", { receiver_id: INVOICES, amount: units.toString(), msg: JSON.stringify({ pay: id }) }, 1n, 100_000_000_000_000n),
);
await new Promise((r) => setTimeout(r, 4000));
const after = await view<{ status: string; payer: string }>(INVOICES, "get_invoice", { id });
const fl = await view<string>(USDC, "ft_balance_of", { account_id: FREELANCER });
console.log(`     status ${after.status}, paid by ${after.payer}; freelancer received ${Number(fl) / 1e6} tUSDC (85% of ${Number(units) / 1e6})`);
