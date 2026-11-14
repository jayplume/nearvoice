/**
 * Calls the four server functions in-process against testnet and NEAR AI:
 * onboard → relayed create_invoice → private AI with signature check → attestation verdicts.
 * Needs RELAYER_KEY and NEARAI_API_KEY in the environment (loaded from .env and the keychain by the caller).
 */
import { PRIVATE_MODEL, checkReport, fetchReport, newNonce, seal, verifyResponse } from "@nearvoice/core";
import { Account, KeyPair, actions } from "near-api-js";
import { POST as ai } from "../api/ai.js";
import { POST as attest } from "../api/attest.js";
import { POST as onboard } from "../api/onboard.js";
import { POST as relay } from "../api/relay.js";

const req = (body: unknown) => new Request("http://local/api", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const handle = `smoke-${Date.now().toString(36)}`;
const key = KeyPair.fromRandom("ed25519");

// 1. Gasless onboarding
const ob = await (await onboard(req({ handle, publicKey: key.getPublicKey().toString() }))).json();
console.log("onboard", ob.accountId ?? ob.error, ob.hash ? `https://testnet.nearblocks.io/txns/${ob.hash}` : "");
await new Promise((r) => setTimeout(r, 3000));

// 2. A relayed create_invoice signed only by the freelancer's new key
const s = await seal({ v: 1, number: "NV-SMOKE", from: { name: "Smoke" }, to: { name: "Client" }, items: [{ description: "Test", quantity: 1, unitCents: 1000 }], issuedOn: "2026-11-14", dueOn: "2026-12-01", currency: "USDC" });
const acct = new Account(ob.accountId, "https://rpc.testnet.fastnear.com", key.toString() as any);
const { signedDelegate } = await acct.createSignedMetaTransaction({
  receiverId: "invoices.nearvoice.testnet",
  actions: [
    actions.functionCall(
      "create_invoice",
      new TextEncoder().encode(JSON.stringify({ token: "usdc.nearvoice.testnet", amount: "10000000", due_ms: Date.now() + 86_400_000 * 7, sealed: s.sealed, digest: s.digest })),
      50_000_000_000_000n,
      0n,
    ),
  ],
  blockHeightTtl: 120,
} as any);
const { encodeSignedDelegate } = await import("near-api-js");
const rl = await (await relay(req({ signedDelegate: Buffer.from(encodeSignedDelegate(signedDelegate)).toString("base64") }))).json();
console.log("relay ", rl.ok ? `invoice #${rl.value} created, gas paid by the relayer` : rl.error ?? rl.failure, rl.hash ? `https://testnet.nearblocks.io/txns/${rl.hash}` : "");

// 3. Private AI, verified in the browser's way
const nonce = newNonce();
const report = await fetchReport(PRIVATE_MODEL, nonce);
const local = checkReport(report, nonce, PRIVATE_MODEL);
console.log("attest local checks", `${local.filter((c) => c.ok).length}/${local.length} passed`);
const a = await (await ai(req({ text: "Logo design for Acme Inc, 3 days at $400 a day, plus a $150 rush fee. Due in two weeks." }))).json();
if (a.error) console.log("ai    ", a.error);
else {
  const content = JSON.parse(a.responseText).choices[0].message.content;
  const signers = [report.gateway_attestation.signing_address, ...report.model_attestations.map((m) => m.signing_address)];
  const v = a.signature ? await verifyResponse({ requestBody: a.requestBody, responseText: a.responseText, signedText: a.signature.text, signature: a.signature.signature, model: PRIVATE_MODEL, allowedSigners: signers }) : null;
  console.log("ai    ", content.replace(/\s+/g, " ").slice(0, 220));
  console.log("ai sig", v ? JSON.stringify(v) : "no signature returned");
}

// 4. Intel + NVIDIA verdicts via the server
const at = await (await attest(req({ nonce, model: PRIVATE_MODEL }))).json();
console.log("intel ", JSON.stringify(at.intel));
console.log("nvidia", JSON.stringify(at.nvidia));
