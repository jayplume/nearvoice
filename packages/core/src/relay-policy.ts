/**
 * What the Nearvoice relayer agrees to pay gas for. A meta transaction
 * (NEP-366) is signed by the freelancer and submitted by the relayer, so the
 * relayer must refuse anything but calls to our own invoice contract: no
 * transfers, no keys, no deposits, bounded gas.
 */
export const RELAYABLE_METHODS = ["create_invoice", "cancel_invoice", "set_profile"] as const;
export const MAX_RELAY_GAS = 100_000_000_000_000n; // 100 Tgas per call
export const MAX_RELAY_ACTIONS = 3;

export interface DelegateSummary {
  senderId: string;
  receiverId: string;
  actions: { kind: string; methodName?: string; gas?: bigint; deposit?: bigint }[];
}

/** Returns why the relayer refuses this delegate action; empty when it is allowed. */
export function relayRefusals(d: DelegateSummary, invoicesContract: string, accountSuffix: string): string[] {
  const out: string[] = [];
  if (d.receiverId !== invoicesContract) out.push(`only calls to ${invoicesContract} are relayed`);
  if (!d.senderId.endsWith(`.${accountSuffix}`)) out.push(`only Nearvoice accounts (*.${accountSuffix}) are relayed`);
  if (d.actions.length === 0 || d.actions.length > MAX_RELAY_ACTIONS) out.push(`1 to ${MAX_RELAY_ACTIONS} actions per request`);
  for (const a of d.actions) {
    if (a.kind !== "functionCall") {
      out.push(`${a.kind} actions are not relayed`);
      continue;
    }
    if (!RELAYABLE_METHODS.includes(a.methodName as (typeof RELAYABLE_METHODS)[number])) out.push(`${a.methodName} is not relayed`);
    if ((a.deposit ?? 0n) !== 0n) out.push("relayed calls cannot attach a deposit");
    if ((a.gas ?? 0n) > MAX_RELAY_GAS) out.push("at most 100 Tgas per relayed call");
  }
  return out;
}

/** Account names freelancers can claim: lowercase letters, digits, single hyphens, 3–32 characters. */
export function validHandle(name: string): boolean {
  return /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){2,31}$/.test(name) && !["www", "api", "app", "usdc", "invoices", "relay", "admin"].includes(name);
}
