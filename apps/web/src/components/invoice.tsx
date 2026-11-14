import { type Check, type InvoiceDetails, PAY_FROM, type PayQuote, type SignatureVerdict, formatCents, lineCents, quotePayment, totalCents } from "@nearvoice/core";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import type { Proof } from "../lib/ai";

const qty = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, ""));

/**
 * One invoice, drawn as paper. `cipher` lays the on-chain ciphertext over it
 * (what everyone else sees); `stamp` drops a PAID or VOID stamp on it.
 */
export function InvoicePaper({
  details,
  cipher,
  stamp,
  stampNote,
  digest,
  id,
}: {
  details: InvoiceDetails;
  cipher?: string | null;
  stamp?: "paid" | "void" | null;
  stampNote?: string;
  digest?: string;
  id?: number;
}) {
  const reduce = useReducedMotion();
  return (
    <article className="paper" aria-label={`Invoice ${details.number}`}>
      <div className="paper-top">
        <div>
          <div className="paper-title">Invoice</div>
          <div className="paper-no">
            {details.number}
            {id !== undefined ? ` · on chain #${id}` : ""}
          </div>
        </div>
        <div style={{ textAlign: "right", fontSize: "var(--t-xs)", color: "var(--ink-2)" }}>
          <div>Issued {details.issuedOn}</div>
          <div>
            Due <b style={{ color: "var(--ink)" }}>{details.dueOn}</b>
          </div>
        </div>
      </div>
      <div className="paper-parties">
        <div>
          <small>From</small>
          <b>{details.from.name}</b>
          {details.from.email && <div className="faint">{details.from.email}</div>}
        </div>
        <div>
          <small>Bill to</small>
          <b>{details.to.name}</b>
          {details.to.email && <div className="faint">{details.to.email}</div>}
        </div>
      </div>
      <table className="paper-lines">
        <thead>
          <tr>
            <th>Description</th>
            <th className="num">Qty</th>
            <th className="num">Price</th>
            <th className="num">Amount</th>
          </tr>
        </thead>
        <tbody>
          {details.items.map((it, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: lines have no id and never reorder here
            <tr key={i}>
              <td>{it.description}</td>
              <td className="num">{qty(it.quantity)}</td>
              <td className="num">{formatCents(BigInt(it.unitCents))}</td>
              <td className="num">{formatCents(lineCents(it))}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="paper-total">
        <span>Total due, in USDC on NEAR</span>
        <strong>{formatCents(totalCents(details), { symbol: true })}</strong>
      </div>
      {details.notes && <p className="paper-notes">{details.notes}</p>}
      {digest && (
        <div className="paper-foot">
          <span>Fingerprint on chain</span>
          <code title={digest}>sha256 {digest.slice(0, 20)}…</code>
        </div>
      )}

      <AnimatePresence>
        {cipher && (
          <motion.div className="cipher" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.6 } }} transition={{ duration: 0.5 }} aria-hidden="true">
            {cipher.repeat(Math.ceil(2400 / Math.max(cipher.length, 1))).slice(0, 2400)}
            <span className="cipher-lock">
              <LockIcon /> Sealed: only the link holder can read this
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {stamp && (
          <motion.div
            className={`stamp${stamp === "void" ? " stamp--void" : ""}`}
            initial={reduce ? { opacity: 0 } : { opacity: 0, scale: 2.6, rotate: 4 }}
            animate={{ opacity: 0.92, scale: 1, rotate: 0 }}
            exit={{ opacity: 0 }}
            transition={reduce ? { duration: 0.2 } : { type: "spring", stiffness: 420, damping: 18, mass: 0.9 }}
          >
            {stamp === "paid" ? "PAID" : "VOID"}
            {stampNote && <small>{stampNote}</small>}
          </motion.div>
        )}
      </AnimatePresence>
    </article>
  );
}

export function LockIcon({ size = 16 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" fill="currentColor" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" strokeWidth="2.2" />
    </svg>
  );
}

export function ShieldIcon({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 2.5l8 3v6.2c0 4.9-3.4 8.6-8 9.8-4.6-1.2-8-4.9-8-9.8V5.5z" fill="currentColor" opacity=".18" />
      <path d="M12 2.5l8 3v6.2c0 4.9-3.4 8.6-8 9.8-4.6-1.2-8-4.9-8-9.8V5.5z" fill="none" stroke="currentColor" strokeWidth="1.7" />
      <path d="M8.3 12.2l2.5 2.5 5-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Tick({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span className="tick tick--wait" aria-label="checking" />;
  return (
    <span className={`tick${ok ? "" : " tick--bad"}`} aria-label={ok ? "passed" : "failed"}>
      {ok ? "✓" : "!"}
    </span>
  );
}

function Group({ title, items, open }: { title: string; items: { label: string; ok: boolean; detail: string }[]; open?: boolean }) {
  const passed = items.filter((c) => c.ok).length;
  return (
    <details className="proof-group" open={open}>
      <summary>
        <Tick ok={items.length ? passed === items.length : false} />
        {title}
        <span className="count">
          {passed}/{items.length}
        </span>
      </summary>
      <ul>
        {items.map((c) => (
          <li key={c.label}>
            <Tick ok={c.ok} />
            <span>{c.label}</span>
            <span>{c.detail}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}

export function signatureChecks(s: SignatureVerdict | null): Check[] {
  if (!s) return [{ label: "Enclave signature returned", ok: false, detail: "none" }];
  return [
    { label: "Hash of our exact request matches", ok: s.requestHashMatch, detail: "sha256(request)" },
    { label: "Hash of the answer we received matches", ok: s.responseHashMatch, detail: "sha256(response)" },
    { label: "Signer is an attested enclave key", ok: s.signerMatch, detail: `${s.signer.slice(0, 10)}…` },
    ...(s.modelMatch === null ? [] : [{ label: "Signed for the private model", ok: s.modelMatch, detail: "model id" }]),
  ];
}

/** Everything the browser checked about the private model, grouped and expandable. */
export function ProofPanel({ proof, title = "Verified private inference" }: { proof: Omit<Proof, "signature"> & { signature?: SignatureVerdict | null }; title?: string }) {
  const hardware = [
    ...proof.intel.map((v) => ({ label: `Intel TDX quote (${v.who})`, ok: v.verified, detail: v.verified ? "Phala DCAP: valid" : v.detail })),
    ...proof.nvidia.map((v) => ({ label: `NVIDIA GPU attestation (${v.who})`, ok: v.verified, detail: `${v.gpus} GPU(s), NRAS` })),
  ];
  const groups = [
    { title: "Attestation for our fresh nonce", items: proof.checks },
    { title: "Hardware verified by Intel and NVIDIA", items: hardware },
    ...(proof.signature !== undefined ? [{ title: "Enclave signed this exact answer", items: signatureChecks(proof.signature) }] : []),
  ];
  const all = groups.flatMap((g) => g.items);
  const passed = all.filter((c) => c.ok).length;
  return (
    <section className="proof" aria-label={title}>
      <div className="proof-head">
        <span className="proof-badge">
          <ShieldIcon />
        </span>
        <div>
          <h3>{title}</h3>
          <p>
            {passed} of {all.length} checks passed in your browser · nonce <code>{proof.nonce.slice(0, 10)}…</code>
          </p>
        </div>
      </div>
      <div className="proof-groups">
        {groups.map((g, i) => (
          <Group key={g.title} title={g.title} items={g.items} open={i === 0 && g.items.some((c) => !c.ok)} />
        ))}
      </div>
    </section>
  );
}

/** A dry 1Click quote for each source chain: what the client would send so the freelancer receives exactly this much USDC on NEAR. */
export function QuotePanel({ amountUnits }: { amountUnits: bigint }) {
  const [shown, setShown] = useState(false);
  const q = useQuery({
    queryKey: ["quotes", amountUnits.toString()],
    enabled: shown && amountUnits > 0n,
    staleTime: 60_000,
    queryFn: async () => {
      // 1Click has no testnet: these are dry mainnet quotes, which move nothing.
      const res = await Promise.allSettled(PAY_FROM.map((f) => quotePayment(f, amountUnits)));
      return res.map((r, i) => ({ from: PAY_FROM[i]!, quote: r.status === "fulfilled" ? r.value : null, error: r.status === "rejected" ? String(r.reason?.message ?? r.reason) : null }));
    },
  });
  if (!shown)
    return (
      <button type="button" className="btn btn--ghost btn--sm" onClick={() => setShown(true)} style={{ alignSelf: "flex-start" }}>
        Paying from another chain? See live NEAR Intents quotes
      </button>
    );
  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: "space-between" }}>
        <b style={{ fontSize: "var(--t-sm)" }}>Pay from any chain with NEAR Intents</b>
        <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
          live 1Click quotes, mainnet
        </span>
      </div>
      {q.isLoading && <QuoteSkeleton />}
      <div className="quotes">
        {q.data?.map(({ from, quote, error }) => (
          <QuoteRow key={from.id} chain={from.chain} token={from.label} quote={quote} error={error} />
        ))}
      </div>
      <p className="notice">
        1Click swaps whatever the client holds into exactly this amount of USDC on NEAR and delivers it to the invoice. It runs on mainnet only, so on this testnet build the quote is real
        and the payment settles in test USDC.
      </p>
    </div>
  );
}

function QuoteSkeleton() {
  const [n, setN] = useState(1);
  useEffect(() => {
    const t = setInterval(() => setN((x) => (x % 3) + 1), 400);
    return () => clearInterval(t);
  }, []);
  return <p className="faint" style={{ fontSize: "var(--t-xs)" }}>Asking 1Click{".".repeat(n)}</p>;
}

function QuoteRow({ chain, token, quote, error }: { chain: string; token: string; quote: PayQuote | null; error: string | null }) {
  return (
    <div className="quote">
      <span className="quote-chain">{chain.slice(0, 3).toUpperCase()}</span>
      <div>
        <b>
          {token} on {chain}
        </b>
        <small>{quote ? `about ${Math.max(1, Math.round(quote.timeEstimate))} s · at most $${quote.feeUsd.toFixed(2)} in fees and slippage` : (error ?? "").slice(0, 60)}</small>
      </div>
      <div className="amt">{quote ? `${Number(quote.amountInFormatted).toLocaleString("en-US", { maximumFractionDigits: 4 })} ${token}` : "—"}</div>
    </div>
  );
}
