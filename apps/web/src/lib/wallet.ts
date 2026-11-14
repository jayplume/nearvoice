// biome-ignore lint/style/useNodejsImportProtocol: the npm "buffer" polyfill for browsers, not Node's module
import { Buffer } from "buffer";
import { setupWalletSelector, type Wallet, type WalletSelector } from "@near-wallet-selector/core";
import { setupHereWallet } from "@near-wallet-selector/here-wallet";
import { setupIntearWallet } from "@near-wallet-selector/intear-wallet";
import { setupMeteorWallet } from "@near-wallet-selector/meteor-wallet";
import { setupSender } from "@near-wallet-selector/sender";
import { INVOICES, NETWORK, PAY_GAS, USDC } from "./config";

(globalThis as any).Buffer ??= Buffer;

/** The client's side: a normal NEAR wallet pays the invoice. */
export const WALLETS = [
  { id: "meteor-wallet", label: "Meteor" },
  { id: "intear-wallet", label: "Intear" },
  { id: "here-wallet", label: "HERE" },
  { id: "sender", label: "Sender" },
] as const;

let selectorPromise: Promise<WalletSelector> | null = null;
const getSelector = () => {
  selectorPromise ??= setupWalletSelector({ network: NETWORK, modules: [setupMeteorWallet(), setupIntearWallet(), setupHereWallet(), setupSender()] });
  return selectorPromise;
};

export async function connect(walletId: string): Promise<string> {
  const wallet = await (await getSelector()).wallet(walletId);
  const accounts = await wallet.signIn({ contractId: undefined as any, methodNames: [] } as any);
  const id = accounts[0]?.accountId ?? (await wallet.getAccounts())[0]?.accountId;
  if (!id) throw new Error("The wallet did not return an account.");
  return id;
}

async function current(): Promise<{ wallet: Wallet; accountId: string } | null> {
  const selector = await getSelector();
  if (!selector.isSignedIn()) return null;
  const wallet = await selector.wallet();
  const accountId = (await wallet.getAccounts())[0]?.accountId;
  return accountId ? { wallet, accountId } : null;
}

export const connectedAccount = async () => (await current())?.accountId ?? null;

export async function disconnect() {
  const w = await current();
  if (!w) return;
  await Promise.race([w.wallet.signOut().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith("near-wallet-selector:")) localStorage.removeItem(k);
  } catch {
    /* storage blocked */
  }
  selectorPromise = null;
}

async function send(receiverId: string, method: string, args: unknown, deposit: bigint, gas = PAY_GAS): Promise<string> {
  const w = await current();
  if (!w) throw new Error("Connect a wallet first.");
  const outcome: any = await w.wallet.signAndSendTransaction({
    receiverId,
    actions: [{ functionCall: { methodName: method, args: new TextEncoder().encode(JSON.stringify(args)), gas, deposit } }] as any,
  });
  const failure = outcome?.status?.Failure ?? outcome?.receipts_outcome?.find((r: any) => r.outcome?.status?.Failure)?.outcome?.status?.Failure;
  if (failure) {
    const m = JSON.stringify(failure).match(/Smart contract panicked: ([^"\\]+)/);
    throw new Error(m ? m[1] : "The transaction failed.");
  }
  return outcome?.transaction?.hash ?? outcome?.transaction_outcome?.id ?? "";
}

/** 1,000 test USDC from the faucet (testnet only). */
export const takeTestUsdc = () => send(USDC, "faucet", {}, 0n, 30_000_000_000_000n);

/** Pays invoice `id` with exactly `amountUnits` USDC through the invoice contract. */
export const payInvoice = (id: number, amountUnits: bigint) =>
  send(USDC, "ft_transfer_call", { receiver_id: INVOICES, amount: amountUnits.toString(), msg: JSON.stringify({ pay: id }) }, 1n);
