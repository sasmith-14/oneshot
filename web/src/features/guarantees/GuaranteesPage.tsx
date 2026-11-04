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

/** The promises, each set as a statement with its condition, and beside it
 * the live check against the data that exists right now. A line in the accent colour in the
 * margin follows your reading; each check draws itself as you reach it. */
export function GuaranteesPage() {
  const report = useGuarantees();
  const listRef = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: listRef, offset: ["start 70%", "end 55%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });

  return (
    <>
      <PageHeader title="Guarantees">
        What OneShot promises, each with the condition it depends on, checked live against the actions and effects that exist right now. A live check is evidence about current data, not a proof; the proof-style checks across every failure mode are in <code className="font-mono text-[0.85em]">tests/test_invariants.py</code>.
      </PageHeader>

      <div className="mb-24 grid gap-x-16 gap-y-6 border-t-2 border-ink pt-10 lg:grid-cols-12">
        <p className="t-title text-[length:calc(var(--ts)*clamp(2rem,3.6vw,3rem))] lg:col-span-7">OneShot does not provide exactly-once delivery.</p>
        <p className="text-[17px] leading-relaxed text-ink-2 lg:col-span-5 lg:pt-2">
          No system that talks to an external service over a network can. What it does provide is retries only when provably safe, deduplication where the provider supports it, verification where it does not, and an honest UNKNOWN when none of that is enough.
        </p>
      </div>

      {!report.data ? (
        <Skeleton className="h-[480px] rounded-none bg-well" />
      ) : (
        <>
          <p className="mb-8 text-[15px] text-ink-2" aria-live="polite">
            Checked {report.data.actions} actions {ago(report.data.checked_at)}. {report.data.provider_reachable ? "The provider's ledger was readable." : "The provider is unreachable, so ledger-based checks cannot run."} Rechecked every three seconds.
          </p>
          <div className="relative mb-28">
            <div aria-hidden className="absolute top-0 bottom-0 left-[31px] hidden w-px bg-rule sm:block">
              <motion.div style={{ scaleY: progress }} className="h-full w-[2px] -translate-x-[0.5px] origin-top bg-mark" />
            </div>
            <ol ref={listRef}>
              {report.data.guarantees.map((g) => <Row key={g.id} g={g} />)}
            </ol>
          </div>

          <Section title="Where duplicates and surprises still get in" about="Not guarantees: the documented gaps, counted in the current data. Reconciliation detects these; it cannot undo them.">
            <div className="grid gap-x-16 border-t-2 border-ink md:grid-cols-2">
              {report.data.gaps.map((gap) => (
                <motion.div key={gap.kind} initial={{ opacity: 0, y: 10 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.4, ease: EASE_OUT }} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 border-b border-rule py-6">
                  <div>
                    <h3 className="font-mono text-[13.5px]">{gap.kind}</h3>
                    <p className="mt-2 text-[15.5px] leading-relaxed text-ink-2">{gap.about}</p>
                    {gap.action_ids.length > 0 && (
                      <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
                        {gap.action_ids.map((id) => <Link key={id} to={`/actions/${id}`} className="ink-link font-mono text-[13px]">{id}</Link>)}
                      </p>
                    )}
                  </div>
                  <span className={cn("font-display text-[56px] leading-none", gap.count > 0 ? "text-st-verifying-fg" : "text-ink-3")}>{gap.count}</span>
                </motion.div>
              ))}
              <div className="border-b border-rule py-6 text-[15.5px] leading-relaxed text-ink-2">
                Also possible but not counted here: an agent that retries with a new key for a request that differs slightly, and a stalled worker whose late request reaches a provider that does not deduplicate. See <Link to="/learn/03-duplicate-protection" className="ink-link-static text-ink">duplicate protection</Link>.
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
  const seen = useInView(ref, { once: true, margin: "-18% 0px" });
  const s = STATUS[g.status];
  return (
    <li ref={ref} className="grid gap-x-10 gap-y-5 border-b border-rule py-10 first:pt-2 sm:grid-cols-[64px_minmax(0,1fr)] lg:grid-cols-[64px_minmax(0,1fr)_minmax(0,22rem)]">
      <div className="relative z-10">
        <Glyph glyph={s.glyph} ring={s.ring} on={seen} />
      </div>
      <div>
        <p className="font-mono text-[13px] text-ink-2">{g.id}</p>
        <h2 className="t-head mt-2 text-[length:calc(var(--ts)*clamp(1.75rem,2.6vw,2.25rem))]">{g.statement}</h2>
        <p className="mt-4 max-w-[62ch] text-[16px] leading-relaxed text-ink-2"><span className="font-semibold text-ink">Only if </span>{g.condition}</p>
      </div>
      <motion.div initial={{ opacity: 0, y: 10 }} animate={seen ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.45, delay: 0.3, ease: EASE_OUT }} className="bg-sheet p-5 sm:col-start-2 lg:col-start-auto lg:self-start">
        <p className={cn("text-[17px] font-semibold", s.text)}>{s.label}</p>
        <p className="mt-1.5 text-[15px] leading-relaxed">{g.evidence}</p>
        {g.action_ids.length > 0 && (
          <p className="mt-3 flex flex-wrap gap-x-4 gap-y-1">
            {g.action_ids.map((id) => <Link key={id} to={`/actions/${id}`} className="ink-link font-mono text-[13px]">{id}</Link>)}
          </p>
        )}
      </motion.div>
    </li>
  );
}

function Glyph({ glyph, ring, on }: { glyph: "check" | "cross" | "bang" | "dash"; ring: string; on: boolean }) {
  const d = { check: "M20 32 l8 8 l15 -17", cross: "M22 22 L42 42 M42 22 L22 42", bang: "M32 19 L32 36 M32 44 L32 45", dash: "M22 32 L42 32" }[glyph];
  return (
    <svg viewBox="0 0 64 64" className="size-16 rounded-full bg-paper" aria-hidden>
      <motion.circle cx={32} cy={32} r={28} fill="none" strokeWidth={2} className={ring} initial={{ pathLength: 0 }} animate={{ pathLength: on ? 1 : 0 }} transition={{ duration: 0.7, ease: EASE_OUT }} style={{ rotate: -90, transformOrigin: "50% 50%" }} />
      <motion.path d={d} fill="none" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" className={ring} initial={{ pathLength: 0 }} animate={{ pathLength: on ? 1 : 0 }} transition={{ duration: 0.4, delay: 0.5, ease: EASE_OUT }} />
    </svg>
  );
}
