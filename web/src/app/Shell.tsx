import { useEffect, useState } from "react";
import { NavLink, useLocation, useNavigate, useOutlet } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { Moon, Search, Sun } from "lucide-react";
import { Toaster } from "sonner";
import { CommandPalette, PAGES } from "./CommandPalette";
import { useLenis } from "./SmoothScroll";
import { useTheme } from "./theme";
import { Kbd } from "@/components/Kbd";
import { useSystemStatus } from "@/hooks/queries";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function Shell() {
  const [theme, toggleTheme] = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const lenis = useLenis();
  const section = "/" + (location.pathname.split("/")[1] ?? "");

  // New page: start at the top (instantly; animating a long scroll would be noise).
  useEffect(() => {
    if (location.hash) return;
    if (lenis) lenis.scrollTo(0, { immediate: true });
    else window.scrollTo(0, 0);
  }, [section, lenis, location.hash]);

  // Number keys 1–6 jump between pages (when not typing).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey || /input|textarea|select/i.test((e.target as HTMLElement).tagName)) return;
      if ((e.target as HTMLElement).isContentEditable || document.querySelector("[role=dialog]")) return;
      const n = Number(e.key);
      if (n >= 1 && n <= PAGES.length) navigate(PAGES[n - 1].to);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate]);

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-3 focus:py-2 focus:text-background">
        Skip to content
      </a>
      <header className="sticky top-0 z-30 border-b bg-background/80 backdrop-blur-md supports-[backdrop-filter]:bg-background/70">
        <div className="mx-auto flex h-14 max-w-[1240px] items-center gap-4 px-4 sm:px-6">
          <NavLink to="/" className="mr-2 flex shrink-0 items-center gap-2 rounded-md font-semibold tracking-tight" aria-label="OneShot, live view">
            <Logo />
            <span>OneShot</span>
          </NavLink>
          <nav aria-label="Main" className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto text-[13.5px] [scrollbar-width:none]">
            {PAGES.map((p) => {
              const active = p.to === "/" ? section === "/" || section === "/actions" : section === p.to;
              return (
                <NavLink key={p.to} to={p.to} className={cn("relative rounded-lg px-3 py-1.5 whitespace-nowrap transition-colors", active ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                  {active && <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-lg bg-muted" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                  <span className="relative">{p.label}</span>
                </NavLink>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            className="hidden h-8 items-center gap-2 rounded-lg border bg-card px-2.5 text-[13px] text-muted-foreground transition-colors hover:text-foreground md:flex"
          >
            <Search aria-hidden className="size-3.5" />
            Jump to…
            <Kbd className="ml-3">⌘K</Kbd>
          </button>
          <LiveIndicator />
          <button
            type="button"
            onClick={toggleTheme}
            aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
            className="grid size-8 place-items-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <AnimatePresence mode="wait" initial={false}>
              <motion.span key={theme} initial={{ rotate: -60, opacity: 0, scale: 0.8 }} animate={{ rotate: 0, opacity: 1, scale: 1 }} exit={{ rotate: 60, opacity: 0, scale: 0.8 }} transition={{ duration: 0.18, ease: EASE_OUT }}>
                {theme === "dark" ? <Sun aria-hidden className="size-4" /> : <Moon aria-hidden className="size-4" />}
              </motion.span>
            </AnimatePresence>
          </button>
        </div>
      </header>

      <main id="main" className="mx-auto w-full max-w-[1240px] flex-1 px-4 pt-8 pb-20 sm:px-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={section} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: EASE_OUT }}>
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex max-w-[1240px] flex-wrap items-center justify-between gap-2 px-4 py-5 text-xs text-muted-foreground sm:px-6">
          <span>OneShot is an educational reference implementation. It runs locally, uses no real money, and never claims exactly-once delivery.</span>
          <span className="flex items-center gap-1.5">
            Press <Kbd>⌘K</Kbd> to jump anywhere, or <Kbd>1</Kbd>–<Kbd>6</Kbd> for pages
          </span>
        </div>
      </footer>

      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} theme={theme} toggleTheme={toggleTheme} />
      <Toaster theme={theme} position="bottom-right" closeButton toastOptions={{ classNames: { toast: "!rounded-xl !border-border !bg-popover !text-popover-foreground", description: "!text-muted-foreground" } }} />
    </div>
  );
}

function LiveIndicator() {
  const { isError, dataUpdatedAt } = useSystemStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const fresh = !isError && now - dataUpdatedAt < 4000;
  return (
    <span role="status" aria-live="polite" className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex" title={fresh ? "Polling the OneShot API every second" : "The OneShot API is not answering"}>
      <span className="relative flex size-2">
        {fresh && <span className="os-ring absolute inset-0 rounded-full bg-st-succeeded" />}
        <span className={cn("relative size-2 rounded-full", fresh ? "bg-st-succeeded" : "bg-st-failed")} />
      </span>
      {fresh ? "Live" : "API offline"}
    </span>
  );
}

export function Logo({ className }: { className?: string }) {
  // One shot: a single arrow meeting a single target.
  return (
    <svg viewBox="0 0 24 24" className={cn("size-5", className)} aria-hidden>
      <circle cx="14.5" cy="9.5" r="6.5" className="fill-none stroke-st-inflight" strokeWidth="2" />
      <circle cx="14.5" cy="9.5" r="2.2" className="fill-st-inflight" />
      <path d="M3.5 20.5 L12.5 11.5" className="stroke-foreground" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M3.5 20.5 l3.2 -.4 M3.5 20.5 l.4 -3.2" className="stroke-foreground" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
