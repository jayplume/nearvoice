import { type InvoiceDetails, open, seal } from "@nearvoice/core";
import { useMutation } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState } from "react";
import { ProofPanel, ShieldIcon } from "../components/invoice";
import { Spinner, useToast } from "../components/parts";
import { verifyEnclaves } from "../lib/ai";
import { REPO } from "../lib/config";

const ROWS = [
  { what: "Line items, prices, names, emails, notes", chain: "Ciphertext only (AES-256-GCM)", who: "Whoever holds the link" },
  { what: "The decryption key", chain: "Never", who: "The link's #fragment, which browsers do not send to servers" },
  { what: "Fingerprint of the details", chain: "sha256 of the canonical JSON", who: "Everyone, so the client can check nothing was swapped" },
  { what: "Amount, due date, status, payer, split", chain: "In the clear", who: "Everyone: the contract needs them to enforce payment" },
  { what: "Your notes to the AI", chain: "Never", who: "Only the enclave, for the life of one request" },
];

function SealPlayground() {
  const [text, setText] = useState("4 days of onboarding redesign at $450/day");
  const [out, setOut] = useState<{ sealed: string; digest: string; key: string; back?: string; match?: boolean } | null>(null);
  const toast = useToast();
  const run = async () => {
    const d: InvoiceDetails = {
      v: 1,
      number: "DEMO-1",
      from: { name: "You" },
      to: { name: "Your client" },
      items: [{ description: text.slice(0, 200) || "Work", quantity: 1, unitCents: 100 }],
      issuedOn: "2026-11-14",
      dueOn: "2026-11-28",
      currency: "USDC",
    };
    try {
      const s = await seal(d);
      const o = await open(s.sealed, s.key, s.digest);
      setOut({ ...s, back: o.details.items[0]!.description, match: o.matchesChain });
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };
  return (
    <section className="panel stack">
      <h2>Seal something yourself</h2>
      <p className="muted" style={{ fontSize: "var(--t-sm)" }}>
        This runs the same code the invoice form uses, here in your browser. Nothing is sent anywhere.
      </p>
      <label className="field">
        <span>A line of an invoice</span>
        <input value={text} onChange={(e) => setText(e.target.value)} maxLength={200} />
      </label>
      <button type="button" className="btn btn--primary" style={{ alignSelf: "flex-start" }} onClick={run}>
        Encrypt and decrypt
      </button>
      {out && (
        <motion.dl className="kv kv--stack" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          <dt>What the chain would store</dt>
          <dd className="mono" style={{ color: "var(--seal)" }}>
            {out.sealed.slice(0, 96)}…
          </dd>
          <dt>Fingerprint</dt>
          <dd className="mono">{out.digest}</dd>
          <dt>Key (in the link only)</dt>
          <dd className="mono">#k={out.key}</dd>
          <dt>Decrypted with the key</dt>
          <dd>{out.back}</dd>
          <dt>Matches fingerprint</dt>
          <dd>{out.match ? "yes" : "no"}</dd>
        </motion.dl>
      )}
    </section>
  );
}

export function Verify() {
  const toast = useToast();
  const [steps, setSteps] = useState<string[]>([]);
  const check = useMutation({
    mutationFn: () => {
      setSteps([]);
      return verifyEnclaves((s) => setSteps((x) => [...x, s]));
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>Privacy proof</h1>
          <p>Don't take our word for it. Check the enclave that drafts invoices, try the encryption yourself, and see exactly what reaches the public chain.</p>
        </div>
      </div>
      <div className="pay-grid">
        <div className="stack" style={{ gap: 20 }}>
          <section className="ai-box stack">
            <h2>
              <span style={{ color: "var(--seal)", display: "inline-flex" }}>
                <ShieldIcon />
              </span>
              Check the AI enclave now
            </h2>
            <p className="muted" style={{ fontSize: "var(--t-sm)" }}>
              Your browser makes a random nonce and asks NEAR AI Cloud for a fresh attestation. It checks that every enclave committed to that nonce and to its signing key inside an Intel TDX
              quote, and that the GPUs answered with the same nonce. Intel's and NVIDIA's own verifiers then confirm the hardware.
            </p>
            <button type="button" className="btn btn--primary" style={{ alignSelf: "flex-start" }} disabled={check.isPending} onClick={() => check.mutate()}>
              {check.isPending ? <Spinner label={steps.at(-1) ?? "Starting"} /> : check.data ? "Run it again" : "Verify the enclave"}
            </button>
            {check.data && <ProofPanel proof={check.data} title="Enclave attestation" />}
          </section>
          <section className="panel">
            <h2>What is public, what is not</h2>
            <div className="table-wrap" style={{ marginTop: 16 }}>
              <table className="table">
                <thead>
                  <tr>
                    <th>Data</th>
                    <th>On chain</th>
                    <th>Who can read it</th>
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map((r) => (
                    <tr key={r.what}>
                      <td style={{ whiteSpace: "normal" }}>{r.what}</td>
                      <td style={{ whiteSpace: "normal" }}>{r.chain}</td>
                      <td style={{ whiteSpace: "normal" }} className="muted">
                        {r.who}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
        <div className="stack" style={{ gap: 20 }}>
          <SealPlayground />
          <section className="panel stack">
            <h2>Limits, plainly</h2>
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: "var(--t-sm)", display: "flex", flexDirection: "column", gap: 8 }} className="muted">
              <li>Anyone who has the link can read the invoice. Send it the way you'd send a PDF.</li>
              <li>Amounts and accounts are public, because the contract has to check them. Payments are not anonymous.</li>
              <li>Nearvoice's server forwards your AI request to NEAR AI Cloud. It does not log it, and the enclave's signature proves the answer came from the attested model.</li>
              <li>Invoice keys live in your browser. Download the backup from your dashboard.</li>
            </ul>
            <a href={`${REPO}/blob/main/docs/SECURITY.md`} target="_blank" rel="noreferrer" style={{ fontSize: "var(--t-sm)" }}>
              Read the security model
            </a>
          </section>
        </div>
      </div>
    </div>
  );
}
