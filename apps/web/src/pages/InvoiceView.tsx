import { type Opened, open } from "@nearvoice/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useState } from "react";
import { InvoicePaper, LockIcon, QuotePanel } from "../components/invoice";
import { Spinner, StatusChip, TxLink, useToast } from "../components/parts";
import { type ChainInvoice, type Split, faucetReadyAt, getInvoice, usdcBalance } from "../lib/chain";
import { INVOICES, accountUrl } from "../lib/config";
import { date, short, usdc } from "../lib/format";
import { cancelInvoice, loadIdentity, refund } from "../lib/freelancer";
import { Link } from "../lib/router";
import { WALLETS, connect, connectedAccount, disconnect, payInvoice, takeTestUsdc } from "../lib/wallet";

/** The same arithmetic as the contract's split_amounts: floor each share, the remainder to the first recipient. */
export function splitAmounts(amount: bigint, splits: Split[], issuer: string): { account_id: string; bps: number; amount: bigint }[] {
  const list = splits.length ? splits : [{ account_id: issuer, bps: 10_000 }];
  const out = list.map((s) => ({ ...s, amount: (amount * BigInt(s.bps)) / 10_000n }));
  const rest = amount - out.reduce((a, s) => a + s.amount, 0n);
  out[0]!.amount += rest;
  return out;
}

function Timeline({ inv }: { inv: ChainInvoice }) {
  const steps = [
    { on: true, label: "Sealed and recorded on NEAR", when: date(inv.created_ms) },
    { on: inv.status === "paid" || inv.status === "refunded", label: inv.payer ? `Paid by ${short(inv.payer)}` : "Paid", when: inv.paid_ms ? date(inv.paid_ms) : `due ${date(inv.due_ms)}` },
    ...(inv.status === "cancelled" ? [{ on: true, label: "Cancelled by the sender", when: inv.closed_ms ? date(inv.closed_ms) : "" }] : []),
    ...(inv.status === "refunded" ? [{ on: true, label: "Refunded to the payer", when: inv.closed_ms ? date(inv.closed_ms) : "" }] : []),
  ];
  return (
    <ol className="timeline">
      {steps.map((s) => (
        <li key={s.label} className={s.on ? "on" : ""}>
          {s.label}
          <small>{s.when}</small>
        </li>
      ))}
    </ol>
  );
}

function SplitTable({ inv }: { inv: ChainInvoice }) {
  const parts = splitAmounts(BigInt(inv.amount), inv.splits, inv.issuer);
  return (
    <dl className="kv">
      {parts.map((p) => (
        <div key={p.account_id} style={{ display: "contents" }}>
          <dt>
            <a href={accountUrl(p.account_id)} target="_blank" rel="noreferrer">
              {short(p.account_id)}
            </a>{" "}
            <span className="faint">{p.bps / 100}%</span>
          </dt>
          <dd className="mono">{usdc(p.amount)}</dd>
        </div>
      ))}
    </dl>
  );
}

