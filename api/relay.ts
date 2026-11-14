/**
 * POST /api/relay  { signedDelegate: base64 }
 * Pays gas for a freelancer's signed meta transaction (NEP-366), but only for
 * calls to the Nearvoice invoice contract (see packages/core/src/relay-policy.ts).
 */
import { relayRefusals } from "@nearvoice/core";
import { ACCOUNT_SUFFIX, HttpError, INVOICES, handle, json, rateLimit } from "./_lib/env.js";
import { decodeSignedDelegate, summarize, withRelayer } from "./_lib/near.js";

export async function POST(req: Request) {
  return handle(async () => {
    const body = await req.json().catch(() => ({}));
    if (typeof body.signedDelegate !== "string") throw new HttpError(400, "send { signedDelegate: base64 }");
    const sd = decodeSignedDelegate(body.signedDelegate);
    const summary = summarize(sd);
    const refusals = relayRefusals(summary, INVOICES, ACCOUNT_SUFFIX);
    if (refusals.length) throw new HttpError(403, refusals.join("; "));
    rateLimit(`relay:${summary.senderId}`, 30, 60 * 60_000);
    const out: any = await withRelayer((r) => r.relayMetaTransaction(sd));
    const hash = out?.transaction?.hash ?? out?.transaction_outcome?.id;
    const failure = out?.status?.Failure ?? out?.receipts_outcome?.find((r: any) => r.outcome?.status?.Failure)?.outcome?.status?.Failure;
    let value: unknown = null;
    for (const r of out?.receipts_outcome ?? []) {
      const v = r.outcome?.status?.SuccessValue;
      if (v) {
        try {
          value = JSON.parse(Buffer.from(v, "base64").toString());
        } catch {
          /* not JSON */
        }
      }
    }
    return json({ hash, ok: !failure, value, failure: failure ? JSON.stringify(failure).slice(0, 400) : null, sender: summary.senderId }, failure ? 422 : 200);
  });
}
