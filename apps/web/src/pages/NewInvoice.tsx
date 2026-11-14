import { type InvoiceDetails, InvoiceDetails as Schema, centsToUnits, formatCents, parseCents, seal, totalCents } from "@nearvoice/core";
import { useMutation, useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { InvoicePaper, LockIcon, ProofPanel, ShieldIcon } from "../components/invoice";
import { Spinner, TxLink, useToast } from "../components/parts";
import { type Proof, draftPrivately } from "../lib/ai";
import { getProfile, listByIssuer } from "../lib/chain";
import { isoDay } from "../lib/format";
import { createInvoice, handleOf } from "../lib/freelancer";
import { Link } from "../lib/router";
import { shareLink, vaultPut } from "../lib/vault";
import { Onboard, useIdentity } from "./Dashboard";

interface Row {
  description: string;
  quantity: string;
  price: string;
}

/** Fictional sample notes, so anyone can try the private model without real client data. */
const EXAMPLES = [
  { label: "Designer", text: "Lumen Labs: 4 days redesigning the onboarding flow at $450 a day, plus 6.5 hours of design QA at $80/h. Due in two weeks. Thanks for a great project!" },
  { label: "Developer", text: "For Harbor Coffee Co: built the online ordering page, 22 hours at $95/h. Stripe-to-USDC checkout setup, flat $600. Hosting for November $25. Payment due in 10 days." },
  { label: "Translator", text: "Translation of the Q3 investor letter, English to French, 3,200 words at $0.14 per word, plus a rush fee of $120 because they needed it in 48 hours. Client: Vela Ventures. Net 30." },
];
const EXAMPLE = EXAMPLES[0]!.text;

const DAY = 86_400_000;
const blank = (): Row => ({ description: "", quantity: "1", price: "" });

function toDetails(f: { number: string; fromName: string; fromEmail: string; toName: string; toEmail: string; rows: Row[]; notes: string; dueOn: string }): InvoiceDetails | string {
  const items = [];
  for (const r of f.rows) {
    if (!r.description.trim() && !r.price.trim()) continue;
    let unitCents: bigint;
    try {
      unitCents = parseCents(r.price || "0");
    } catch {
      return `"${r.price}" is not a price`;
    }
    items.push({ description: r.description.trim(), quantity: Number(r.quantity) || 0, unitCents: Number(unitCents) });
  }
  const res = Schema.safeParse({
    v: 1,
    number: f.number.trim(),
    from: { name: f.fromName.trim(), email: f.fromEmail.trim() || undefined },
    to: { name: f.toName.trim(), email: f.toEmail.trim() || undefined },
    items,
    notes: f.notes.trim() || undefined,
    issuedOn: isoDay(Date.now()),
    dueOn: f.dueOn,
    currency: "USDC",
  });
  if (!res.success) {
    const i = res.error.issues[0]!;
    const where = i.path.join(".");
    if (where.startsWith("to.name")) return "Add the client's name";
    if (where.startsWith("from.name")) return "Add your name";
    if (where.startsWith("items")) return i.message === "Add at least one line" ? i.message : "Check the invoice lines: each needs a description and a quantity above 0";
    return `${where}: ${i.message}`;
  }
  return res.data;
}

function AiDraft({ onDraft }: { onDraft: (d: Awaited<ReturnType<typeof draftPrivately>>) => void }) {
  const toast = useToast();
  const [text, setText] = useState("");
  const [steps, setSteps] = useState<string[]>([]);
  const [proof, setProof] = useState<Proof | null>(null);
  const run = useMutation({
    mutationFn: () => {
      setSteps([]);
      setProof(null);
      return draftPrivately(text, (s) => setSteps((xs) => [...xs, s]));
    },
    onSuccess: (r) => {
      setProof(r.proof);
      onDraft(r);
      if (!r.draft.items.length) toast("The model found no billable lines in that text. Add them below.", "info");
    },
    onError: (e: Error) => toast(`Private drafting failed: ${e.message}`, "bad"),
  });
  return (
    <section className="ai-box">
      <h2>
        <span style={{ color: "var(--seal)", display: "inline-flex" }}>
          <ShieldIcon />
        </span>
        Draft it in plain words
      </h2>
      <p className="muted" style={{ fontSize: "var(--t-sm)", marginTop: 6 }}>
        A private model inside a hardware enclave (NEAR AI Cloud) reads your notes. Your browser verifies the enclave before and after, and nothing is stored.
      </p>
      <label className="field">
        <span className="sr-only">Notes about the work</span>
        <textarea value={text} onChange={(e) => setText(e.target.value)} maxLength={2000} placeholder={EXAMPLE} />
      </label>
      <div className="row" style={{ marginTop: 12 }}>
        <button type="button" className="btn btn--primary" disabled={text.trim().length < 5 || run.isPending} onClick={() => run.mutate()}>
          {run.isPending ? <Spinner label="Drafting privately" /> : "Draft privately"}
        </button>
        {!text &&
          EXAMPLES.map((x) => (
            <button key={x.label} type="button" className="btn btn--ghost btn--sm" onClick={() => setText(x.text)} title="Fictional sample notes">
              Try: {x.label.toLowerCase()}
            </button>
          ))}
      </div>
      {steps.length > 0 && (
        <ol className="steps-live" aria-live="polite">
          {steps.map((s, i) => {
            const done = i < steps.length - 1 || !run.isPending;
            return (
              <motion.li key={s} className={done ? "done" : ""} initial={{ opacity: 0, x: -6 }} animate={{ opacity: 1, x: 0 }}>
                <span className={`tick${done ? (run.isError && i === steps.length - 1 ? " tick--bad" : "") : " tick--wait"}`}>{done ? (run.isError && i === steps.length - 1 ? "!" : "✓") : ""}</span>
                {s}
              </motion.li>
            );
          })}
        </ol>
      )}
      {proof && (
        <motion.div style={{ marginTop: 16 }} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
          <ProofPanel proof={proof} />
        </motion.div>
      )}
    </section>
  );
}

function Sent({ id, link, hash, details }: { id: number; link: string; hash: string; details: InvoiceDetails }) {
  const toast = useToast();
  const [sealed, setSealed] = useState(true);
  useEffect(() => {
    const t = setTimeout(() => setSealed(false), 2600);
    return () => clearTimeout(t);
  }, []);
  const cipher = useMemo(() => btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(300)))).replace(/[+/=]/g, "x"), []);
  const mail = `mailto:${details.to.email ?? ""}?subject=${encodeURIComponent(`Invoice ${details.number} from ${details.from.name}`)}&body=${encodeURIComponent(`Hi ${details.to.name},\n\nHere is invoice ${details.number} for ${formatCents(totalCents(details), { symbol: true })}. You can view and pay it here:\n\n${link}\n\nThe link holds the key that decrypts it, so please don't share it publicly.\n\n${details.from.name}`)}`;
  return (
    <div className="wrap page">
      <div className="pay-grid">
        <div>
          <InvoicePaper details={details} cipher={sealed ? cipher : null} id={id} />
        </div>
        <div className="stack">
          <span className="chip chip--seal" style={{ alignSelf: "flex-start" }}>
            Sealed and recorded on NEAR
          </span>
          <h1 style={{ fontSize: "var(--t-2xl)" }}>Invoice #{id} is ready to send</h1>
          <p className="muted">The chain holds only ciphertext, the amount and a fingerprint. Anyone with this link can read and pay the invoice; nobody else can read it.</p>
          <div className="link-box">
            <LockIcon size={14} />
            <code>{link}</code>
            <button
              type="button"
              className="btn btn--primary btn--sm"
              onClick={() => {
                navigator.clipboard.writeText(link).then(
                  () => toast("Link copied.", "good"),
                  () => toast("Copy failed: select the link and copy it.", "bad"),
                );
              }}
            >
              Copy link
            </button>
          </div>
          <div className="row">
            <a className="btn" href={mail}>
              Email it to {details.to.name}
            </a>
            <Link className="btn btn--ghost" to={`/i/${id}#k=${link.split("#k=")[1]}`}>
              Open the client's view
            </Link>
          </div>
          <dl className="kv panel" style={{ marginTop: 8 }}>
            <dt>Transaction</dt>
            <dd>
              <TxLink hash={hash} />
            </dd>
            <dt>Gas paid by you</dt>
            <dd className="mono">0 NEAR</dd>
            <dt>Key stored</dt>
            <dd>in this browser and in the link</dd>
          </dl>
          <Link to="/app" className="btn btn--ghost btn--sm" style={{ alignSelf: "flex-start" }}>
            Back to your invoices
          </Link>
        </div>
      </div>
    </div>
  );
}

