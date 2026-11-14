import { centsToUnits, parseCents, toCsv, unitsToCents, validHandle } from "@nearvoice/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState } from "react";
import { Spinner, StatusChip, TxLink, useToast } from "../components/parts";
import { type ChainInvoice, type Split, accountExists, getProfile, listByIssuer, usdcBalance, view } from "../lib/chain";
import { INVOICES, SUFFIX, USDC, accountUrl } from "../lib/config";
import { ago, date, isoDay, short, usdc } from "../lib/format";
import { type Identity, backupFile, forgetIdentity, loadIdentity, onboard, restore, setProfile } from "../lib/freelancer";
import { Link } from "../lib/router";
import { vaultAll, vaultGet } from "../lib/vault";

function download(blob: Blob, name: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function useIdentity() {
  const [id, setId] = useState<Identity | null>(() => loadIdentity());
  useEffect(() => {
    const on = () => setId(loadIdentity());
    window.addEventListener("storage", on);
    return () => window.removeEventListener("storage", on);
  }, []);
  return [id, setId] as const;
}

/** One click to a NEAR account: the key is made here, the account is created and funded by Nearvoice. */
export function Onboard({ onDone }: { onDone: (id: Identity) => void }) {
  const toast = useToast();
  const [handle, setHandle] = useState("");
  const [taken, setTaken] = useState<boolean | null>(null);
  const valid = validHandle(handle);
  useEffect(() => {
    setTaken(null);
    if (!valid) return;
    const t = setTimeout(() => accountExists(`${handle}.${SUFFIX}`).then(setTaken), 350);
    return () => clearTimeout(t);
  }, [handle, valid]);
  const create = useMutation({
    mutationFn: () => onboard(handle),
    onSuccess: (r) => {
      toast(
        <>
          Account <b>{r.accountId}</b> created. <TxLink hash={r.hash}>See the transaction</TxLink>
        </>,
        "good",
      );
      onDone(r);
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  const restoreFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      onDone(await restore(await f.text()));
      toast("Account restored from your backup.", "good");
    } catch (e) {
      toast((e as Error).message, "bad");
    }
  };
  return (
    <div className="panel" style={{ maxWidth: 560 }}>
      <h2>Get your invoicing account</h2>
      <p className="muted" style={{ marginTop: 8, fontSize: "var(--t-sm)" }}>
        Pick a name. Your browser makes the key; Nearvoice creates the NEAR account and pays its gas from then on. No seed phrase, no NEAR to buy.
      </p>
      <form
        className="stack"
        style={{ marginTop: 20 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (valid && taken === false) create.mutate();
        }}
      >
        <label className="field">
          <span>Your name on NEAR</span>
          <div className="input-affix">
            <input value={handle} onChange={(e) => setHandle(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))} placeholder="ada" autoComplete="off" spellCheck={false} maxLength={32} aria-describedby="handle-help" />
            <span>.{SUFFIX}</span>
          </div>
          <small id="handle-help">
            {!handle
              ? "3 to 32 lowercase letters, digits or hyphens."
              : !valid
                ? "Use 3 to 32 lowercase letters, digits or single hyphens."
                : taken === null
                  ? "Checking…"
                  : taken
                    ? `${handle}.${SUFFIX} is taken. Try another.`
                    : `${handle}.${SUFFIX} is free.`}
          </small>
        </label>
        <button type="submit" className="btn btn--primary" disabled={!valid || taken !== false || create.isPending}>
          {create.isPending ? <Spinner label="Creating your account on NEAR" /> : "Create my account"}
        </button>
      </form>
      <label className="dropzone" style={{ display: "block", marginTop: 18, cursor: "pointer" }}>
        Already have one? <u>Restore from your backup file</u>
        <input type="file" accept="application/json" className="sr-only" onChange={(e) => restoreFile(e.target.files?.[0])} />
      </label>
    </div>
  );
}

function InvoiceRow({ inv }: { inv: ChainInvoice }) {
  const v = vaultGet(inv.id);
  const to = v ? `/i/${inv.id}#k=${v.key}` : `/i/${inv.id}`;
  return (
    <Link to={to} className="inv-row">
      <span className="id">#{inv.id}</span>
      <span className="what">
        <b>{v ? `${v.client} · ${v.number}` : "Sealed invoice (key not in this browser)"}</b>
        <small>
          {inv.status === "paid" && inv.paid_ms ? `paid ${ago(inv.paid_ms)} by ${short(inv.payer ?? "")}` : `due ${date(inv.due_ms)} · created ${ago(inv.created_ms)}`}
        </small>
      </span>
      <StatusChip status={inv.status} />
      <span className="amt">{usdc(inv.amount)}</span>
    </Link>
  );
}

const FILTERS = ["all", "open", "paid", "closed"] as const;

function Invoices({ id }: { id: Identity }) {
  const q = useQuery({ queryKey: ["issued", id.accountId], queryFn: () => listByIssuer(id.accountId), refetchInterval: 15_000 });
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("all");
  const list = useMemo(() => {
    const xs = [...(q.data ?? [])].sort((a, b) => b.id - a.id);
    if (filter === "all") return xs;
    if (filter === "closed") return xs.filter((x) => x.status === "cancelled" || x.status === "refunded");
    return xs.filter((x) => x.status === filter);
  }, [q.data, filter]);
  const exportCsv = () => {
    const vault = vaultAll();
    const csv = toCsv(
      (q.data ?? []).map((inv) => {
        const v = vault[String(inv.id)];
        return {
          number: v?.number ?? `#${inv.id}`,
          client: v?.client ?? "",
          issuedOn: v?.issuedOn ?? isoDay(inv.created_ms),
          dueOn: v?.dueOn ?? isoDay(inv.due_ms),
          paidOn: inv.paid_ms ? isoDay(inv.paid_ms) : "",
          amountCents: unitsToCents(BigInt(inv.amount)),
          currency: "USDC",
          status: inv.status,
          payer: inv.payer ?? "",
          proof: `${accountUrl(INVOICES)} invoice #${inv.id}`,
        };
      }),
    );
    download(new Blob([csv], { type: "text/csv" }), `nearvoice-${id.accountId.split(".")[0]}-${isoDay(Date.now())}.csv`);
  };
  return (
    <section className="panel">
      <div className="panel-head">
        <h2>Invoices</h2>
        <div className="row">
          <div className="tabs" role="tablist" aria-label="Filter invoices">
            {FILTERS.map((f) => (
              <button key={f} type="button" role="tab" aria-selected={filter === f} onClick={() => setFilter(f)}>
                {f[0]!.toUpperCase() + f.slice(1)}
              </button>
            ))}
          </div>
          <button type="button" className="btn btn--sm" onClick={exportCsv} disabled={!q.data?.length}>
            Export CSV
          </button>
        </div>
      </div>
      {q.isLoading ? (
        <Spinner label="Reading your invoices from NEAR" />
      ) : q.error ? (
        <p className="err">Could not read the contract: {(q.error as Error).message}</p>
      ) : list.length === 0 ? (
        <div className="empty">
          <h3>{filter === "all" ? "No invoices yet" : `No ${filter} invoices`}</h3>
          <p>Describe the work in a sentence and send your first invoice.</p>
          <Link to="/app/new" className="btn btn--primary">
            Write an invoice
          </Link>
        </div>
      ) : (
        <div className="inv-list">
          <AnimatePresence initial={false}>
            {list.map((inv) => (
              <motion.div key={inv.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <InvoiceRow inv={inv} />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </section>
  );
}

function Totals({ id }: { id: Identity }) {
  const issued = useQuery({ queryKey: ["issued", id.accountId], queryFn: () => listByIssuer(id.accountId) });
  const bal = useQuery({ queryKey: ["bal", id.accountId], queryFn: () => usdcBalance(id.accountId), refetchInterval: 15_000 });
  const claim = useQuery({ queryKey: ["claim", id.accountId], queryFn: () => view<string>(INVOICES, "get_claimable", { account_id: id.accountId, token: USDC }) });
  const xs = issued.data ?? [];
  const sum = (s: string) => xs.filter((x) => x.status === s).reduce((a, x) => a + BigInt(x.amount), 0n);
  return (
    <section className="panel">
      <span className="faint" style={{ fontSize: "var(--t-xs)" }}>
        Balance
      </span>
      <div className="bal">{bal.data === undefined ? "…" : usdc(bal.data)}</div>
      <dl className="kv" style={{ marginTop: 18 }}>
        <dt>Waiting on clients</dt>
        <dd className="mono">{usdc(sum("open"))}</dd>
        <dt>Paid to you and your team</dt>
        <dd className="mono">{usdc(sum("paid"))}</dd>
        {claim.data && BigInt(claim.data) > 0n && (
          <>
            <dt>Held for you to claim</dt>
            <dd className="mono">{usdc(claim.data)}</dd>
          </>
        )}
        <dt>Account</dt>
        <dd className="mono">
          <a href={accountUrl(id.accountId)} target="_blank" rel="noreferrer">
            View on NearBlocks
          </a>
        </dd>
      </dl>
    </section>
  );
}

function Settings({ id }: { id: Identity }) {
  const toast = useToast();
  const qc = useQueryClient();
  const profile = useQuery({ queryKey: ["profile", id.accountId], queryFn: () => getProfile(id.accountId) });
  const [name, setName] = useState("");
  const [splits, setSplits] = useState<{ account_id: string; pct: string }[]>([]);
  const [paused, setPaused] = useState(false);
  const [limit, setLimit] = useState("");
  useEffect(() => {
    const p = profile.data;
    if (!p) return;
    setName(p.name);
    setSplits(p.default_splits.map((s: Split) => ({ account_id: s.account_id, pct: String(s.bps / 100) })));
    setPaused(p.paused);
    setLimit(p.max_invoice === "0" ? "" : String(Number(unitsToCents(BigInt(p.max_invoice))) / 100));
  }, [profile.data]);
  const bpsTotal = splits.reduce((a, s) => a + Math.round(Number(s.pct) * 100 || 0), 0);
  const save = useMutation({
    mutationFn: async () => {
      if (splits.length && bpsTotal !== 10_000) throw new Error("Shares must add up to 100%.");
      return setProfile(id, {
        name: name.trim(),
        default_splits: splits.map((s) => ({ account_id: s.account_id.trim(), bps: Math.round(Number(s.pct) * 100) })),
        paused,
        max_invoice: limit.trim() ? centsToUnits(parseCents(limit)).toString() : "0",
      });
    },
    onSuccess: (r) => {
      toast(
        <>
          Settings saved on chain, gas paid by Nearvoice. <TxLink hash={r.hash} />
        </>,
        "good",
      );
      qc.invalidateQueries({ queryKey: ["profile", id.accountId] });
    },
    onError: (e: Error) => toast(e.message, "bad"),
  });
  return (
    <section className="panel">
      <h2>Business settings</h2>
      <p className="muted" style={{ fontSize: "var(--t-xs)", marginTop: 6 }}>
        Stored in the invoice contract and enforced by it.
      </p>
      <div className="stack" style={{ marginTop: 16 }}>
        <label className="field">
          <span>Business name</span>
          <input value={name} maxLength={64} onChange={(e) => setName(e.target.value)} placeholder="Ada Okafor Studio" />
        </label>
        <div className="field">
          <span>Default payout split</span>
          <div className="splits">
            {splits.map((s, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: editable rows, order is the identity
              <div className="split-row" key={i}>
                <input className="input" value={s.account_id} placeholder="kofi.nearvoice.testnet" aria-label="Recipient account" onChange={(e) => setSplits((xs) => xs.map((x, j) => (j === i ? { ...x, account_id: e.target.value } : x)))} />
                <div className="input-affix">
                  <input value={s.pct} inputMode="decimal" aria-label="Share in percent" onChange={(e) => setSplits((xs) => xs.map((x, j) => (j === i ? { ...x, pct: e.target.value } : x)))} />
                  <span>%</span>
                </div>
                <button type="button" className="icon-btn" aria-label="Remove recipient" onClick={() => setSplits((xs) => xs.filter((_, j) => j !== i))}>
                  ×
                </button>
              </div>
            ))}
            <div className="row" style={{ justifyContent: "space-between" }}>
              <button type="button" className="btn btn--sm" disabled={splits.length >= 5} onClick={() => setSplits((xs) => (xs.length ? [...xs, { account_id: "", pct: "" }] : [{ account_id: id.accountId, pct: "100" }]))}>
                Add recipient
              </button>
              <small className={splits.length && bpsTotal !== 10_000 ? "err" : "faint"}>{splits.length ? `${bpsTotal / 100}% of 100%` : "Empty: 100% to you"}</small>
            </div>
          </div>
        </div>
        <label className="field">
          <span>Largest invoice allowed</span>
          <div className="input-affix">
            <span>$</span>
            <input value={limit} inputMode="decimal" onChange={(e) => setLimit(e.target.value)} placeholder="No limit" />
          </div>
          <small>A guard against typos: the contract refuses invoices above it.</small>
        </label>
        <label className="check">
          <input type="checkbox" checked={paused} onChange={(e) => setPaused(e.target.checked)} />
          Pause invoicing (new invoices and payments are refused)
        </label>
        <button type="button" className="btn btn--primary" onClick={() => save.mutate()} disabled={save.isPending || profile.isLoading}>
          {save.isPending ? <Spinner label="Saving on chain" /> : "Save settings"}
        </button>
      </div>
    </section>
  );
}

export function Dashboard() {
  const [id, setId] = useIdentity();
  const toast = useToast();
  if (!id)
    return (
      <div className="wrap page">
        <div className="page-head">
          <div>
            <h1>Your invoices</h1>
            <p>Create a free NEAR account to start sending invoices. It takes about five seconds.</p>
          </div>
        </div>
        <Onboard onDone={setId} />
      </div>
    );
  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>Your invoices</h1>
          <p>
            Signed in as <b className="mono">{id.accountId}</b>. Every action here is a NEAR transaction; Nearvoice pays the gas.
          </p>
        </div>
        <div className="row">
          <button
            type="button"
            className="btn btn--sm"
            onClick={() => {
              download(backupFile(id), `nearvoice-backup-${id.accountId.split(".")[0]}.json`);
              toast("Backup saved. Keep it safe: it holds your account key and every invoice key.", "info");
            }}
          >
            Download backup
          </button>
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => {
              if (window.confirm("Sign out of this browser? Without your backup file you cannot get this account back.")) {
                forgetIdentity();
                setId(null);
              }
            }}
          >
            Sign out
          </button>
          <Link to="/app/new" className="btn btn--primary btn--sm">
            New invoice
          </Link>
        </div>
      </div>
      <div className="app-grid">
        <Invoices id={id} />
        <div className="stack">
          <Totals id={id} />
          <Settings id={id} />
        </div>
      </div>
    </div>
  );
}
