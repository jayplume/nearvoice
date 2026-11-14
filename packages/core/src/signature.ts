/**
 * Verifies a NEAR AI Cloud response signature: the enclave signs
 * "{model}:{sha256(request)}:{sha256(response)}" (or "{req}:{resp}" for the
 * gateway) with an Ethereum-style personal_sign key whose address is in the
 * attestation report. We recompute both hashes from the exact bytes and
 * recover the signer with secp256k1, so a proxy in the middle cannot alter
 * either side without breaking the check.
 */
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { sha256Hex } from "./seal.js";

const enc = new TextEncoder();

/** The address that signed `message` with EIP-191 personal_sign. */
export function recoverAddress(message: string, signatureHex: string): string {
  const sig = hexToBytes(signatureHex.replace(/^0x/, ""));
  if (sig.length !== 65) throw new Error("signature must be 65 bytes");
  const prefix = enc.encode(`\x19Ethereum Signed Message:\n${enc.encode(message).length}`);
  const msg = enc.encode(message);
  const full = new Uint8Array(prefix.length + msg.length);
  full.set(prefix);
  full.set(msg, prefix.length);
  const hash = keccak_256(full);
  const v = sig[64]! >= 27 ? sig[64]! - 27 : sig[64]!;
  const pub = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(hash).toRawBytes(false);
  return `0x${bytesToHex(keccak_256(pub.slice(1)).slice(-20))}`;
}

export interface SignatureVerdict {
  requestHashMatch: boolean;
  responseHashMatch: boolean;
  modelMatch: boolean | null;
  signerMatch: boolean;
  signer: string;
  ok: boolean;
}

export async function verifyResponse(args: { requestBody: string; responseText: string; signedText: string; signature: string; model: string; allowedSigners: string[] }): Promise<SignatureVerdict> {
  const parts = args.signedText.split(":");
  const hasModel = parts.length === 3;
  const [reqH, resH] = hasModel ? [parts[1], parts[2]] : [parts[0], parts[1]];
  const requestHashMatch = reqH === (await sha256Hex(args.requestBody));
  const responseHashMatch = resH === (await sha256Hex(args.responseText));
  const modelMatch = hasModel ? parts[0] === args.model : null;
  let signer = "";
  try {
    signer = recoverAddress(args.signedText, args.signature);
  } catch {
    signer = "";
  }
  const signerMatch = args.allowedSigners.some((a) => a.toLowerCase() === signer.toLowerCase());
  return { requestHashMatch, responseHashMatch, modelMatch, signerMatch, signer, ok: requestHashMatch && responseHashMatch && modelMatch !== false && signerMatch };
}
