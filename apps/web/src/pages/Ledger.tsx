import { useQuery } from "@tanstack/react-query";
import { Spinner, StatusChip } from "../components/parts";
import { getStats, listRecent } from "../lib/chain";
import { INVOICES, accountUrl } from "../lib/config";
import { ago, short, usdc } from "../lib/format";
import { Link } from "../lib/router";

/** Everything anyone can see: the contract's public record, read straight from NEAR. */
export function Ledger() {
  const recent = useQuery({ queryKey: ["recent"], queryFn: () => listRecent(50), refetchInterval: 15_000 });
  const stats = useQuery({ queryKey: ["stats"], queryFn: getStats, refetchInterval: 15_000 });
  const s = stats.data;
  return (
    <div className="wrap page">
      <div className="page-head">
        <div>
          <h1>Public ledger</h1>
          <p>
            Every invoice in{" "}
            <a href={accountUrl(INVOICES)} target="_blank" rel="noreferrer">
              {INVOICES}
            </a>
            , read live from NEAR testnet. This is all a stranger can see: amounts, accounts and status, with the details sealed.
          </p>
        </div>
      </div>
      <div className="live" style={{ borderRadius: "var(--r-lg)", border: "1px solid var(--rule)", marginBottom: 24 }}>
        <div className="live-inner" style={{ padding: "0 24px" }}>
          {[
            { v: s?.invoices, l: "invoices" },
            { v: s?.open, l: "open" },
            { v: s?.paid, l: "paid" },
            { v: s ? usdc(s.volume_paid) : undefined, l: "settled" },
          ].map((c) => (
            <div className="live-cell" key={c.l}>
              <strong>{c.v ?? "…"}</strong>
              <span>{c.l}</span>
            </div>
          ))}
        </div>
      </div>
      <section className="panel">
        {recent.isLoading ? (
          <Spinner label="Reading the contract" />
        ) : recent.error ? (
          <p className="err">{(recent.error as Error).message}</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Issuer</th>
                  <th className="r">Amount</th>
                  <th>Status</th>
                  <th>Details on chain</th>
                  <th>Recipients</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {recent.data?.map((inv) => (
                  <tr key={inv.id}>
                    <td className="mono">
                      <Link to={`/i/${inv.id}`}>{inv.id}</Link>
                    </td>
                    <td className="mono">{short(inv.issuer)}</td>
                    <td className="mono r">{usdc(inv.amount)}</td>
                    <td>
                      <StatusChip status={inv.status} />
                    </td>
                    <td className="mono">
                      <div className="sealed-blob">{inv.sealed}</div>
                    </td>
                    <td>{inv.splits.length || 1}</td>
                    <td className="faint">{ago(inv.created_ms)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
