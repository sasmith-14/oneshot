import { useRef } from "react";
import { Link } from "react-router";
import { motion, useInView, useScroll, useSpring } from "motion/react";
import { ShieldAlert } from "lucide-react";
import { PageHeader, Panel } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useGuarantees } from "@/hooks/queries";
import type { Guarantee } from "@/lib/api";
import { ago } from "@/lib/time";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";

const STATUS: Record<Guarantee["status"], { label: string; ring: string; text: string; soft: string; glyph: "check" | "cross" | "bang" | "dash" }> = {
  holds: { label: "Holds", ring: "stroke-st-succeeded", text: "text-st-succeeded-fg", soft: "bg-st-succeeded-soft", glyph: "check" },
  violated: { label: "Violated", ring: "stroke-st-failed", text: "text-st-failed-fg", soft: "bg-st-failed-soft", glyph: "cross" },
  "condition-broken": { label: "Its condition was broken", ring: "stroke-st-verifying", text: "text-st-verifying-fg", soft: "bg-st-verifying-soft", glyph: "bang" },
  attention: { label: "Needs attention", ring: "stroke-st-verifying", text: "text-st-verifying-fg", soft: "bg-st-verifying-soft", glyph: "bang" },
  unknown: { label: "Cannot check", ring: "stroke-st-pending", text: "text-st-pending-fg", soft: "bg-st-pending-soft", glyph: "dash" },
};

/** Each promise with its condition, and the live check beside it. A line in
 * the margin follows your reading; each check draws itself when reached. */
