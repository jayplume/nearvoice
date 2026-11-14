/**
 * Testnet signing for the scripts. Keys come from NEAR_KEYS (JSON
 * {"account.testnet":"ed25519:..."}) or the NEAR CLI keychain in
 * ~/.near-credentials/testnet. Nothing here is ever committed.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { Account, KeyPair, actions } from "near-api-js";

export const RPCS = ["https://rpc.testnet.fastnear.com", "https://near-testnet.drpc.org"];
const keychain = () => join(process.env.NEAR_CREDENTIALS_DIR ?? join(homedir(), ".near-credentials"), "testnet");

export function loadKey(accountId: string): string {
  if (process.env.NEAR_KEYS) {
    const key = (JSON.parse(process.env.NEAR_KEYS) as Record<string, unknown>)[accountId];
    if (typeof key === "string") return key;
  }
  const raw = JSON.parse(readFileSync(join(keychain(), `${accountId}.json`), "utf8"));
  return raw.private_key;
}

export interface Sent {
  hash: string;
  ok: boolean;
  value?: unknown;
  failure?: string;
}

function outcome(res: any): Sent {
  const hash = res?.transaction?.hash ?? res?.transaction_outcome?.id ?? "?";
  const status = res?.status;
  if (status && typeof status === "object" && "Failure" in status) return { hash, ok: false, failure: JSON.stringify(status.Failure).slice(0, 500) };
  const b64 = status?.SuccessValue;
  let value: unknown;
  if (b64) {
    try {
      value = JSON.parse(Buffer.from(b64, "base64").toString("utf8"));
    } catch {
      value = undefined;
    }
  }
  return { hash, ok: true, value };
}

/** Sends through the first RPC that does not rate-limit (a 429 means the transaction was not accepted). */
export async function send(signer: string, receiverId: string, acts: any[]): Promise<Sent> {
  let last: unknown;
  for (const rpc of process.env.NEAR_RPC ? [process.env.NEAR_RPC, ...RPCS] : RPCS) {
    try {
      const res = await new Account(signer, rpc, loadKey(signer) as any).signAndSendTransaction({ receiverId, actions: acts, waitUntil: "EXECUTED_OPTIMISTIC", throwOnFailure: false } as any);
      return outcome(res);
    } catch (e) {
      last = e;
      if (!/429|rate|Too Many/i.test(String((e as any)?.cause ?? "") + String(e))) throw e;
    }
  }
  throw last;
}

export const fnCall = (method: string, args: unknown, deposit = 0n, gas = 30_000_000_000_000n) =>
  actions.functionCall(method, new TextEncoder().encode(JSON.stringify(args)), gas, deposit);

export const call = (signer: string, contract: string, method: string, args: unknown, deposit = 0n, gas?: bigint) => send(signer, contract, [fnCall(method, args, deposit, gas)]);

/** Creates `sub` under its parent with a fresh full-access key in the keychain, optionally deploying and initialising code in the same transaction. */
export async function createAccount(parent: string, sub: string, yocto: bigint, wasm?: Uint8Array, init?: { method: string; args: unknown }): Promise<Sent> {
  const path = join(keychain(), `${sub}.json`);
  const key = existsSync(path) ? KeyPair.fromString(loadKey(sub) as any) : KeyPair.fromRandom("ed25519");
  if (!existsSync(path)) writeFileSync(path, JSON.stringify({ account_id: sub, public_key: key.getPublicKey().toString(), private_key: key.toString() }), { mode: 0o600 });
  const acts: any[] = [actions.createAccount(), actions.transfer(yocto), actions.addFullAccessKey(key.getPublicKey())];
  if (wasm) acts.push(actions.deployContract(wasm));
  if (init) acts.push(fnCall(init.method, init.args, 0n, 100_000_000_000_000n));
  return send(parent, sub, acts);
}

export const NEAR = (n: number) => BigInt(Math.round(n * 1e6)) * 10n ** 18n;
export const txUrl = (h: string) => `https://testnet.nearblocks.io/txns/${h}`;
