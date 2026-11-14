/**
 * POST /api/onboard  { handle, publicKey }
 * Creates <handle>.nearvoice.testnet for a freelancer with the key their
 * browser generated, funded only for its own storage. The freelancer holds the
 * only key; Nearvoice never sees it and pays all their later gas via /api/relay.
 */
import { validHandle } from "@nearvoice/core";
import { ACCOUNT_SUFFIX, HttpError, handle, json, rateLimit } from "./_lib/env.js";
import { PublicKey, actions, viewAccount, withRelayer } from "./_lib/near.js";

const STORAGE_FUNDING = 20_000_000_000_000_000_000_000n; // 0.02 NEAR: covers the account's own storage

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => ({}));
    const name = String(body.handle ?? "").toLowerCase();
    const publicKey = String(body.publicKey ?? "");
    if (!validHandle(name)) throw new HttpError(400, "Pick 3–32 lowercase letters, digits or single hyphens");
    if (!/^ed25519:[1-9A-HJ-NP-Za-km-z]{43,44}$/.test(publicKey)) throw new HttpError(400, "publicKey must be an ed25519 key");
    rateLimit(`onboard:${req.headers.get("x-forwarded-for") ?? "?"}`, 5, 60 * 60_000);
    const accountId = `${name}.${ACCOUNT_SUFFIX}`;
    if (await viewAccount(accountId)) throw new HttpError(409, `${accountId} is taken`);
    const out: any = await withRelayer((r) =>
      r.signAndSendTransaction({
        receiverId: accountId,
        actions: [actions.createAccount(), actions.transfer(STORAGE_FUNDING), actions.addFullAccessKey(PublicKey.fromString(publicKey))],
        waitUntil: "EXECUTED_OPTIMISTIC",
        throwOnFailure: false,
      } as any),
    );
    const failure = out?.status?.Failure;
    if (failure) throw new HttpError(422, `could not create ${accountId}: ${JSON.stringify(failure).slice(0, 200)}`);
    return json({ accountId, hash: out?.transaction?.hash });
  });
}
