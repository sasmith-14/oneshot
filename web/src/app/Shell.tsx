import { useEffect, useRef, useState } from "react";
import { Link, NavLink, useLocation, useNavigate, useOutlet } from "react-router";
import { AnimatePresence, motion, useInView } from "motion/react";
import { Search } from "lucide-react";
import { Toaster } from "sonner";
import { CommandPalette, PAGES } from "./CommandPalette";
import { Cursor } from "./Cursor";
import { useLenis } from "./SmoothScroll";
import { useTheme, type ThemeMode } from "./theme";
import { ThemeSwitch } from "./ThemeSwitch";
import { Kbd } from "@/components/Kbd";
import { useSystemStatus } from "@/hooks/queries";
import { EASE_OUT, RULE_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

const FRAME = "mx-auto w-full max-w-[1320px] px-5 sm:px-8 lg:px-10";

export function Shell() {
  const { mode, theme, setMode } = useTheme();
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const outlet = useOutlet();
  const lenis = useLenis();
  const section = "/" + (location.pathname.split("/")[1] ?? "");
  const mastRef = useRef<HTMLElement>(null);
  const mastInView = useInView(mastRef, { margin: "-56px 0px 0px 0px" });

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

  const tools = (where: string) => <Tools id={where} mode={mode} setMode={setMode} openPalette={() => setPaletteOpen(true)} />;

  return (
    <div className="flex min-h-dvh flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[90] focus:bg-ink focus:px-3 focus:py-2 focus:text-paper">
        Skip to content
      </a>

      <Masthead ref={mastRef} section={section} tools={tools("mast")} />
      <SlimBar visible={!mastInView} section={section} tools={tools("slim")} />

      <main id="main" className={cn(FRAME, "flex-1 pt-14 pb-32")}>
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, transition: { duration: 0.12 } }}
            transition={{ duration: 0.28, ease: EASE_OUT }}
          >
            {outlet}
          </motion.div>
        </AnimatePresence>
      </main>

      <Colophon />
      <Cursor />
      <CommandPalette open={paletteOpen} setOpen={setPaletteOpen} mode={mode} setMode={setMode} />
      <Toaster
        theme={theme}
        position="bottom-left"
        closeButton
        toastOptions={{ classNames: { toast: "!rounded-[3px] !border-ink !bg-sheet !text-ink !font-sans !shadow-[0_10px_30px_-12px_rgba(0,0,0,0.25)]", description: "!text-ink-2" } }}
      />
    </div>
  );
}

// ------------------------------------------------------------------ masthead

function isActive(to: string, section: string) {
  return to === "/" ? section === "/" || section === "/actions" : section === to;
}

function today() {
  return new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(new Date());
}

const Masthead = ({ ref, section, tools }: { ref: React.Ref<HTMLElement>; section: string; tools: React.ReactNode }) => {
  const status = useSystemStatus();
  const total = status.data ? Object.values(status.data.counts).reduce((a, b) => a + (b ?? 0), 0) : null;
  return (
    <header ref={ref} className={cn(FRAME, "pt-5")}>
      <div className="flex items-center justify-between gap-4 pb-5 text-[13.5px] text-ink-2">
        <span>{today()}</span>
        <span className="hidden md:block">{total === null ? "" : `${total.toLocaleString("en-GB")} action${total === 1 ? "" : "s"} on record`}</span>
        {tools}
      </div>
      <div className="flex items-end justify-between gap-8 pb-5">
        <Link to="/" aria-label="OneShot, live front page" className="t-display -ml-[0.04em] text-[length:calc(var(--ds)*clamp(3.6rem,10.5vw,8.75rem))] leading-[0.82]">
          <Wordmark />
        </Link>
        <p className="hidden max-w-[30ch] pb-2 text-right text-[15px] leading-snug text-ink-2 md:block">
          The record of every action an agent asked for, and of what really happened on the wire.
        </p>
      </div>
      {/* The heavy rule sits under the nav's own top edge, so the accent section
          mark can be drawn over it without being clipped by the scroll box. */}
      <div className="relative">
        <div aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-ink" />
        <nav aria-label="Sections" className="relative flex items-center gap-x-7 overflow-x-auto border-b border-rule [scrollbar-width:none]">
          {PAGES.map((p) => {
            const active = isActive(p.to, section);
            return (
              <NavLink key={p.to} to={p.to} className={cn("relative pt-[17px] pb-3.5 text-[15.5px] whitespace-nowrap transition-colors duration-150", active ? "font-medium text-ink" : "text-ink-2 hover:text-ink")}>
                {active && <motion.span layoutId="mast-mark" aria-hidden className="absolute inset-x-0 top-0 h-[3px] bg-mark" transition={RULE_SPRING} />}
                {p.label}
              </NavLink>
            );
          })}
        </nav>
      </div>
    </header>
  );
};

