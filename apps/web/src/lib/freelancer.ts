/**
 * The freelancer's side. Their NEAR account is created for them, holding a key
 * generated in this browser; Nearvoice's relayer pays the gas of every call
 * they make to the invoice contract (NEP-366 meta transactions). They never
 * buy NEAR.
 */
import { Account, KeyPair, actions, encodeSignedDelegate } from "near-api-js";
import { CALL_GAS, INVOICES, RPCS, SUFFIX, USDC } from "./config";
import { vaultAll, vaultMerge } from "./vault";

const STORE = "nearvoice:freelancer";

export interface Identity {
  accountId: string;
  privateKey: string;
}

export function loadIdentity(): Identity | null {
  try {
    const raw = localStorage.getItem(STORE);
    return raw ? (JSON.parse(raw) as Identity) : null;
  } catch {
    return null;
  }
}

export function saveIdentity(id: Identity) {
  localStorage.setItem(STORE, JSON.stringify(id));
}

export function forgetIdentity() {
  localStorage.removeItem(STORE);
}

/** Creates <handle>.nearvoice.testnet with a key that never leaves this browser. */
export async function onboard(handle: string): Promise<Identity & { hash: string }> {
  const key = KeyPair.fromRandom("ed25519");
  const res = await fetch("/api/onboard", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ handle, publicKey: key.getPublicKey().toString() }),
  });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error ?? `onboarding failed (${res.status})`);
  const id = { accountId: out.accountId as string, privateKey: key.toString() };
  saveIdentity(id);
  return { ...id, hash: out.hash };
}

/** A backup file the freelancer keeps: their account key and every invoice key. */
export function backupFile(id: Identity): Blob {
  return new Blob([JSON.stringify({ account_id: id.accountId, private_key: id.privateKey, network: "testnet", invoices: vaultAll() }, null, 2)], { type: "application/json" });
}

/** Restores an account (and its invoice keys) from a backup file, after checking the key really controls the account. */
export async function restore(text: string): Promise<Identity> {
  const b = JSON.parse(text);
  if (typeof b.account_id !== "string" || typeof b.private_key !== "string") throw new Error("This is not a Nearvoice backup file.");
  const pk = KeyPair.fromString(b.private_key).getPublicKey().toString();
  const keys: any = await fetch(RPCS[0]!, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: "nv", method: "query", params: { request_type: "view_access_key_list", finality: "final", account_id: b.account_id } }),
  }).then((r) => r.json());
  if (!keys.result?.keys?.some((k: any) => k.public_key === pk)) throw new Error(`That key does not control ${b.account_id}.`);
  const id = { accountId: b.account_id, privateKey: b.private_key };
  saveIdentity(id);
  if (b.invoices && typeof b.invoices === "object") vaultMerge(b.invoices);
  return id;
}

const account = (id: Identity) => new Account(id.accountId, RPCS[0]!, id.privateKey as any);

export interface Relayed {
  hash: string;
  value: unknown;
}

/** Signs a call to the invoice contract here, and has the relayer submit and pay for it. */
export async function relayed(id: Identity, method: string, args: Record<string, unknown>): Promise<Relayed> {
  const { signedDelegate } = await account(id).createSignedMetaTransaction({
    receiverId: INVOICES,
    actions: [actions.functionCall(method, new TextEncoder().encode(JSON.stringify(args)), CALL_GAS, 0n)],
    blockHeightTtl: 120,
  } as any);
  const bytes = encodeSignedDelegate(signedDelegate);
  const b64 = btoa(String.fromCharCode(...bytes));
  const res = await fetch("/api/relay", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ signedDelegate: b64 }) });
  const out = await res.json();
  if (!res.ok || !out.ok) {
    const m = String(out.failure ?? out.error ?? "").match(/Smart contract panicked: ([^"\\]+)/);
    throw new Error(m ? m[1] : (out.error ?? out.failure ?? `relay failed (${res.status})`));
  }
  return { hash: out.hash, value: out.value };
}

export interface NewInvoice {
  amountUnits: bigint;
  dueMs: number;
  splits: { account_id: string; bps: number }[] | null;
  sealed: string;
  digest: string;
}

export const createInvoice = (id: Identity, inv: NewInvoice) =>
  relayed(id, "create_invoice", {
    token: USDC,
    amount: inv.amountUnits.toString(),
    due_ms: inv.dueMs,
    splits: inv.splits,
    sealed: inv.sealed,
    digest: inv.digest,
  });

export const cancelInvoice = (id: Identity, invoiceId: number) => relayed(id, "cancel_invoice", { id: invoiceId });

export const setProfile = (id: Identity, p: { name: string; default_splits: { account_id: string; bps: number }[]; paused: boolean; max_invoice: string }) => relayed(id, "set_profile", p);

/**
 * A refund moves money, so it is not relayed: the freelancer's account sends
 * the invoice amount back through the contract itself (1 yoctoNEAR + gas from
 * the account's starter balance).
 */
export async function refund(id: Identity, invoiceId: number, amountUnits: bigint): Promise<string> {
  const res: any = await account(id).signAndSendTransaction({
    receiverId: USDC,
    actions: [actions.functionCall("ft_transfer_call", new TextEncoder().encode(JSON.stringify({ receiver_id: INVOICES, amount: amountUnits.toString(), msg: JSON.stringify({ refund: invoiceId }) })), 100_000_000_000_000n, 1n)],
    waitUntil: "EXECUTED_OPTIMISTIC",
    throwOnFailure: true,
  } as any);
  return res?.transaction?.hash ?? "";
}

export const handleOf = (accountId: string) => accountId.replace(`.${SUFFIX}`, "");
