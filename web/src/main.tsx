import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, Link, RouterProvider, useRouteError } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Skeleton } from "@/components/ui/skeleton";
import { Shell } from "@/app/Shell";
import { SmoothScroll } from "@/app/SmoothScroll";
import { LivePage } from "@/features/live/LivePage";
import { ActionPage } from "@/features/action/ActionPage";
import { ChaosPage } from "@/features/chaos/ChaosPage";
import { ReconcilePage } from "@/features/reconcile/ReconcilePage";
import { LedgerPage } from "@/features/ledger/LedgerPage";
import { GuaranteesPage } from "@/features/guarantees/GuaranteesPage";
import { LearnIndex } from "@/features/learn/LearnIndex";
import "./index.css";

// The document renderer (Markdown + Mermaid) is the heaviest part, so it is
// split into its own chunk and only loaded when a document is opened.
const LearnDoc = lazy(() => import("@/features/learn/LearnDoc").then((m) => ({ default: m.LearnDoc })));

function NotFound() {
  return (
    <div className="grid min-h-[60vh] place-items-center py-16">
      <div className="max-w-lg text-center">
        <p className="t-figure bg-gradient-to-b from-fg to-fg-3 bg-clip-text text-[96px] text-transparent">404</p>
        <h1 className="t-title mt-2">Nothing on this wire</h1>
        <p className="mt-3 text-[15px] text-fg-2">This address does not lead to a page. Pick a section, or press <kbd className="rounded-[5px] border border-line bg-sunken px-1 font-mono text-[12px]">⌘K</kbd> to search for an action.</p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <Link to="/" className="btn btn-signal">Go to Live</Link>
          <Link to="/learn" className="btn btn-outline">Learn how it works</Link>
        </div>
      </div>
    </div>
  );
}

function Crash() {
  const error = useRouteError() as Error | undefined;
  return (
    <div className="grid min-h-dvh place-items-center bg-canvas px-6 text-fg">
      <div className="panel max-w-xl p-7">
        <h1 className="t-title">Something in the console broke</h1>
        <p className="mt-3 text-[15px] text-fg-2">The backend is unaffected: actions keep running and nothing was lost. Reload the page to continue.</p>
        {error?.message && <pre className="well mt-4 overflow-x-auto p-3 font-mono text-[12px] text-st-failed-fg">{error.message}</pre>}
        <button type="button" onClick={() => location.reload()} className="btn btn-primary mt-6">Reload</button>
      </div>
    </div>
  );
}

const router = createBrowserRouter(
  [
    {
      element: <Shell />,
      errorElement: <Crash />,
      children: [
        { index: true, element: <LivePage /> },
        { path: "actions/:id", element: <ActionPage /> },
        { path: "chaos", element: <ChaosPage /> },
        { path: "reconcile", element: <ReconcilePage /> },
        { path: "ledger", element: <LedgerPage /> },
        { path: "guarantees", element: <GuaranteesPage /> },
        { path: "learn", element: <LearnIndex /> },
        { path: "learn/:slug", element: <Suspense fallback={<Skeleton className="h-[600px] max-w-3xl rounded-[14px]" />}><LearnDoc /></Suspense> },
        { path: "*", element: <NotFound /> },
      ],
    },
  ],
  { basename: "/ui" },
);

const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 500 } } });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <MotionConfig reducedMotion="user">
        <SmoothScroll>
          <TooltipProvider delayDuration={250}>
            <RouterProvider router={router} />
          </TooltipProvider>
        </SmoothScroll>
      </MotionConfig>
    </QueryClientProvider>
  </StrictMode>,
);