export function NewInvoice() {
  const [id, setId] = useIdentity();
  const toast = useToast();
  const profile = useQuery({ queryKey: ["profile", id?.accountId], queryFn: () => getProfile(id!.accountId), enabled: !!id });
  const issued = useQuery({ queryKey: ["issued", id?.accountId], queryFn: () => listByIssuer(id!.accountId), enabled: !!id });
  const [fromName, setFromName] = useState("");
  const [fromEmail, setFromEmail] = useState("");
  const [toName, setToName] = useState("");
  const [toEmail, setToEmail] = useState("");
  const [number, setNumber] = useState("");
  const [dueOn, setDueOn] = useState(isoDay(Date.now() + 14 * DAY));
  const [rows, setRows] = useState<Row[]>([blank()]);
  const [notes, setNotes] = useState("");
  const [split, setSplit] = useState(true);
  const [sent, setSent] = useState<{ id: number; link: string; hash: string; details: InvoiceDetails } | null>(null);

  // Fill "From" once the business profile has loaded (or failed to), so its name wins over the handle.
  useEffect(() => {
    if (!fromName && id && !profile.isPending) setFromName(profile.data?.name || handleOf(id.accountId));
  }, [profile.data, profile.isPending, id, fromName]);
  useEffect(() => {
    if (!number && issued.data) setNumber(`NV-${String(issued.data.length + 1).padStart(4, "0")}`);
  }, [issued.data, number]);

  const details = useMemo(() => toDetails({ number: number || "NV-0001", fromName, fromEmail, toName, toEmail, rows, notes, dueOn }), [number, fromName, fromEmail, toName, toEmail, rows, notes, dueOn]);
  const total = typeof details === "string" ? null : totalCents(details);
  const defaultSplits = profile.data?.default_splits ?? [];

  const send = useMutation({
    mutationFn: async () => {
      if (!id) throw new Error("Create your account first.");
      if (typeof details === "string") throw new Error(details);
      if (totalCents(details) <= 0n) throw new Error("The total must be above $0.");
      const s = await seal(details);
      const r = await createInvoice(id, {
        amountUnits: centsToUnits(totalCents(details)),
        dueMs: Date.parse(`${details.dueOn}T23:59:59Z`),
        splits: split && defaultSplits.length ? defaultSplits : null,
        sealed: s.sealed,
        digest: s.digest,
      });
      const invoiceId = Number(r.value);
      if (!Number.isFinite(invoiceId)) throw new Error("The contract did not return an invoice id.");
      vaultPut(invoiceId, { key: s.key, number: details.number, client: details.to.name, issuedOn: details.issuedOn, dueOn: details.dueOn });
      return { id: invoiceId, link: shareLink(invoiceId, s.key), hash: r.hash, details };
    },
    onSuccess: (r) => {
      setSent(r);
      window.scrollTo({ top: 0, behavior: "smooth" });
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });

  if (sent) return <Sent {...sent} />;

  if (!id)
    return (
      <div className="wrap page">
        <div className="page-head">
          <div>
            <h1>New invoice</h1>
            <p>First, a free NEAR account to send it from. Your browser holds the key; Nearvoice pays the gas.</p>
          </div>
        </div>
        <Onboard onDone={setId} />
      </div>
    );

  const setRow = (i: number, patch: Partial<Row>) => setRows((xs) => xs.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>New invoice</h1>
          <p>Draft it privately or fill it in, check the preview, then seal and send. The details are encrypted in this browser before anything is recorded.</p>
        </div>
      </div>
      <div className="pay-grid">
        <div className="stack" style={{ gap: 20 }}>
          <AiDraft
            onDraft={({ draft }) => {
              if (draft.client) setToName(draft.client);
              if (draft.items.length) setRows(draft.items.map((i) => ({ description: i.description, quantity: String(i.quantity), price: i.unitPrice.toFixed(2) })));
              if (draft.dueInDays && draft.dueInDays > 0 && draft.dueInDays < 366) setDueOn(isoDay(Date.now() + draft.dueInDays * DAY));
              if (draft.notes) setNotes(draft.notes);
            }}
          />
          <form
            className="panel stack"
            onSubmit={(e) => {
              e.preventDefault();
              send.mutate();
            }}
          >
            <div className="split-2">
              <label className="field">
                <span>From</span>
                <input value={fromName} onChange={(e) => setFromName(e.target.value)} maxLength={80} />
              </label>
              <label className="field">
                <span>Your email (optional)</span>
                <input type="email" value={fromEmail} onChange={(e) => setFromEmail(e.target.value)} maxLength={120} />
              </label>
              <label className="field">
                <span>Bill to</span>
                <input value={toName} onChange={(e) => setToName(e.target.value)} maxLength={80} placeholder="Client or company" />
              </label>
              <label className="field">
                <span>Client email (optional)</span>
                <input type="email" value={toEmail} onChange={(e) => setToEmail(e.target.value)} maxLength={120} />
              </label>
              <label className="field">
                <span>Invoice number</span>
                <input value={number} onChange={(e) => setNumber(e.target.value)} maxLength={40} />
              </label>
              <label className="field">
                <span>Due date</span>
                <input type="date" value={dueOn} min={isoDay(Date.now() + DAY)} onChange={(e) => setDueOn(e.target.value)} />
              </label>
            </div>

            <div className="field">
              <span>Lines</span>
              <div className="lines">
                <div className="line line-head" aria-hidden="true">
                  <span>Description</span>
                  <span>Qty</span>
                  <span>Price, $</span>
                  <span style={{ textAlign: "right" }}>Amount</span>
                  <span />
                </div>
                {rows.map((r, i) => {
                  let amt = "";
                  try {
                    amt = formatCents((BigInt(Math.round((Number(r.quantity) || 0) * 1000)) * parseCents(r.price || "0") + 500n) / 1000n);
                  } catch {
                    amt = "—";
                  }
                  return (
                    // biome-ignore lint/suspicious/noArrayIndexKey: editable rows, order is the identity
                    <div className="line" key={i}>
                      <input className="input" value={r.description} placeholder="What you did" aria-label={`Line ${i + 1} description`} onChange={(e) => setRow(i, { description: e.target.value })} maxLength={200} />
                      <input className="input" value={r.quantity} inputMode="decimal" aria-label={`Line ${i + 1} quantity`} onChange={(e) => setRow(i, { quantity: e.target.value })} />
                      <input className="input" value={r.price} inputMode="decimal" placeholder="0.00" aria-label={`Line ${i + 1} unit price in dollars`} onChange={(e) => setRow(i, { price: e.target.value })} />
                      <span className="total">{amt}</span>
                      <button type="button" className="x" aria-label={`Remove line ${i + 1}`} disabled={rows.length === 1} onClick={() => setRows((xs) => xs.filter((_, j) => j !== i))}>
                        ×
                      </button>
                    </div>
                  );
                })}
                <button type="button" className="btn btn--sm" style={{ alignSelf: "flex-start" }} disabled={rows.length >= 50} onClick={() => setRows((xs) => [...xs, blank()])}>
                  Add line
                </button>
              </div>
            </div>

            <label className="field">
              <span>Notes for the client (optional)</span>
              <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} style={{ minHeight: 80 }} />
            </label>

            {defaultSplits.length > 0 && (
              <label className="check">
                <input type="checkbox" checked={split} onChange={(e) => setSplit(e.target.checked)} />
                Split the payment: {defaultSplits.map((s) => `${handleOf(s.account_id)} ${s.bps / 100}%`).join(", ")}
              </label>
            )}

            {typeof details === "string" && (toName || rows.some((r) => r.price)) && <p className="err">{details}</p>}

            <div className="row" style={{ justifyContent: "space-between" }}>
              <span className="muted" style={{ fontSize: "var(--t-sm)" }}>
                Total <b className="mono" style={{ color: "var(--ink)", fontSize: "var(--t-lg)" }}>{total === null ? "—" : formatCents(total, { symbol: true })}</b> USDC
              </span>
              <button type="submit" className="btn btn--primary btn--lg" disabled={typeof details === "string" || send.isPending}>
                {send.isPending ? <Spinner label="Sealing and recording" /> : "Seal and send"}
              </button>
            </div>
          </form>
        </div>
        <div className="pay-box">
          {typeof details === "string" ? (
            <div className="paper empty">
              <h3>Your invoice appears here</h3>
              <p>Draft it in plain words or fill in the lines.</p>
            </div>
          ) : (
            <InvoicePaper details={details} />
          )}
          <p className="faint" style={{ fontSize: "var(--t-xs)", marginTop: 12 }}>
            Exactly what your client will see. Everyone else sees ciphertext.
          </p>
        </div>
      </div>
    </div>
  );
}
