import "./styles/app.css";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode, Suspense, lazy, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { Footer, Nav, Spinner, ToastProvider } from "./components/parts";
import { RouterProvider, useRoute } from "./lib/router";
import { Link } from "./lib/router";
import { Landing } from "./pages/Landing";

// Wallet and signing code is heavy; each page loads only what it needs.
const Dashboard = lazy(() => import("./pages/Dashboard").then((m) => ({ default: m.Dashboard })));
const NewInvoice = lazy(() => import("./pages/NewInvoice").then((m) => ({ default: m.NewInvoice })));
const InvoiceView = lazy(() => import("./pages/InvoiceView").then((m) => ({ default: m.InvoiceView })));
const Verify = lazy(() => import("./pages/Verify").then((m) => ({ default: m.Verify })));
const Ledger = lazy(() => import("./pages/Ledger").then((m) => ({ default: m.Ledger })));

const client = new QueryClient({ defaultOptions: { queries: { retry: 2, refetchOnWindowFocus: false } } });

const TITLES: Record<string, string> = {
  "/": "Nearvoice: private invoices, paid in stablecoins",
  "/app": "Your invoices · Nearvoice",
  "/app/new": "New invoice · Nearvoice",
  "/ledger": "Public ledger · Nearvoice",
  "/verify": "Privacy proof · Nearvoice",
};

function Routes() {
  const { path } = useRoute();
  useEffect(() => {
    document.title = TITLES[path] ?? (path.startsWith("/i/") ? `Invoice #${path.slice(3)} · Nearvoice` : "Nearvoice");
    if (!window.location.hash) window.scrollTo(0, 0);
  }, [path]);
  const inv = path.match(/^\/i\/(\d+)\/?$/);
  if (inv) return <InvoiceView key={inv[1]} id={Number(inv[1])} />;
  switch (path) {
    case "/":
      return <Landing />;
    case "/app":
      return <Dashboard />;
    case "/app/new":
      return <NewInvoice />;
    case "/ledger":
      return <Ledger />;
    case "/verify":
      return <Verify />;
    default:
      return (
        <div className="wrap page empty">
          <h3>No page at {path}</h3>
          <p>It may have moved.</p>
          <Link to="/" className="btn btn--primary">
            Go to the home page
          </Link>
        </div>
      );
  }
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <RouterProvider>
        <ToastProvider>
          <Nav />
          <main>
            <Suspense
              fallback={
                <div className="wrap page">
                  <Spinner label="Loading" />
                </div>
              }
            >
              <Routes />
            </Suspense>
          </main>
          <Footer />
        </ToastProvider>
      </RouterProvider>
    </QueryClientProvider>
  </StrictMode>,
);
