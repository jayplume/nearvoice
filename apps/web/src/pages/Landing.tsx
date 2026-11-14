import type { InvoiceDetails } from "@nearvoice/core";
import { useQuery } from "@tanstack/react-query";
import { motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { InvoicePaper } from "../components/invoice";
import { getStats } from "../lib/chain";
import { REPO } from "../lib/config";
import { usdc } from "../lib/format";
import { Link } from "../lib/router";

const SAMPLE: InvoiceDetails = {
  v: 1,
  number: "NV-0042",
  from: { name: "Ada Okafor, product design" },
  to: { name: "Lumen Labs" },
  items: [
    { description: "Onboarding flow redesign", quantity: 4, unitCents: 45000 },
    { description: "Usability sessions, 6 participants", quantity: 1, unitCents: 60000 },
    { description: "Design QA, hours", quantity: 6.5, unitCents: 8000 },
  ],
  issuedOn: "2026-11-03",
  dueOn: "2026-11-17",
  currency: "USDC",
};

const STAGES = [
  { id: "written", label: "Written", caption: "What the freelancer and the client see." },
  { id: "sealed", label: "Sealed", caption: "What everyone else sees on chain: ciphertext and a fingerprint." },
  { id: "paid", label: "Paid", caption: "Paid in USDC, split to the team, recorded for the accountant." },
] as const;

function randomCipher() {
  const a = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
  const b = crypto.getRandomValues(new Uint8Array(420));
  return Array.from(b, (x) => a[x % 64]).join("");
}

function HeroInvoice() {
  const [stage, setStage] = useState(0);
  const [auto, setAuto] = useState(true);
  const reduce = useReducedMotion();
  const cipher = useMemo(randomCipher, []);
  useEffect(() => {
    if (!auto || reduce) return;
    const t = setInterval(() => setStage((s) => (s + 1) % STAGES.length), 3200);
    return () => clearInterval(t);
  }, [auto, reduce]);
  const s = STAGES[stage]!;
  return (
    <div className="hero-stage">
      <motion.div
        initial={reduce ? false : { opacity: 0, y: 40, rotateX: 14 }}
        animate={{ opacity: 1, y: 0, rotateX: 0 }}
        transition={{ duration: 0.9, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
      >
        <InvoicePaper details={SAMPLE} cipher={s.id === "sealed" ? cipher : null} stamp={s.id === "paid" ? "paid" : null} stampNote={s.id === "paid" ? "17 Nov · split 3 ways" : undefined} digest="9f2c4e71a0b3d58e6c1f04a7b92d3e5f8a6c0b1d2e3f405162738495a6b7c8d9" />
      </motion.div>
      <div className="hero-caption">
        <span aria-live="polite">{s.caption}</span>
        <fieldset className="hero-steps" aria-label="Invoice states">
          {STAGES.map((x, i) => (
            <button
              key={x.id}
              type="button"
              aria-pressed={i === stage}
              onClick={() => {
                setAuto(false);
                setStage(i);
              }}
            >
              {x.label}
            </button>
          ))}
        </fieldset>
      </div>
    </div>
  );
}

function LiveStats() {
  const q = useQuery({ queryKey: ["stats"], queryFn: getStats, refetchInterval: 20_000 });
  const cells = [
    { v: q.data ? String(q.data.invoices) : "…", l: "invoices on testnet" },
    { v: q.data ? String(q.data.paid) : "…", l: "paid through the contract" },
    { v: q.data ? usdc(q.data.volume_paid) : "…", l: "test USDC settled" },
    { v: "$0.00", l: "gas paid by freelancers" },
  ];
  return (
    <section className="live" aria-label="Live from the contract">
      <div className="live-inner">
        {cells.map((c) => (
          <div key={c.l} className="live-cell">
            <strong>{c.v}</strong>
            <span>{c.l}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

const SPLIT = [
  { who: "ada.nearvoice.testnet", pct: 80, color: "var(--brand)" },
  { who: "kofi.nearvoice.testnet", pct: 15, color: "var(--seal)" },
  { who: "tax-pot.nearvoice.testnet", pct: 5, color: "var(--paid)" },
];

const STACK = [
  { name: "NEAR AI Cloud", what: "A private model in an Intel TDX + NVIDIA enclave drafts the invoice. The browser checks the attestation and the enclave's signature on the answer.", href: "https://docs.near.ai/cloud/private-inference" },
  { name: "NEAR Intents · 1Click", what: "Live quotes for paying from Base, Arbitrum, Ethereum, Solana or NEAR USDT into exactly the invoice amount.", href: "https://docs.near-intents.org/near-intents/integration/distribution-channels/1click-api" },
  { name: "NEP-366 meta transactions", what: "Freelancers sign in the browser; a relayer pays the gas. They never buy NEAR.", href: "https://nomicon.io/Proposals/0366-signed-delegate-action" },
  { name: "NEP-141 · ft_transfer_call", what: "Payment and invoice settle in one transaction; the contract checks the amount and splits it.", href: "https://nomicon.io/Standards/Tokens/FungibleToken/Core" },
  { name: "Web Crypto AES-256-GCM", what: "Invoice details are encrypted before they leave the browser; the key travels only in the link.", href: "https://developer.mozilla.org/docs/Web/API/SubtleCrypto/encrypt" },
  { name: "NEAR Wallet Selector", what: "Clients pay with Meteor, Intear, HERE or Sender.", href: "https://github.com/near/wallet-selector" },
];

export function Landing() {
  const reduce = useReducedMotion();
  const rise = (d: number) => (reduce ? {} : { initial: { opacity: 0, y: 18 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.7, ease: [0.22, 1, 0.36, 1] as const, delay: d } });
  return (
    <>
      <section className="hero">
        <div className="wrap hero-grid">
          <div>
            <h1 className="hero-title">
              <motion.span className="line" {...rise(0)}>
                Invoices only
              </motion.span>
              <motion.span className="line" {...rise(0.08)}>
                your client can read.
              </motion.span>
              <motion.span className="line" style={{ color: "var(--paid)" }} {...rise(0.16)}>
                Paid in USDC.
              </motion.span>
            </h1>
            <motion.p className="hero-sub" {...rise(0.28)}>
              Describe the work in plain words. A private AI drafts the invoice inside a verified enclave, your browser encrypts it, and the client pays from their wallet. The money splits to your
              team on arrival, and you never touch gas.
            </motion.p>
            <motion.div className="hero-cta" {...rise(0.36)}>
              <Link to="/app/new" className="btn btn--primary btn--lg">
                Write an invoice
              </Link>
              <Link to="/verify" className="btn btn--lg">
                Check the privacy proof
              </Link>
            </motion.div>
            <motion.div className="hero-facts" {...rise(0.44)}>
              <span>
                <i /> Live on NEAR testnet
              </span>
              <span>No sign-up, no seed phrase</span>
              <span>Open source</span>
            </motion.div>
          </div>
          <HeroInvoice />
        </div>
      </section>

      <LiveStats />

      <section className="section wrap" id="how">
        <div className="section-head">
          <h2>From a note to money in three steps</h2>
          <p>Nothing to install for either side. The freelancer gets an account in one click; the client uses the wallet they already have.</p>
        </div>
        <div className="flow">
          <div className="flow-step">
            <span className="n">1</span>
            <h3>Write it the way you'd say it</h3>
            <p>"4 days on the onboarding redesign at $450, plus the usability sessions." The private model turns it into lines you can edit.</p>
            <p className="who">Freelancer · gas paid by Nearvoice</p>
          </div>
          <div className="flow-step">
            <span className="n">2</span>
            <h3>Seal it and send the link</h3>
            <p>Your browser encrypts the details. The chain stores ciphertext, the amount and a fingerprint. The key lives in the link you send.</p>
            <p className="who">Freelancer · one relayed transaction</p>
          </div>
          <div className="flow-step">
            <span className="n">3</span>
            <h3>The client pays, the team gets paid</h3>
            <p>One wallet transaction pays the exact amount. The contract marks the invoice paid and splits the money to every recipient.</p>
            <p className="who">Client · any NEAR wallet, or any chain via Intents</p>
          </div>
        </div>
      </section>

      <section className="section wrap">
        <div className="section-head">
          <h2>Built for how freelancers actually get paid</h2>
          <p>Private enough for client work, strict enough for your accountant, simple enough that the client pays the same day.</p>
        </div>
        <div className="pillars">
          <div className="pillar pillar--seal">
            <span className="chip chip--seal">Private</span>
            <h3 style={{ marginTop: 14 }}>Your rates stay between you and the client</h3>
            <p>Public chains publish everything. Nearvoice publishes almost nothing.</p>
            <ul>
              <li>Line items, names and notes are AES-256 encrypted in your browser</li>
              <li>The drafting model runs in a TEE, and your browser verifies the attestation itself</li>
              <li>The client checks the decrypted invoice against the fingerprint on chain</li>
            </ul>
          </div>
          <div className="pillar">
            <span className="chip chip--open">Business</span>
            <h3 style={{ marginTop: 14 }}>Rules you set, enforced by the contract</h3>
            <p>The contract refuses wrong amounts and pays out the way you agreed.</p>
            <ul>
              <li>Pays exactly the invoice amount; any extra goes straight back</li>
              <li>A per-invoice limit and a pause switch for your account</li>
              <li>Refunds go back to the payer through the contract</li>
              <li>One-click CSV export for your accountant</li>
            </ul>
          </div>
          <div className="pillar pillar--wide">
            <div>
              <span className="chip chip--paid">Real world</span>
              <h3 style={{ marginTop: 14 }}>Paid as a team, the moment it lands</h3>
              <p>Agencies and collectives split every invoice. Set the shares once; the contract pays each person in the same transaction as the client's payment.</p>
              <ul>
                <li>Up to 5 recipients, in basis points, with exact rounding</li>
                <li>A failed payout is held for that person to claim, never lost</li>
              </ul>
            </div>
            <div className="split-demo" aria-label="Example split of a $2,920 invoice">
              <div className="split-bar">
                {SPLIT.map((s, i) => (
                  <motion.div
                    key={s.who}
                    style={{ background: s.color }}
                    initial={reduce ? false : { width: 0 }}
                    whileInView={{ width: `${s.pct}%` }}
                    viewport={{ once: true, amount: 0.6 }}
                    transition={{ duration: 0.9, delay: 0.15 * i, ease: [0.22, 1, 0.36, 1] }}
                  >
                    {s.pct}%
                  </motion.div>
                ))}
              </div>
              <div className="split-legend">
                {SPLIT.map((s) => (
                  <div key={s.who}>
                    <span>
                      <span style={{ display: "inline-block", width: 10, height: 10, borderRadius: 3, background: s.color, marginRight: 8 }} />
                      {s.who}
                    </span>
                    <span>{usdc(BigInt(Math.round(2920 * s.pct * 100)) * 100n)}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="section wrap">
        <div className="section-head">
          <h2>What it's built on</h2>
          <p>Open standards and open-source tools from the NEAR ecosystem. Every claim on this page can be checked in the code or on the explorer.</p>
        </div>
        <div className="stack-list">
          {STACK.map((s) => (
            <div key={s.name} className="stack-item">
              <h4>{s.name}</h4>
              <p>{s.what}</p>
              <a href={s.href} target="_blank" rel="noreferrer">
                Read the spec
              </a>
            </div>
          ))}
        </div>
      </section>

      <section className="section wrap">
        <div className="cta-band">
          <h2>Send your first private invoice in under a minute.</h2>
          <div className="row">
            <Link to="/app/new" className="btn btn--lg">
              Write an invoice
            </Link>
            <a href={REPO} className="btn btn--lg btn--ghost" target="_blank" rel="noreferrer">
              Read the code
            </a>
          </div>
        </div>
      </section>
    </>
  );
}
