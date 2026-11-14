/**
 * NEAR AI Cloud attestation checks that run in the browser.
 *
 * The app requests a report with a fresh 32-byte nonce and checks, without
 * trusting any server of ours:
 *  - the gateway and every model enclave echo our nonce (freshness, no replay);
 *  - each enclave's report_data commits to its signing address and our nonce;
 *  - the raw Intel TDX quote carries exactly that report_data, so the binding
 *    is signed by the CPU, not just claimed in JSON;
 *  - the quote is a TDX quote (TEE type 0x81);
 *  - the NVIDIA GPU evidence carries our nonce too.
 * The quote's Intel signature chain and the GPU evidence are verified by
 * Intel's DCAP collateral (via Phala's verifier) and NVIDIA's NRAS, which do
 * not allow browser calls; the stateless /api/attest function relays them.
 */
export const NEARAI_API = "https://cloud-api.near.ai/v1";
/** A model NEAR AI serves from its own attested TEE infrastructure. */
export const PRIVATE_MODEL = "deepseek-ai/DeepSeek-V4.1-Flash-1017";

export interface EnclaveEvidence {
  signing_address: string;
  signing_algo: string;
  request_nonce: string;
  report_data?: string;
  intel_quote: string;
  nvidia_payload?: string;
  model_name?: string;
  info?: { app_id?: string; tcb_info?: { compose_hash?: string; os_image_hash?: string; mrtd?: string } };
}

export interface AttestationReport {
  gateway_attestation: EnclaveEvidence;
  model_attestations: EnclaveEvidence[];
}

export interface Check {
  label: string;
  ok: boolean;
  detail: string;
}

export function newNonce(): string {
  const b = globalThis.crypto.getRandomValues(new Uint8Array(32));
  return [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
}

const strip = (h: string) => h.toLowerCase().replace(/^0x/, "");

/** report_data (64 bytes, hex) inside an Intel TDX v4 quote: 48-byte header, then the TD report, whose report_data sits at offset 520. */
export function tdxReportData(quoteHex: string): string {
  const q = strip(quoteHex);
  const start = (48 + 520) * 2;
  return q.slice(start, start + 128);
}

/** TEE type from the quote header (bytes 4..8, little endian). 0x81 is Intel TDX. */
export function quoteTeeType(quoteHex: string): number {
  const h = strip(quoteHex).slice(8, 16);
  return Number.parseInt(h.match(/../g)!.reverse().join(""), 16);
}

function enclaveChecks(name: string, e: EnclaveEvidence, nonce: string): Check[] {
  const out: Check[] = [];
  out.push({ label: `${name}: fresh nonce`, ok: strip(e.request_nonce) === nonce, detail: `echoed ${strip(e.request_nonce).slice(0, 12)}…` });
  const quoteRd = tdxReportData(e.intel_quote);
  const rd = e.report_data ? strip(e.report_data) : quoteRd;
  out.push({ label: `${name}: key committed in report data`, ok: rd.slice(0, 40) === strip(e.signing_address), detail: e.signing_address });
  out.push({ label: `${name}: nonce committed in report data`, ok: rd.slice(64, 128) === nonce, detail: "second half of report_data" });
  out.push({ label: `${name}: Intel TDX quote carries that report data`, ok: quoteRd === rd, detail: "parsed from the raw quote" });
  out.push({ label: `${name}: quote is from an Intel TDX enclave`, ok: quoteTeeType(e.intel_quote) === 0x81, detail: `TEE type 0x${quoteTeeType(e.intel_quote).toString(16)}` });
  if (e.nvidia_payload) {
    let gpuNonce = "";
    try {
      gpuNonce = strip(JSON.parse(e.nvidia_payload).nonce ?? "");
    } catch {
      gpuNonce = "";
    }
    out.push({ label: `${name}: NVIDIA GPU evidence carries our nonce`, ok: gpuNonce === nonce, detail: "nvidia_payload.nonce" });
  }
  return out;
}

/** Every check that can run locally against a report fetched with `nonce`. */
export function checkReport(report: AttestationReport, nonce: string, model: string): Check[] {
  const models = report.model_attestations.filter((m) => !m.model_name || m.model_name === model);
  return [
    ...enclaveChecks("Gateway", report.gateway_attestation, nonce),
    ...models.flatMap((m, i) => enclaveChecks(`Model enclave ${i + 1}`, m, nonce)),
    { label: "At least one model enclave answered", ok: models.length > 0, detail: `${models.length} enclave(s) for ${model}` },
  ];
}

export async function fetchReport(model: string, nonce: string, fetcher: (u: string) => Promise<Response> = (u) => fetch(u)): Promise<AttestationReport> {
  const res = await fetcher(`${NEARAI_API}/attestation/report?model=${encodeURIComponent(model)}&nonce=${nonce}&signing_algo=ecdsa`);
  if (!res.ok) throw new Error(`NEAR AI attestation report: HTTP ${res.status}`);
  return res.json();
}
