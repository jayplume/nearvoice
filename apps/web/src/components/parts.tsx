import { type ReactNode, createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { REPO } from "../lib/config";
import { Link, useRoute } from "../lib/router";
import { type Theme, useTheme } from "../lib/theme";

declare const __COMMIT__: string;
const COMMIT = typeof __COMMIT__ === "string" ? __COMMIT__ : "dev";

/** The mark: an invoice sheet folded at the corner, sealed with a dot. */
export function Logo({ size = 28 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="9" fill="var(--brand)" />
      <path d="M10 7.5h8.5l4.5 4.5v12.5a1.5 1.5 0 0 1-1.5 1.5h-11.5a1.5 1.5 0 0 1-1.5-1.5v-15.5a1.5 1.5 0 0 1 1.5-1.5z" fill="#fff" />
      <path d="M18.5 7.5v3a1.5 1.5 0 0 0 1.5 1.5h3" fill="none" stroke="var(--brand)" strokeWidth="1.4" opacity=".45" />
      <rect x="11.5" y="14" width="7" height="1.6" rx=".8" fill="var(--brand)" opacity=".35" />
      <rect x="11.5" y="17.5" width="5" height="1.6" rx=".8" fill="var(--brand)" opacity=".35" />
      <circle cx="19.5" cy="21.5" r="2.6" fill="var(--paid)" />
    </svg>
  );
}

function ThemeButton({ theme, toggle }: { theme: Theme; toggle: () => void }) {
  return (
    <button type="button" className="icon-btn" onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} title="Light or dark">
      {theme === "dark" ? (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <circle cx="12" cy="12" r="4.5" fill="currentColor" />
          {[0, 45, 90, 135, 180, 225, 270, 315].map((a) => (
            <rect key={a} x="11.2" y="1.5" width="1.6" height="3.5" rx=".8" fill="currentColor" transform={`rotate(${a} 12 12)`} />
          ))}
        </svg>
      ) : (
        <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
          <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5z" fill="currentColor" />
        </svg>
      )}
    </button>
  );
}

const NAV = [
  { to: "/app", label: "Invoices" },
  { to: "/ledger", label: "Ledger" },
  { to: "/verify", label: "Privacy proof" },
];

export function Nav() {
  const [theme, toggle] = useTheme();
  const { path } = useRoute();
  const [open, setOpen] = useState(false);
  // biome-ignore lint/correctness/useExhaustiveDependencies: close the menu on navigation
  useEffect(() => setOpen(false), [path]);
  return (
    <header className="nav">
      <div className="nav-inner">
        <Link to="/" className="brand" aria-label="Nearvoice home">
          <Logo />
          <span>Nearvoice</span>
        </Link>
        <nav id="main-nav" className={`nav-links${open ? " is-open" : ""}`} aria-label="Main">
          {NAV.map((n) => (
            <Link key={n.to} to={n.to} className="nav-link">
              {n.label}
            </Link>
          ))}
          <a className="nav-link" href={REPO} target="_blank" rel="noreferrer">
            Code
          </a>
        </nav>
        <div className="nav-end">
          <ThemeButton theme={theme} toggle={toggle} />
          <Link to="/app/new" className="btn btn--primary btn--sm">
            New invoice
          </Link>
          <button type="button" className="icon-btn nav-toggle" aria-expanded={open} aria-controls="main-nav" onClick={() => setOpen((o) => !o)} aria-label="Menu">
            <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
              <rect x="4" y="6" width="16" height="2" rx="1" fill="currentColor" />
              <rect x="4" y="11" width="16" height="2" rx="1" fill="currentColor" />
              <rect x="4" y="16" width="16" height="2" rx="1" fill="currentColor" />
            </svg>
          </button>
        </div>
      </div>
    </header>
  );
}

export function Footer() {
  return (
    <footer className="footer">
      <div className="footer-inner">
        <div>
          <Link to="/" className="brand">
            <Logo size={24} />
            <span>Nearvoice</span>
          </Link>
          <p>Private invoices, paid in stablecoins on NEAR. Runs on NEAR testnet with test USDC; no real money moves.</p>
        </div>
        <div>
          <h4>Product</h4>
          <Link to="/app/new">New invoice</Link>
          <Link to="/app">Your invoices</Link>
          <Link to="/ledger">Public ledger</Link>
        </div>
        <div>
          <h4>Trust</h4>
          <Link to="/verify">Privacy proof</Link>
          <a href="https://testnet.nearblocks.io/address/invoices.nearvoice.testnet" target="_blank" rel="noreferrer">
            Invoice contract
          </a>
          <a href={REPO} target="_blank" rel="noreferrer">
            Source code
          </a>
        </div>
      </div>
      <p className="footer-build">
        Built from{" "}
        <a href={`${REPO}/commit/${COMMIT}`} target="_blank" rel="noreferrer">
          {COMMIT}
        </a>
      </p>
    </footer>
  );
}

// ---------- toasts ----------

type Toast = { id: number; msg: ReactNode; tone: "info" | "good" | "bad" };
const ToastCtx = createContext<(msg: ReactNode, tone?: Toast["tone"]) => void>(() => {});
export const useToast = () => useContext(ToastCtx);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const next = useRef(0);
  const push = useCallback((msg: ReactNode, tone: Toast["tone"] = "info") => {
    const id = next.current++;
    setItems((xs) => [...xs, { id, msg, tone }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <ToastCtx.Provider value={push}>
      {children}
      <div className="toasts" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast toast--${t.tone}`}>
            <div>{t.msg}</div>
            <button type="button" className="toast-x" aria-label="Dismiss" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}

export function Spinner({ label }: { label?: string }) {
  return (
    <output className="spin">
      <span className="spin-dot" />
      {label}
    </output>
  );
}

export function StatusChip({ status }: { status: "open" | "paid" | "cancelled" | "refunded" }) {
  const label = { open: "Awaiting payment", paid: "Paid", cancelled: "Cancelled", refunded: "Refunded" }[status];
  return <span className={`chip chip--${status}`}>{label}</span>;
}

export function TxLink({ hash, children }: { hash: string; children?: ReactNode }) {
  return (
    <a className="tx" href={`https://testnet.nearblocks.io/txns/${hash}`} target="_blank" rel="noreferrer">
      {children ?? `${hash.slice(0, 8)}…`}
    </a>
  );
}
