/**
 * Drafts invoice lines with NEAR AI Cloud's private model, then checks
 * everything here in the browser:
 *  1. a fresh attestation report for our own nonce (18 local checks),
 *  2. the model enclave's signature over sha256(request) and sha256(response),
 *  3. Intel TDX and NVIDIA GPU verdicts, relayed by /api/attest.
 */
import { type Check, PRIVATE_MODEL, type SignatureVerdict, checkReport, fetchReport, newNonce, verifyResponse } from "@nearvoice/core";

export interface DraftLine {
  description: string;
  quantity: number;
  unitPrice: number;
}

export interface Draft {
  client: string | null;
  items: DraftLine[];
  dueInDays: number | null;
  notes: string | null;
}

export interface Proof {
  nonce: string;
  checks: Check[];
  signature: SignatureVerdict | null;
  intel: { who: string; verified: boolean; detail: string }[];
  nvidia: { who: string; verified: boolean; gpus: number }[];
}

function parseDraft(content: string): Draft {
  const json = content.slice(content.indexOf("{"), content.lastIndexOf("}") + 1);
  const d = JSON.parse(json);
  return {
    client: typeof d.client === "string" ? d.client : null,
    items: (Array.isArray(d.items) ? d.items : [])
      .map((i: any) => ({ description: String(i.description ?? "").slice(0, 200), quantity: Number(i.quantity) || 1, unitPrice: Number(i.unitPrice) || 0 }))
      .filter((i: DraftLine) => i.description),
    dueInDays: Number.isFinite(d.dueInDays) ? d.dueInDays : null,
    notes: typeof d.notes === "string" ? d.notes : null,
  };
}

export async function verifyEnclaves(onStep?: (s: string) => void): Promise<Omit<Proof, "signature">> {
  const nonce = newNonce();
  onStep?.("Asking NEAR AI Cloud for a fresh attestation");
  const report = await fetchReport(PRIVATE_MODEL, nonce);
  const checks = checkReport(report, nonce, PRIVATE_MODEL);
  onStep?.("Checking Intel TDX and NVIDIA GPU evidence");
  const remote = await fetch("/api/attest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ nonce, model: PRIVATE_MODEL }) })
    .then((r) => r.json())
    .catch(() => ({ intel: [], nvidia: [] }));
  return { nonce, checks, intel: remote.intel ?? [], nvidia: remote.nvidia ?? [], report } as any;
}

export async function draftPrivately(text: string, onStep?: (s: string) => void): Promise<{ draft: Draft; proof: Proof }> {
  const enclave: any = await verifyEnclaves(onStep);
  onStep?.("Reading your notes inside the enclave");
  const res = await fetch("/api/ai", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
  const out = await res.json();
  if (!res.ok) throw new Error(out.error ?? `the private model did not answer (${res.status})`);
  onStep?.("Verifying the enclave's signature on the answer");
  const signers = [enclave.report.gateway_attestation.signing_address, ...enclave.report.model_attestations.map((m: any) => m.signing_address)];
  const signature = out.signature
    ? await verifyResponse({ requestBody: out.requestBody, responseText: out.responseText, signedText: out.signature.text, signature: out.signature.signature, model: PRIVATE_MODEL, allowedSigners: signers })
    : null;
  const content = JSON.parse(out.responseText).choices[0].message.content as string;
  return { draft: parseDraft(content), proof: { nonce: enclave.nonce, checks: enclave.checks, intel: enclave.intel, nvidia: enclave.nvidia, signature } };
}

export { parseDraft };
