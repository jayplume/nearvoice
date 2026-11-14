/**
 * Creates and initialises the Nearvoice testnet contracts (idempotent per account):
 *   usdc.nearvoice.testnet      test USDC with a faucet
 *   invoices.nearvoice.testnet  the invoice contract, accepting that USDC
 *   relay.nearvoice.testnet     the meta-transaction relayer's account (no code)
 *
 *   pnpm deploy:contracts
 */
import { readFileSync } from "node:fs";
import { NEAR, createAccount, send, txUrl } from "./lib/near.js";

const PARENT = "nearvoice.testnet";
const wasm = (name: string) => new Uint8Array(readFileSync(new URL(`../contracts/target/near/${name}/${name}.wasm`, import.meta.url)));

const exists = async (id: string) =>
  !!(
    await fetch("https://near-testnet.drpc.org", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: id } }),
    }).then((r) => r.json())
  ).result;

const steps: [string, () => Promise<{ hash: string; ok: boolean; failure?: string }>][] = [
  [`usdc.${PARENT}`, () => createAccount(PARENT, `usdc.${PARENT}`, NEAR(2.5), wasm("nearvoice_usdc"), { method: "new", args: {} })],
  [`invoices.${PARENT}`, () => createAccount(PARENT, `invoices.${PARENT}`, NEAR(4), wasm("nearvoice_invoices"), { method: "new", args: { tokens: [`usdc.${PARENT}`] } })],
  [`relay.${PARENT}`, () => createAccount(PARENT, `relay.${PARENT}`, NEAR(1))],
];
for (const [id, run] of steps) {
  if (await exists(id)) {
    console.log(`exists   ${id}`);
    continue;
  }
  const s = await run();
  console.log(`${s.ok ? "created " : "FAILED  "} ${id} ${s.failure ?? ""}\n         ${txUrl(s.hash)}`);
}
void send;