function PayBox({ inv, onPaid }: { inv: ChainInvoice; onPaid: (hash: string) => void }) {
  const toast = useToast();
  const qc = useQueryClient();
  const who = useQuery({ queryKey: ["wallet"], queryFn: connectedAccount });
  const account = who.data ?? null;
  const bal = useQuery({ queryKey: ["bal", account], queryFn: () => usdcBalance(account!), enabled: !!account, refetchInterval: 10_000 });
  const ready = useQuery({ queryKey: ["faucet", account], queryFn: () => faucetReadyAt(account!), enabled: !!account });
  const amount = BigInt(inv.amount);
  const short_ = bal.data !== undefined && bal.data < amount;

  const link = useMutation({
    mutationFn: (walletId: string) => connect(walletId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["wallet"] }),
    onError: (e: Error) => toast(`Wallet: ${e.message}`, "bad"),
  });
  const faucet = useMutation({
    mutationFn: takeTestUsdc,
    onSuccess: (h) => {
      toast(
        <>
          1,000 test USDC added. <TxLink hash={h} />
        </>,
        "good",
      );
      qc.invalidateQueries({ queryKey: ["bal", account] });
      qc.invalidateQueries({ queryKey: ["faucet", account] });
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const pay = useMutation({
    mutationFn: () => payInvoice(inv.id, amount),
    onSuccess: (h) => {
      onPaid(h);
      qc.invalidateQueries({ queryKey: ["invoice", inv.id] });
      qc.invalidateQueries({ queryKey: ["bal", account] });
    },
    onError: (e: Error) => toast(`Payment failed: ${e.message}`, "bad"),
  });

  return (
    <div className="stack">
      {!account ? (
        <>
          <p className="muted" style={{ fontSize: "var(--t-sm)" }}>
            Connect a NEAR testnet wallet to pay.
          </p>
          <div className="wallets">
            {WALLETS.map((w) => (
              <button key={w.id} type="button" className="btn" disabled={link.isPending} onClick={() => link.mutate(w.id)}>
                {w.label}
              </button>
            ))}
          </div>
          {link.isPending && <Spinner label="Waiting for the wallet" />}
        </>
      ) : (
        <>
          <dl className="kv">
            <dt>Paying from</dt>
            <dd className="mono">{short(account)}</dd>
            <dt>Your test USDC</dt>
            <dd className="mono">{bal.data === undefined ? "…" : usdc(bal.data)}</dd>
          </dl>
          {short_ && (
            <div className="notice notice--due">
              Not enough test USDC.{" "}
              {ready.data && ready.data > Date.now() ? (
                `The faucet refills at ${new Date(ready.data).toLocaleTimeString()}.`
              ) : (
                <button type="button" className="btn btn--sm" style={{ marginLeft: 6 }} disabled={faucet.isPending} onClick={() => faucet.mutate()}>
                  {faucet.isPending ? "Asking the faucet…" : "Get 1,000 test USDC"}
                </button>
              )}
            </div>
          )}
          <button type="button" className="btn btn--paid btn--lg" disabled={pay.isPending || short_ || bal.data === undefined} onClick={() => pay.mutate()}>
            {pay.isPending ? <Spinner label="Confirm in your wallet" /> : `Pay ${usdc(amount)}`}
          </button>
          <p className="faint" style={{ fontSize: "var(--t-xs)" }}>
            One transaction: USDC goes to the invoice contract with this invoice's id, the contract checks the amount, marks it paid and pays each recipient.
          </p>
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            style={{ alignSelf: "flex-start" }}
            onClick={async () => {
              await disconnect();
              qc.invalidateQueries({ queryKey: ["wallet"] });
            }}
          >
            Use another wallet
          </button>
        </>
      )}
      <QuotePanel amountUnits={amount} />
    </div>
  );
}

function IssuerActions({ inv }: { inv: ChainInvoice }) {
  const me = loadIdentity();
  const toast = useToast();
  const qc = useQueryClient();
  const cancel = useMutation({
    mutationFn: () => cancelInvoice(me!, inv.id),
    onSuccess: (r) => {
      toast(
        <>
          Invoice cancelled. <TxLink hash={r.hash} />
        </>,
        "good",
      );
      qc.invalidateQueries({ queryKey: ["invoice", inv.id] });
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const back = useMutation({
    mutationFn: () => refund(me!, inv.id, BigInt(inv.amount)),
    onSuccess: (h) => {
      toast(
        <>
          Refund sent to {short(inv.payer ?? "")}. <TxLink hash={h} />
        </>,
        "good",
      );
      qc.invalidateQueries({ queryKey: ["invoice", inv.id] });
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  if (!me || me.accountId !== inv.issuer) return null;
  if (inv.status === "open")
    return (
      <button type="button" className="btn btn--danger btn--sm" disabled={cancel.isPending} onClick={() => window.confirm(`Cancel invoice #${inv.id}? The client will no longer be able to pay it.`) && cancel.mutate()}>
        {cancel.isPending ? "Cancelling…" : "Cancel this invoice"}
      </button>
    );
  if (inv.status === "paid")
    return (
      <button type="button" className="btn btn--danger btn--sm" disabled={back.isPending} onClick={() => window.confirm(`Refund ${usdc(inv.amount)} to ${inv.payer}? It comes from your balance.`) && back.mutate()}>
        {back.isPending ? "Refunding…" : "Refund the client"}
      </button>
    );
  return null;
}

export function InvoiceView({ id }: { id: number }) {
  const key = new URLSearchParams(window.location.hash.slice(1)).get("k");
  const [paidHash, setPaidHash] = useState<string | null>(null);
  const inv = useQuery({
    queryKey: ["invoice", id],
    queryFn: () => getInvoice(id),
    refetchInterval: (q) => (q.state.data?.status === "open" ? 6_000 : false),
  });
  const opened = useQuery<Opened | null>({
    queryKey: ["open", id, key, inv.data?.digest],
    enabled: !!inv.data && !!key,
    retry: false,
    queryFn: () => open(inv.data!.sealed, key!, inv.data!.digest),
  });

  if (inv.isLoading) return <div className="wrap page"><Spinner label={`Reading invoice #${id} from NEAR`} /></div>;
  if (inv.error) return <div className="wrap page"><p className="err">Could not read the contract: {(inv.error as Error).message}</p></div>;
  const data = inv.data;
  if (!data)
    return (
      <div className="wrap page empty">
        <h3>There is no invoice #{id}</h3>
        <p>Check the link you were sent.</p>
      </div>
    );

  const stamp = data.status === "paid" ? "paid" : data.status === "cancelled" || data.status === "refunded" ? "void" : null;
  const stampNote = data.status === "paid" && data.paid_ms ? date(data.paid_ms) : data.status === "refunded" ? "refunded" : undefined;

  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <div className="row" style={{ marginBottom: 10 }}>
            <StatusChip status={data.status} />
            <span className="faint mono" style={{ fontSize: "var(--t-xs)" }}>
              invoice #{data.id} on{" "}
              <a href={accountUrl(INVOICES)} target="_blank" rel="noreferrer">
                {INVOICES}
              </a>
            </span>
          </div>
          <h1>{opened.data ? `${opened.data.details.number} for ${opened.data.details.to.name}` : `Invoice #${data.id}`}</h1>
          <p>
            From <b>{opened.data?.details.from.name ?? short(data.issuer)}</b> · {usdc(data.amount)} in USDC · due {date(data.due_ms)}
          </p>
        </div>
        <IssuerActions inv={data} />
      </div>

      <div className="pay-grid">
        <div className="stack">
          {opened.data ? (
            <>
              <InvoicePaper details={opened.data.details} stamp={stamp} stampNote={stampNote} digest={data.digest} id={data.id} />
              <div className={`notice ${opened.data.matchesChain ? "notice--seal" : "notice--due"}`}>
                {opened.data.matchesChain
                  ? "Decrypted in your browser with the key in this link. Its fingerprint matches the one recorded on chain, so this is exactly what was issued."
                  : "Warning: these details do not match the fingerprint recorded on chain. Do not pay; ask the sender for a new link."}
              </div>
            </>
          ) : (
            <div className="paper" style={{ minHeight: 360 }}>
              <div className="cipher" style={{ position: "absolute" }}>
                {data.sealed.repeat(3).slice(0, 2400)}
                <span className="cipher-lock">
                  <LockIcon /> {key ? (opened.isLoading ? "Decrypting…" : "This link's key does not open the invoice") : "Sealed: open it with the full link"}
                </span>
              </div>
            </div>
          )}
          <section className="panel">
            <h2 style={{ fontSize: "var(--t-md)", marginBottom: 14 }}>What the public chain shows</h2>
            <dl className="kv">
              <dt>Amount</dt>
              <dd className="mono">{usdc(data.amount)}</dd>
              <dt>Details</dt>
              <dd className="mono sealed-blob" style={{ maxWidth: "none" }}>
                {data.sealed.slice(0, 48)}… ({data.sealed.length} chars of ciphertext)
              </dd>
              <dt>Fingerprint</dt>
              <dd className="mono">{data.digest.slice(0, 32)}…</dd>
              <dt>Issuer</dt>
              <dd className="mono">{short(data.issuer)}</dd>
            </dl>
          </section>
        </div>

        <aside className="pay-box stack">
          <section className="panel stack">
            <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
              {data.status === "open" ? "Amount due" : "Invoice amount"}
            </span>
            <div className="pay-amount">{usdc(data.amount)}</div>
            {data.status === "open" ? (
              <PayBox inv={data} onPaid={setPaidHash} />
            ) : data.status === "paid" ? (
              <motion.div className="stack" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
                <p style={{ color: "var(--paid)", fontWeight: 600 }}>Paid{data.paid_ms ? ` on ${date(data.paid_ms)}` : ""}. Thank you.</p>
                {paidHash && (
                  <p style={{ fontSize: "var(--t-sm)" }}>
                    Your receipt: <TxLink hash={paidHash}>{paidHash}</TxLink>
                  </p>
                )}
              </motion.div>
            ) : (
              <p className="muted">This invoice is {data.status} and cannot be paid.</p>
            )}
          </section>
          <section className="panel">
            <h2 style={{ fontSize: "var(--t-md)", marginBottom: 14 }}>Where the money goes</h2>
            <SplitTable inv={data} />
          </section>
          <section className="panel">
            <h2 style={{ fontSize: "var(--t-md)", marginBottom: 14 }}>History</h2>
            <Timeline inv={data} />
          </section>
          <Link to="/verify" className="faint" style={{ fontSize: "var(--t-xs)" }}>
            How the privacy works
          </Link>
        </aside>
      </div>
    </div>
  );
}
