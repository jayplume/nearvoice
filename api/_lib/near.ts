import { Account, PublicKey, SCHEMA, type SignedDelegate, actions } from "near-api-js";
import { deserialize } from "borsh";
import { HttpError, NETWORK_RPCS, RELAYER, secret } from "./env.js";

/** The relayer account, trying the next RPC when one rate-limits. */
export async function withRelayer<T>(fn: (relayer: Account) => Promise<T>): Promise<T> {
  let last: unknown;
  for (const rpc of NETWORK_RPCS) {
    try {
      return await fn(new Account(RELAYER, rpc, secret("RELAYER_KEY") as any));
    } catch (e) {
      last = e;
      if (!/429|rate|Too Many/i.test(String((e as any)?.cause ?? "") + String(e))) throw e;
    }
  }
  throw last;
}

export function decodeSignedDelegate(b64: string): SignedDelegate {
  try {
    return deserialize(SCHEMA.SignedDelegate, Buffer.from(b64, "base64")) as unknown as SignedDelegate;
  } catch {
    throw new HttpError(400, "signedDelegate is not a valid base64 borsh SignedDelegate");
  }
}

/** A flat view of the delegate's actions for the relay policy. */
export function summarize(sd: SignedDelegate) {
  const d: any = (sd as any).delegateAction;
  return {
    senderId: d.senderId as string,
    receiverId: d.receiverId as string,
    actions: (d.actions as any[]).map((a) => {
      const kind = Object.keys(a).find((k) => a[k] !== undefined) ?? "unknown";
      const fc = a.functionCall;
      return fc ? { kind, methodName: fc.methodName as string, gas: BigInt(fc.gas), deposit: BigInt(fc.deposit) } : { kind };
    }),
  };
}

export const viewAccount = async (id: string) => {
  for (const rpc of NETWORK_RPCS) {
    try {
      const r = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "query", params: { request_type: "view_account", finality: "final", account_id: id } }),
      }).then((x) => x.json());
      if (r.result) return r.result;
      if (r.error?.cause?.name === "UNKNOWN_ACCOUNT") return null;
    } catch {
      /* next rpc */
    }
  }
  return null;
};

export { actions, PublicKey };