export function GuaranteesPage() {
  const report = useGuarantees();
  const listRef = useRef<HTMLOListElement>(null);
  const { scrollYProgress } = useScroll({ target: listRef, offset: ["start 75%", "end 60%"] });
  const progress = useSpring(scrollYProgress, { stiffness: 140, damping: 30 });
  const holding = report.data?.guarantees.filter((g) => g.status === "holds").length ?? 0;

  return (
    <>
      <PageHeader title="Guarantees" actions={report.data && <span className="chip h-7"><span className={cn("size-1.5 rounded-full", holding === report.data.guarantees.length ? "bg-st-succeeded" : "bg-st-verifying")} />{holding} of {report.data.guarantees.length} hold right now</span>}>
        What OneShot promises, each with the condition it depends on, checked live against the actions and effects that exist right now. A live check is evidence about current data, not a proof; the proof-style checks across every failure mode are in <code className="font-mono text-[0.9em]">tests/test_invariants.py</code>.
      </PageHeader>

      <div className="mb-6 flex gap-4 rounded-[12px] border border-st-unknown/30 bg-st-unknown-soft p-5 text-st-unknown-fg">
        <ShieldAlert aria-hidden className="mt-0.5 size-5 shrink-0" />
        <div>
          <p className="text-[15px] font-[620]">OneShot does not provide exactly-once delivery.</p>
          <p className="mt-1 max-w-3xl text-[13.5px] leading-relaxed opacity-90">No system that talks to an external service over a network can. What it does provide is retries only when provably safe, deduplication where the provider supports it, verification where it does not, and an honest UNKNOWN when none of that is enough.</p>
        </div>
      </div>

      {!report.data ? (
        <Skeleton className="h-[480px] rounded-[12px]" />
      ) : (
        <>
          <p className="mb-4 text-[12.5px] text-fg-3" aria-live="polite">
            Checked {report.data.actions} actions {ago(report.data.checked_at)}. {report.data.provider_reachable ? "The provider's ledger was readable." : "The provider is unreachable, so ledger-based checks cannot run."} Rechecked every three seconds.
          </p>
          <div className="relative mb-10 sm:pl-7">
            <div aria-hidden className="absolute top-2 bottom-2 left-[7px] hidden w-px bg-line sm:block">
              <motion.div style={{ scaleY: progress }} className="h-full w-[2px] -translate-x-[0.5px] origin-top bg-signal" />
            </div>
            <ol ref={listRef} className="space-y-3">
              {report.data.guarantees.map((g) => <Row key={g.id} g={g} />)}
            </ol>
          </div>

          <Panel title="Where duplicates and surprises still get in" aside={<span className="hidden text-[12.5px] text-fg-3 sm:block">documented gaps, counted in the current data</span>} bodyClassName="p-0">
            <div className="grid md:grid-cols-2">
              {report.data.gaps.map((gap, i) => (
                <motion.div key={gap.kind} initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: "-40px" }} transition={{ duration: 0.35, ease: EASE_OUT }} className={cn("flex gap-4 border-line p-[18px]", i % 2 === 1 && "md:border-l", i >= 2 && "border-t", i === 1 && "max-md:border-t")}>
                  <div className="min-w-0 flex-1">
                    <h3 className="font-mono text-[12.5px] font-[560]">{gap.kind}</h3>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-fg-2">{gap.about}</p>
                    {gap.action_ids.length > 0 && (
                      <p className="mt-2.5 flex flex-wrap gap-1.5">
                        {gap.action_ids.map((id) => <Link key={id} to={`/actions/${id}`} className="chip font-mono hover:border-line-strong">{id}</Link>)}
                      </p>
                    )}
                  </div>
                  <span className={cn("t-figure text-[34px]", gap.count > 0 ? "text-st-verifying-fg" : "text-fg-3")}>{gap.count}</span>
                </motion.div>
              ))}
            </div>
            <p className="border-t border-line px-[18px] py-3.5 text-[13px] leading-relaxed text-fg-2">
              Also possible but not counted here: an agent that retries with a new key for a request that differs slightly, and a stalled worker whose late request reaches a provider that does not deduplicate. See <Link to="/learn/03-duplicate-protection" className="link">duplicate protection</Link>.
            </p>
          </Panel>
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
    <li ref={ref} className="panel grid gap-x-6 gap-y-4 p-[18px] sm:grid-cols-[44px_minmax(0,1fr)] lg:grid-cols-[44px_minmax(0,1fr)_minmax(0,21rem)]">
      <div className="relative z-10">
        <Glyph glyph={s.glyph} ring={s.ring} on={seen} />
      </div>
      <div>
        <p className="font-mono text-[12px] text-fg-3">{g.id}</p>
        <h2 className="mt-1 text-[17px] leading-snug font-[620] tracking-[-0.015em]">{g.statement}</h2>
        <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-fg-2"><span className="font-[600] text-fg">Only if </span>{g.condition}</p>
      </div>
      <motion.div initial={{ opacity: 0, y: 8 }} animate={seen ? { opacity: 1, y: 0 } : {}} transition={{ duration: 0.4, delay: 0.3, ease: EASE_OUT }} className={cn("rounded-[10px] p-3.5 sm:col-start-2 lg:col-start-auto lg:self-start", s.soft)}>
        <p className={cn("text-[13.5px] font-[620]", s.text)}>{s.label}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-fg">{g.evidence}</p>
        {g.action_ids.length > 0 && (
          <p className="mt-2 flex flex-wrap gap-1.5">
            {g.action_ids.map((id) => <Link key={id} to={`/actions/${id}`} className="chip font-mono">{id}</Link>)}
          </p>
        )}
      </motion.div>
    </li>
  );
}

function Glyph({ glyph, ring, on }: { glyph: "check" | "cross" | "bang" | "dash"; ring: string; on: boolean }) {
  const d = { check: "M14 22.5 l5.5 5.5 l11 -12", cross: "M16 16 L28 28 M28 16 L16 28", bang: "M22 13 L22 25 M22 30.5 L22 31", dash: "M15 22 L29 22" }[glyph];
  return (
    <svg viewBox="0 0 44 44" className="size-11 rounded-full bg-surface" aria-hidden>
      <circle cx={22} cy={22} r={19} fill="none" strokeWidth={1.5} className="stroke-line" />
      <motion.circle cx={22} cy={22} r={19} fill="none" strokeWidth={2} className={ring} initial={{ pathLength: 0 }} animate={{ pathLength: on ? 1 : 0 }} transition={{ duration: 0.7, ease: EASE_OUT }} style={{ rotate: -90, transformOrigin: "50% 50%" }} />
      <motion.path d={d} fill="none" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" className={ring} initial={{ pathLength: 0 }} animate={{ pathLength: on ? 1 : 0 }} transition={{ duration: 0.4, delay: 0.5, ease: EASE_OUT }} />
    </svg>
  );
}
