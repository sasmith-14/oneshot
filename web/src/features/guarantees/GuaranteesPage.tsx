import { useRef } from "react";
import { Link } from "react-router";
import { motion, useInView, useScroll, useSpring } from "motion/react";
import { PageHeader, Section } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useGuarantees } from "@/hooks/queries";
import type { Guarantee } from "@/lib/api";
import { ago } from "@/lib/time";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

const STATUS: Record<Guarantee["status"], { label: string; ring: string; text: string; glyph: "check" | "cross" | "bang" | "dash" }> = {
  holds: { label: "Holds", ring: "stroke-st-succeeded", text: "text-st-succeeded-fg", glyph: "check" },
  violated: { label: "Violated", ring: "stroke-st-failed", text: "text-st-failed-fg", glyph: "cross" },
  "condition-broken": { label: "Its condition was broken", ring: "stroke-st-verifying", text: "text-st-verifying-fg", glyph: "bang" },
  attention: { label: "Needs attention", ring: "stroke-st-verifying", text: "text-st-verifying-fg", glyph: "bang" },
  unknown: { label: "Cannot check", ring: "stroke-st-pending", text: "text-st-pending-fg", glyph: "dash" },
};

export function GuaranteesPage() {
  const report = useGuarantees();
  const listRef = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: listRef, offset: ["start 75%", "end 60%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });

  return (
    <>
      <PageHeader title="Guarantees">
        What OneShot promises, each with the condition it depends on, checked live against the actions and effects that exist right now. A live check is evidence about current data, not a proof; the proof-style checks across every failure mode are in <code className="font-mono text-[13px]">tests/test_invariants.py</code>.
      </PageHeader>

      <div className="mb-10 max-w-3xl rounded-[14px] border-l-4 border-st-unknown bg-st-unknown-soft/50 px-5 py-4 text-[15px]">
        <p className="font-medium">OneShot does not provide exactly-once delivery.</p>
        <p className="mt-1 text-muted-foreground">No system that talks to an external service over a network can. What it does provide is retries only when provably safe, deduplication where the provider supports it, verification where it does not, and an honest UNKNOWN when none of that is enough.</p>
      </div>

      {!report.data ? (
        <Skeleton className="h-[480px] rounded-[14px]" />
      ) : (
        <>
          <p className="mb-6 text-sm text-muted-foreground" aria-live="polite">
            Checked {report.data.actions} actions {ago(report.data.checked_at)}. {report.data.provider_reachable ? "The provider's ledger was readable." : "The provider is unreachable, so ledger-based checks cannot run."} Rechecked every 3 seconds.
          </p>
          <div className="relative">
            <div aria-hidden className="absolute top-0 bottom-0 left-[27px] hidden w-px bg-border sm:block">
              <motion.div style={{ scaleY: progress }} className="h-full w-full origin-top bg-foreground" />
            </div>
            <ol ref={listRef} className="space-y-4">
              {report.data.guarantees.map((g) => <Row key={g.id} g={g} />)}
            </ol>
          </div>

          <Section title="Where duplicates and surprises still get in" about="Not guarantees: the documented gaps, counted in the current data. Reconciliation detects these; it cannot undo them.">
            <div className="grid gap-3 sm:grid-cols-2">
              {report.data.gaps.map((gap) => (
                <motion.div key={gap.kind} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.3, ease: EASE_OUT }} className="rounded-[14px] border bg-card p-4">
                  <div className="flex items-baseline justify-between">
                    <h3 className="font-mono text-xs">{gap.kind}</h3>
                    <span className={cn("text-2xl font-semibold tabular-nums", gap.count > 0 && "text-st-verifying-fg")}>{gap.count}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{gap.about}</p>
                  {gap.action_ids.length > 0 && (
                    <p className="mt-2 flex flex-wrap gap-1.5">
                      {gap.action_ids.map((id) => <Link key={id} to={`/actions/${id}`} className="rounded-md border px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted">{id}</Link>)}
                    </p>
                  )}
                </motion.div>
              ))}
              <div className="rounded-[14px] border border-dashed p-4 text-sm text-muted-foreground">
                Also possible but not counted here: an agent that retries with a new key for a request that differs slightly, and a stalled worker whose late request reaches a provider that does not deduplicate. See <Link to="/learn/03-duplicate-protection" className="underline">duplicate protection</Link>.
              </div>
            </div>
          </Section>
        </>
      )}
    </>
  );
}

function Row({ g }: { g: Guarantee }) {
  const ref = useRef<HTMLLIElement>(null);
  const seen = useInView(ref, { once: true, margin: "-15% 0px" });
  const s = STATUS[g.status];
  return (
    <li ref={ref} className="grid gap-x-6 gap-y-3 rounded-[14px] border bg-card p-5 sm:grid-cols-[56px_minmax(0,1fr)_minmax(0,320px)] sm:border-0 sm:bg-transparent sm:p-0 sm:py-5">
      <div className="relative z-10 flex sm:justify-center">
        <Glyph glyph={s.glyph} ring={s.ring} on={seen} />
      </div>
      <div>
        <p className="font-mono text-xs text-muted-foreground">{g.id}</p>
        <h2 className="mt-1 text-lg leading-snug font-semibold tracking-tight">{g.statement}</h2>
        <p className="mt-2 text-sm text-muted-foreground"><span className="font-medium text-foreground">Only if: </span>{g.condition}</p>
      </div>
      <motion.div initial={{ opacity: 0, x: 8 }} animate={seen ? { opacity: 1, x: 0 } : {}} transition={{ duration: 0.35, delay: 0.25, ease: EASE_OUT }} className="rounded-xl border bg-card p-4 sm:self-start">
        <p className={cn("text-sm font-semibold", s.text)}>{s.label}</p>
        <p className="mt-1 text-[13.5px]">{g.evidence}</p>
        {g.action_ids.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1.5">
            {g.action_ids.map((id) => <Link key={id} to={`/actions/${id}`} className="rounded-md border px-1.5 py-0.5 font-mono text-[11px] hover:bg-muted">{id}</Link>)}
          </p>
        )}
      </motion.div>
    </li>
  );
}

function Glyph({ glyph, ring, on }: { glyph: "check" | "cross" | "bang" | "dash"; ring: string; on: boolean }) {
  const d = { check: "M17 28 l7 7 l13 -15", cross: "M19 19 L37 37 M37 19 L19 37", bang: "M28 17 L28 31 M28 38 L28 39", dash: "M19 28 L37 28" }[glyph];
  return (
    <svg viewBox="0 0 56 56" className="size-14 rounded-full bg-background" aria-hidden>
      <motion.circle cx={28} cy={28} r={24} fill="none" strokeWidth={2.5} className={ring} initial={{ pathLength: 0 }} animate={{ pathLength: on ? 1 : 0 }} transition={{ duration: 0.6, ease: EASE_OUT }} style={{ rotate: -90, transformOrigin: "50% 50%" }} />
      <motion.path d={d} fill="none" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" className={ring} initial={{ pathLength: 0 }} animate={{ pathLength: on ? 1 : 0 }} transition={{ duration: 0.35, delay: 0.45, ease: EASE_OUT }} />
    </svg>
  );
}
