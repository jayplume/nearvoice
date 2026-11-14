/**
 * POST /api/attest  { nonce, model }
 * The two checks a browser cannot make itself (Intel and NVIDIA do not allow
 * cross-origin calls): it fetches NEAR AI's report for the browser's nonce,
 * sends each Intel TDX quote to Phala's DCAP verifier and each NVIDIA GPU
 * evidence to NVIDIA's NRAS, and returns their verdicts. Stateless.
 */
import { NEARAI_API } from "@nearvoice/core";
import { HttpError, handle, json, rateLimit } from "./_lib/env.js";

const decodeJwt = (t: string) => {
  try {
    const p = t.split(".")[1]!;
    return JSON.parse(Buffer.from(p.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString());
  } catch {
    return null;
  }
};

export async function POST(req: Request) {
  return handle(async () => {
    const { nonce, model } = await req.json().catch(() => ({}));
    if (!/^[0-9a-f]{64}$/.test(String(nonce))) throw new HttpError(400, "nonce must be 32 random bytes in hex");
    if (typeof model !== "string" || model.length > 120) throw new HttpError(400, "model is required");
    rateLimit(`attest:${req.headers.get("x-forwarded-for") ?? "?"}`, 30, 60 * 60_000);
    const report = await fetch(`${NEARAI_API}/attestation/report?model=${encodeURIComponent(model)}&nonce=${nonce}&signing_algo=ecdsa`).then((r) => r.json());
    const enclaves = [
      { who: "Gateway", e: report.gateway_attestation },
      ...(report.model_attestations ?? []).map((e: any, i: number) => ({ who: `Model enclave ${i + 1}`, e })),
    ];
    const intel = await Promise.all(
      enclaves.map(async ({ who, e }) => {
        const r = await fetch("https://cloud-api.phala.network/api/v1/attestations/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ hex: e.intel_quote }),
        })
          .then((x) => x.json())
          .catch(() => null);
        return { who, verified: r?.success === true, detail: r?.quote?.header?.tee_type ?? "no answer" };
      }),
    );
    const nvidia = await Promise.all(
      enclaves
        .filter(({ e }) => e.nvidia_payload)
        .map(async ({ who, e }) => {
          const r = await fetch("https://nras.attestation.nvidia.com/v3/attest/gpu", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: e.nvidia_payload,
          })
            .then((x) => x.json())
            .catch(() => null);
          const overall = Array.isArray(r) ? decodeJwt(Array.isArray(r[0]) ? r[0][1] : "") : null;
          return { who, verified: overall?.["x-nvidia-overall-att-result"] === true, gpus: overall ? Object.keys(overall.submods ?? {}).length : 0 };
        }),
    );
    return json({ nonce, model, intel, nvidia });
  });
}
