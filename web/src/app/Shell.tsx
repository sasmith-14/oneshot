import { useEffect, useState } from "react";
import { Link, NavLink, useLocation, useNavigate, useOutlet } from "react-router";
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from "motion/react";
import { Search } from "lucide-react";
import { Toaster } from "sonner";
import { CommandPalette, PAGES } from "./CommandPalette";
import { Cursor } from "./Cursor";
import { useLenis } from "./SmoothScroll";
import { useTheme } from "./theme";
import { ThemeSwitch } from "./ThemeSwitch";
import { Kbd } from "@/components/Kbd";
import { Wordmark } from "@/components/Logo";
import { useSystemStatus } from "@/hooks/queries";
import { EASE_OUT, RULE_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const FRAME = "mx-auto w-full max-w-[1360px] px-4 sm:px-6 lg:px-8";

export function Shell() {
  const { mode, theme, setMode } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const lenis = useLenis();
  const section = "/" + (location.pathname.split("/")[1] ?? "");
  const { scrollY } = useScroll();
  const [scrolled, setScrolled] = useState(false);
  useMotionValueEvent(scrollY, "change", (y) => setScrolled(y > 8));

  // A new page starts at the top (instantly: animating a long scroll is noise).
  useEffect(() => {
    if (location.hash) return;
    if (lenis) lenis.scrollTo(0, { immediate: true });
    else window.scrollTo(0, 0);
  }, [section, lenis, location.hash]);

  // Keys 1–6 jump between sections (when not typing).
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
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[90] focus:rounded-md focus:bg-fg focus:px-3 focus:py-2 focus:text-canvas">
        Skip to content
      </a>

      <header className={cn("sticky top-0 z-40 border-b transition-[background-color,border-color] duration-200", scrolled ? "border-line bg-canvas/88 backdrop-blur-md" : "border-transparent bg-canvas")}>
        <div className={cn(FRAME, "flex h-14 items-center gap-6")}>
          <Link to="/" aria-label="OneShot, live view" className="shrink-0 rounded-md">
            <Wordmark />
          </Link>
          <nav aria-label="Sections" className="no-scrollbar flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto">
            {PAGES.map((p) => {
              const active = p.to === "/" ? section === "/" || section === "/actions" : section === p.to;
              return (
                <NavLink key={p.to} to={p.to} className={cn("relative rounded-[8px] px-3 py-1.5 text-[13.5px] whitespace-nowrap transition-colors duration-150", active ? "font-[560] text-fg" : "text-fg-2 hover:text-fg")}>
                  {active && <motion.span layoutId="nav-pill" aria-hidden className="absolute inset-0 rounded-[8px] border border-line bg-surface shadow-[var(--shadow-card)]" transition={RULE_SPRING} />}
                  <span className="relative">{p.label}</span>
                </NavLink>
              );
            })}
          </nav>
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            aria-label="Search pages, actions and presets"
            className="hidden h-8 w-56 items-center gap-2 rounded-[8px] border border-line bg-surface px-2.5 text-[13px] text-fg-3 transition-colors duration-150 hover:border-line-strong hover:text-fg-2 lg:flex"
          >
            <Search aria-hidden className="size-3.5" />
            Search…
            <Kbd className="ml-auto">⌘K</Kbd>
          </button>
          <LiveMark />
          <ThemeSwitch id="top" mode={mode} setMode={setMode} />
        </div>
      </header>

      <main id="main" className={cn(FRAME, "flex-1 pt-8 pb-24")}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={section} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.26, ease: EASE_OUT }}>
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>

      <footer className="border-t border-line">
        <div className={cn(FRAME, "grid gap-6 py-8 text-[12.5px] text-fg-3 md:grid-cols-[auto_1fr_auto] md:items-center md:gap-10")}>
          <Wordmark className="text-fg-2" />
          <p className="max-w-2xl">
            An educational reference implementation, running entirely on this machine against a simulated provider, with no real money. It never claims exactly-once delivery: it retries only when that is provably safe, and says UNKNOWN when it cannot tell.
          </p>
          <p className="flex items-center gap-1.5 whitespace-nowrap">
            <Kbd>⌘K</Kbd> search · <Kbd>1</Kbd>–<Kbd>6</Kbd> sections
          </p>
        </div>
      </footer>

      <Cursor />
      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} mode={mode} setMode={setMode} />
      <Toaster
        theme={theme}
        position="bottom-right"
        closeButton
        toastOptions={{ classNames: { toast: "!rounded-[10px] !border-line !bg-surface !text-fg !font-sans !shadow-[var(--shadow-pop)]", description: "!text-fg-2" } }}
      />
    </div>
  );
}

function LiveMark() {
  const { isError, dataUpdatedAt } = useSystemStatus();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const fresh = !isError && now - dataUpdatedAt < 4000;
  return (
    <span role="status" aria-live="polite" className="hidden items-center gap-2 text-[12.5px] font-[520] text-fg-2 sm:flex" title={fresh ? "Reading the OneShot API every second" : "The OneShot API is not answering"}>
      <span className="relative flex size-2">
        {fresh && <span className="os-ring absolute inset-0 rounded-full bg-signal" />}
        <span className={cn("relative size-2 rounded-full", fresh ? "bg-signal" : "bg-fg-3")} />
      </span>
      {fresh ? "Live" : "Offline"}
    </span>
  );
}