function SlimBar({ visible, section, tools }: { visible: boolean; section: string; tools: React.ReactNode }) {
  return (
    <motion.div
      aria-hidden={!visible}
      inert={!visible}
      initial={false}
      animate={{ y: visible ? 0 : "-105%" }}
      transition={{ duration: 0.32, ease: EASE_OUT }}
      className="fixed inset-x-0 top-0 z-40 border-b border-rule bg-paper"
    >
      <div className={cn(FRAME, "flex h-14 items-center gap-6")}>
        <Link to="/" aria-label="OneShot" className="t-display shrink-0 text-[30px] leading-none">
          <Wordmark />
        </Link>
        <nav aria-label="Sections (compact)" className="flex min-w-0 flex-1 items-center gap-x-5 overflow-x-auto text-[14.5px] [scrollbar-width:none]">
          {PAGES.map((p) => {
            const active = isActive(p.to, section);
            return (
              <NavLink key={p.to} to={p.to} className={cn("relative py-4 whitespace-nowrap transition-colors duration-150", active ? "font-medium text-ink" : "text-ink-2 hover:text-ink")}>
                {p.label}
                {active && <motion.span layoutId="slim-mark" aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-mark" transition={RULE_SPRING} />}
              </NavLink>
            );
          })}
        </nav>
        {tools}
      </div>
    </motion.div>
  );
}

/** The wordmark: the name, and one full stop in the accent colour. One shot. */
export function Wordmark() {
  return (
    <>
      OneShot<span className="text-mark">.</span>
    </>
  );
}

function Tools({ id, mode, setMode, openPalette }: { id: string; mode: ThemeMode; setMode: (m: ThemeMode) => void; openPalette: () => void }) {
  return (
    <div className="flex shrink-0 items-center gap-1.5">
      <LiveMark />
      <button type="button" onClick={openPalette} className="btn btn-quiet btn-sm hidden gap-2 md:inline-flex" aria-label="Jump to a page, action or preset">
        <Search aria-hidden className="size-3.5" />
        Jump to
        <Kbd>⌘K</Kbd>
      </button>
      <ThemeSwitch id={id} mode={mode} setMode={setMode} />
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
    <span role="status" aria-live="polite" className="mr-2 hidden items-center gap-2 text-[13px] text-ink-2 sm:flex" title={fresh ? "Reading the OneShot API every second" : "The OneShot API is not answering"}>
      <span className="relative flex size-2">
        {fresh && <span className="os-ring absolute inset-0 rounded-full bg-mark" />}
        <span className={cn("relative size-2 rounded-full", fresh ? "bg-mark" : "bg-ink-3")} />
      </span>
      {fresh ? "Live" : "API offline"}
    </span>
  );
}

// ------------------------------------------------------------------ colophon

function Colophon() {
  return (
    <footer className={cn(FRAME, "pb-10")}>
      <div className="rule-heavy pt-8">
        <div className="grid gap-x-12 gap-y-4 text-[14px] leading-relaxed text-ink-2 md:grid-cols-3">
          <p>An educational reference implementation. Everything runs on this machine, against a simulated provider, with no real money.</p>
          <p>OneShot never claims exactly-once delivery. It retries only when that is provably safe, and says UNKNOWN when it cannot tell.</p>
          <p className="flex flex-wrap items-center gap-1.5">
            Press <Kbd>⌘K</Kbd> to jump anywhere, or <Kbd>1</Kbd>–<Kbd>6</Kbd> for a section.
          </p>
        </div>
        <p aria-hidden className="t-display mt-14 -mb-[0.16em] -ml-[0.05em] text-[length:calc(var(--ds)*clamp(5rem,21vw,19rem))] leading-[0.8] select-none">
          <Wordmark />
        </p>
      </div>
    </footer>
  );
}
