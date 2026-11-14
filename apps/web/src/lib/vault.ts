/**
 * The freelancer's own copy of each invoice key, kept in this browser only.
 * The chain holds ciphertext; without these keys even the freelancer's
 * dashboard could show only amounts. The backup file includes them.
 */
const STORE = "nearvoice:vault";

export interface VaultEntry {
  key: string;
  number: string;
  client: string;
  issuedOn: string;
  dueOn: string;
}

type Vault = Record<string, VaultEntry>;

function read(): Vault {
  try {
    return JSON.parse(localStorage.getItem(STORE) ?? "{}") as Vault;
  } catch {
    return {};
  }
}

export const vaultAll = read;
export const vaultGet = (id: number): VaultEntry | undefined => read()[String(id)];

export function vaultPut(id: number, e: VaultEntry) {
  const v = read();
  v[String(id)] = e;
  try {
    localStorage.setItem(STORE, JSON.stringify(v));
  } catch {
    /* storage blocked: the link still works */
  }
}

export function vaultMerge(v: Vault) {
  try {
    localStorage.setItem(STORE, JSON.stringify({ ...read(), ...v }));
  } catch {
    /* storage blocked */
  }
}

export const shareLink = (id: number, key: string) => `${window.location.origin}/i/${id}#k=${key}`;
