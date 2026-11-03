import { NavLink, Outlet } from "react-router";
import { Moon, Sun, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSystemStatus } from "@/hooks/queries";
import { useTheme } from "@/hooks/useTheme";
import { cn } from "@/lib/utils";

const NAV = [
  { to: "/", label: "Actions", end: true },
  { to: "/chaos", label: "Chaos" },
  { to: "/reconcile", label: "Reconcile" },
  { to: "/ledger", label: "Provider ledger" },
  { to: "/guarantees", label: "Guarantees" },
  { to: "/learn", label: "Learn" },
];

export function AppShell() {
  const [theme, toggleTheme] = useTheme();
  return (
    <div className="min-h-dvh flex flex-col">
      <header className="sticky top-0 z-20 border-b bg-background/85 backdrop-blur">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-6 px-4 sm:px-6">
          <NavLink to="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <Logo />
            OneShot
            <span className="hidden rounded-md bg-muted px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-muted-foreground uppercase sm:inline">
              lab console
            </span>
          </NavLink>
          <nav className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto text-sm">
            {NAV.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "rounded-md px-2.5 py-1.5 whitespace-nowrap text-muted-foreground transition-colors hover:text-foreground",
                    isActive && "bg-muted text-foreground font-medium",
                  )
                }
              >
                {n.label}
              </NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <LiveIndicator />
            <Button variant="ghost" size="icon" asChild title="OpenAPI docs for the JSON API">
              <a href="/docs" target="_blank" rel="noreferrer">
                <BookOpen />
              </a>
            </Button>
            <Button variant="ghost" size="icon" onClick={toggleTheme} title={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}>
              {theme === "dark" ? <Sun /> : <Moon />}
            </Button>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">
        <Outlet />
      </main>
      <footer className="border-t py-4 text-center text-xs text-muted-foreground">
        Educational, local, not production-ready. OneShot never claims exactly-once delivery; see Guarantees for what it does promise.
      </footer>
    </div>
  );
}

function LiveIndicator() {
  const { isError, dataUpdatedAt } = useSystemStatus();
  const fresh = !isError && Date.now() - dataUpdatedAt < 4000;
  return (
    <span
      className="flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
      title={fresh ? "Polling the OneShot API every second" : "The OneShot API is not answering"}
    >
      <span className={cn("size-1.5 rounded-full", fresh ? "bg-st-succeeded os-pulse" : "bg-st-failed")} />
      {fresh ? "live" : "API offline"}
    </span>
  );
}

function Logo() {
  // One shot = one arrow hitting one target.
  return (
    <svg viewBox="0 0 24 24" className="size-5" aria-hidden>
      <circle cx="14" cy="10" r="7" className="fill-none stroke-st-inflight" strokeWidth="2" />
      <circle cx="14" cy="10" r="2.5" className="fill-st-inflight" />
      <path d="M3 21 L12 12" className="stroke-foreground" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
