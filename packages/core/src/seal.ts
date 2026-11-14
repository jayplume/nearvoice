/**
 * Sealing: invoice details are encrypted in the browser with AES-256-GCM.
 * The key travels only in the link's #fragment, which browsers never send to
 * a server, so the chain and our servers hold ciphertext only. The SHA-256 of
 * the canonical plaintext goes on chain as `digest`, so anyone holding the
 * link can prove their copy is the one that was billed.
 */
import { type InvoiceDetails, InvoiceDetails as Schema, canonical } from "./invoice.js";

const subtle = () => globalThis.crypto.subtle;
const enc = new TextEncoder();

export const toB64Url = (b: Uint8Array): string => btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function fromB64Url(s: string): Uint8Array<ArrayBuffer> {
  const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4));
  const out = new Uint8Array(new ArrayBuffer(b.length));
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

export async function sha256Hex(text: string): Promise<string> {
  const d = new Uint8Array(await subtle().digest("SHA-256", enc.encode(text)));
  return [...d].map((x) => x.toString(16).padStart(2, "0")).join("");
}

export interface Sealed {
  /** base64url(iv ‖ ciphertext) — goes on chain. */
  sealed: string;
  /** sha256 of the canonical plaintext — goes on chain. */
  digest: string;
  /** base64url AES key — goes only in the link fragment. */
  key: string;
}

export async function seal(details: InvoiceDetails): Promise<Sealed> {
  const plain = canonical(Schema.parse(details));
  const raw = globalThis.crypto.getRandomValues(new Uint8Array(32));
  const iv = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const key = await subtle().importKey("raw", raw, "AES-GCM", false, ["encrypt"]);
  const ct = new Uint8Array(await subtle().encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain)));
  const blob = new Uint8Array(iv.length + ct.length);
  blob.set(iv);
  blob.set(ct, iv.length);
  return { sealed: toB64Url(blob), digest: await sha256Hex(plain), key: toB64Url(raw) };
}

export interface Opened {
  details: InvoiceDetails;
  /** True when the decrypted details hash to the digest recorded on chain. */
  matchesChain: boolean;
}

/** Decrypts with the link key and checks the result against the on-chain digest. Throws on a wrong key or tampered data. */
export async function open(sealed: string, keyB64: string, chainDigest: string): Promise<Opened> {
  const blob = fromB64Url(sealed);
  const key = await subtle().importKey("raw", fromB64Url(keyB64), "AES-GCM", false, ["decrypt"]);
  const pt = await subtle().decrypt({ name: "AES-GCM", iv: blob.slice(0, 12) }, key, blob.slice(12));
  const text = new TextDecoder().decode(pt);
  const details = Schema.parse(JSON.parse(text));
  return { details, matchesChain: (await sha256Hex(canonical(details))) === chainDigest };
}
