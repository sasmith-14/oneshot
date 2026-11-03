import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createBrowserRouter, RouterProvider } from "react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AppShell } from "@/components/layout/AppShell";
import { ActionsPage } from "@/pages/ActionsPage";
import { ActionDetailPage } from "@/pages/ActionDetailPage";
import { ComingSoon } from "@/pages/ComingSoon";
import "./index.css";

const router = createBrowserRouter(
  [
    {
      element: <AppShell />,
      children: [
        { index: true, element: <ActionsPage /> },
        { path: "actions/:id", element: <ActionDetailPage /> },
        { path: "chaos", element: <ComingSoon title="Chaos" milestone="M2">One-click failure presets (lost responses, crashes, duplicates) and a custom fault form. Needs lab mode (ONESHOT_LAB=1).</ComingSoon> },
        { path: "reconcile", element: <ComingSoon title="Reconcile" milestone="M3">Run reconciliation against the provider's ledger, see findings with explanations, a side-by-side diff, and run history.</ComingSoon> },
        { path: "ledger", element: <ComingSoon title="Provider ledger" milestone="M4">The fake provider's raw ledger and its armed faults.</ComingSoon> },
        { path: "guarantees", element: <ComingSoon title="Guarantees" milestone="M4">G1–G5 and the known duplicate gaps, each with a live check against current data.</ComingSoon> },
        { path: "learn", element: <ComingSoon title="Learn" milestone="M4">The concept docs (docs/src) rendered here, diagrams included.</ComingSoon> },
        { path: "*", element: <ComingSoon title="Not found" milestone="-">There is no page at this address.</ComingSoon> },
      ],
    },
  ],
  { basename: "/ui" },
);

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: true, staleTime: 500 } },
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <TooltipProvider delayDuration={250}>
        <RouterProvider router={router} />
      </TooltipProvider>
    </QueryClientProvider>
  </StrictMode>,
);
