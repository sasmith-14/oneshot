import { StrictMode, Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider, useRouteError } from "react-router";
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
    <div className="py-20 text-center">
      <p className="text-lg font-medium">There is no page here.</p>
      <p className="mt-1 text-sm text-muted-foreground">Press ⌘K to jump to a page or an action.</p>
    </div>
  );
}

function Crash() {
  const error = useRouteError() as Error | undefined;
  return (
    <div className="mx-auto max-w-xl px-6 py-24">
      <h1 className="text-2xl font-semibold">Something in the console broke.</h1>
      <p className="mt-2 text-muted-foreground">The backend is unaffected: actions keep running and nothing was lost. Reload the page to continue.</p>
      {error?.message && <pre className="mt-4 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">{error.message}</pre>}
      <button type="button" onClick={() => location.reload()} className="mt-6 h-9 rounded-lg bg-foreground px-4 text-sm font-medium text-background">Reload</button>
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
