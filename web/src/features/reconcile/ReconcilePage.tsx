import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Loader2, Play, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Section } from "@/components/PageHeader";
import { NumberRoll } from "@/components/NumberRoll";
import { StatusPill } from "@/components/StatusPill";
import { SetHeadline } from "@/components/SetHeadline";
import { Skeleton } from "@/components/ui/skeleton";
import { useActions, useLedger, useRun, useRuns } from "@/hooks/queries";
import { ops, type Finding, type ReconcileRun, type Severity } from "@/lib/api";
import { FINDING_GUIDE, SEVERITY_ORDER, SEVERITY_STYLE, diffRows, type DiffRow } from "@/lib/findings";
import { ago } from "@/lib/time";
import { EASE_OUT, RULE_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function ReconcilePage() {
  const [params, setParams] = useSearchParams();
  const runs = useRuns();
  const selectedId = params.get("run") ? Number(params.get("run")) : runs.data?.[0]?.id ?? null;
  const run = useRun(selectedId);
  const qc = useQueryClient();

  const go = useMutation({
    mutationFn: (apply: boolean) => ops.reconcile(apply),
    onSuccess: (r) => {
      qc.invalidateQueries();
      setParams({ run: String(r.run_id) }, { replace: true, preventScrollReset: true });
      const bad = r.findings.filter((f) => f.severity === "critical" || f.severity === "warning").length;
      toast[bad ? "warning" : "success"](r.applied ? "Reconciliation finished" : "Dry run finished", {
        description: bad ? `${bad} finding${bad > 1 ? "s" : ""} need attention.` : `All ${r.actions_checked} actions agree with the provider.`,
      });
    },
    onError: (e: Error) => toast.error("Reconciliation could not run", { description: e.message }),
  });

  return (
    <>
      <PageHeader
        title="Reconcile"
        actions={
          <>
            <button type="button" onClick={() => go.mutate(false)} disabled={go.isPending} className="btn btn-line">
              <ScanSearch aria-hidden className="size-4" /> Dry run
            </button>
            <button type="button" onClick={() => go.mutate(true)} disabled={go.isPending} className="btn btn-ink">
              {go.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Play aria-hidden className="size-4" />}
              {go.isPending ? "Reconciling…" : "Run reconciliation"}
            </button>
          </>
        }
      >
        Compare everything OneShot believes with the provider's own ledger, fetched over HTTP. Reconciliation resolves UNKNOWN actions; everything else it only flags, because the agent was already told a final answer. A dry run changes nothing.
      </PageHeader>

      <div className="mb-24 grid gap-x-16 gap-y-14 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-9">
          {runs.data && runs.data.length === 0 ? (
            <div className="border-t-2 border-ink pt-8">
              <p className="t-title text-[44px]">No runs yet.</p>
              <p className="mt-3 max-w-xl text-[16px] text-ink-2">Run reconciliation to compare OneShot's records with the provider's ledger. Every run is kept, so you can come back to it.</p>
            </div>
          ) : !run.data ? (
            <Skeleton className="h-48 rounded-none bg-well" />
          ) : (
            <RunReport run={run.data} />
          )}
        </div>
        <aside className="lg:sticky lg:top-24 lg:col-span-3 lg:self-start">
          <h2 className="t-head mb-3 text-[26px]">History</h2>
          <History runs={runs.data ?? []} selected={selectedId} onSelect={(id) => setParams({ run: String(id) }, { replace: true, preventScrollReset: true })} />
        </aside>
      </div>

      <Section title="Side by side, right now" about="Every OneShot action next to the effects the provider's ledger holds for it. Computed live, not from the selected run.">
        <Diff />
      </Section>
    </>
  );
}

function count(run: ReconcileRun, sev: Severity) {
  return (run.findings ?? []).filter((f) => f.severity === sev).length;
}

function RunReport({ run }: { run: ReconcileRun }) {
  const findings = [...(run.findings ?? [])].sort((a, b) => SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity));
  const notable = findings.filter((f) => f.severity !== "ok");
  const ok = findings.length - notable.length;
  const bad = notable.filter((f) => f.severity === "critical" || f.severity === "warning").length;
  const verdict = notable.length === 0 ? "Everything agrees." : bad ? `${bad} ${bad === 1 ? "finding needs" : "findings need"} attention.` : `${notable.length} ${notable.length === 1 ? "note" : "notes"}, nothing wrong.`;
  return (
    <section aria-labelledby="run-title">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h2 id="run-title" className="t-head text-[30px]">Run #{run.id}</h2>
        <p className="text-[15px] text-ink-2">
          {run.applied ? "" : "A dry run, "}at {new Date(run.at * 1000).toLocaleTimeString("en-GB", { hour12: false })}, {ago(run.at)}. Checked {run.actions_checked} actions against {run.effects_checked} effects.
        </p>
      </div>
      <SetHeadline key={`${run.id}-${verdict}`} as="p" text={verdict} className="t-display mt-4 text-[length:calc(var(--ds)*clamp(2.75rem,5.6vw,5rem))]" />
      {notable.length === 0 && <p className="t-stand mt-4 text-ink">{ok} {ok === 1 ? "action matches" : "actions match"} the provider's ledger, and nothing needs attention.</p>}

      <dl className="mt-10 grid grid-cols-2 gap-x-8 border-t-2 border-ink sm:grid-cols-5">
        {SEVERITY_ORDER.map((s) => (
          <div key={s} className="border-b border-rule py-3.5">
            <dt className="flex items-center gap-2 text-[14px] text-ink-2"><span className={cn("size-1.5 rounded-full", SEVERITY_STYLE[s].dot)} />{SEVERITY_STYLE[s].label}</dt>
            <dd><NumberRoll value={count(run, s)} className={cn("font-display text-[40px] leading-none", count(run, s) === 0 && "text-ink-3")} /></dd>
          </div>
        ))}
      </dl>

      {notable.length > 0 && (
        <ul className="mt-10 border-t-2 border-ink">
          {notable.map((f, i) => <FindingRow key={`${f.kind}-${f.action_id}-${i}`} finding={f} index={i} />)}
          {ok > 0 && <li className="pt-4 text-[15px] text-ink-2">Plus {ok} matching action{ok > 1 ? "s" : ""}.</li>}
        </ul>
      )}
    </section>
  );
}

function FindingRow({ finding, index }: { finding: Finding; index: number }) {
  const [open, setOpen] = useState(false);
  const guide = FINDING_GUIDE[finding.kind];
  const style = SEVERITY_STYLE[finding.severity];
  return (
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(index, 8) * 0.03, ease: EASE_OUT }} className="border-b border-rule">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-4 py-4 text-left">
        <span className={cn("mt-0.5 shrink-0 rounded-[2px] px-1.5 py-0.5 text-[12.5px] font-medium", style.chip)}>{style.label}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[17px] font-medium">{guide?.title ?? finding.kind}</span>
          <span className="mt-0.5 block text-[14.5px] text-ink-2">{finding.message}</span>
        </span>
        {finding.action_id && <span className="hidden pt-1 font-mono text-[13px] text-ink-2 sm:block">{finding.action_id}</span>}
        <ChevronDown aria-hidden className={cn("mt-1 size-4 shrink-0 text-ink-2 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && guide && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: EASE_OUT }} className="overflow-hidden">
            <dl className="grid gap-x-8 gap-y-4 bg-sheet px-5 py-5 text-[15px] sm:grid-cols-3">
              <div><dt className="text-[13px] font-semibold">What it means</dt><dd className="mt-1">{guide.means}</dd></div>
              <div><dt className="text-[13px] font-semibold">How it happens</dt><dd className="mt-1">{guide.how}</dd></div>
              <div><dt className="text-[13px] font-semibold">What to do</dt><dd className="mt-1">{guide.todo}</dd></div>
            </dl>
            {finding.action_id && (
              <p className="bg-sheet px-5 pb-5 text-[15px]">
                <Link to={`/actions/${finding.action_id}`} className="ink-link-static">Open {finding.action_id}</Link>
                {finding.effect_ids.length > 0 && <span className="text-ink-2"> with effects {finding.effect_ids.join(", ")}</span>}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

const DIFF_STYLE: Record<DiffRow["kind"], { label: string; line: string }> = {
  match: { label: "match", line: "stroke-ink" },
  none: { label: "no effect", line: "stroke-ink-3" },
  missing: { label: "missing at provider", line: "stroke-st-failed" },
  unexpected: { label: "applied but FAILED", line: "stroke-st-failed" },
  duplicate: { label: "duplicate", line: "stroke-st-failed" },
  orphan: { label: "orphan", line: "stroke-st-failed" },
};

function Diff() {
  const actions = useActions();
  const ledger = useLedger();
  const [problemsOnly, setProblemsOnly] = useState(false);
  if (ledger.isError) return <p className="bg-well px-5 py-4 text-[15px] text-ink-2">The provider's ledger cannot be read right now, so there is nothing to compare against.</p>;
  if (!actions.data || !ledger.data) return <Skeleton className="h-64 rounded-none bg-well" />;
  const statusById = new Map(actions.data.map((a) => [a.id, a.status]));
  const all = diffRows([...actions.data].sort((a, b) => b.created_at - a.created_at), ledger.data.effects);
  const problems = all.filter((r) => !["match", "none"].includes(r.kind)).length;
  const rows = problemsOnly ? all.filter((r) => !["match", "none"].includes(r.kind)) : all;
  return (
    <div>
      <label className="mb-5 inline-flex items-center gap-2.5 text-[15px]">
        <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} className="size-4 accent-ink" />
        Show only problems ({problems})
      </label>
      <div className="grid grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)] gap-x-4 border-t-2 border-b border-ink py-3 text-[13px] text-ink-2">
        <span>OneShot's record</span>
        <span className="text-center">Link</span>
        <span>The provider's ledger</span>
      </div>
      <ul className="max-h-[640px] overflow-y-auto" data-lenis-prevent>
        {rows.slice(0, 300).map((r, i) => {
          const st = r.actionId ? statusById.get(r.actionId) : undefined;
          const bad = !["match", "none"].includes(r.kind);
          return (
            <motion.li key={r.actionId ?? r.effectIds.join()} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, margin: "40px" }} transition={{ duration: 0.3, delay: Math.min(i, 6) * 0.02 }} className={cn("grid grid-cols-[minmax(0,1fr)_9rem_minmax(0,1fr)] items-center gap-x-4 border-b border-rule py-2.5", bad && "bg-st-failed-soft")}>
              <span className="flex min-w-0 items-center gap-2.5">
                {r.actionId ? (
                  <>
                    <Link to={`/actions/${r.actionId}`} className="ink-link truncate font-mono text-[13px]">{r.actionId}</Link>
                    {st && <StatusPill status={st} explain={false} />}
                  </>
                ) : (
                  <span className="text-[14px] text-mark-ink">no OneShot action</span>
                )}
              </span>
              <Connector row={r} />
              <span className="flex min-w-0 flex-wrap gap-x-3 gap-y-1">
                {r.effectIds.length ? r.effectIds.map((e) => <span key={e} className={cn("font-mono text-[13px]", bad && "text-st-failed-fg")}>{e}</span>) : <span className="text-[14px] text-ink-3">nothing</span>}
              </span>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

function Connector({ row }: { row: DiffRow }) {
  const s = DIFF_STYLE[row.kind];
  const n = Math.max(1, row.effectIds.length);
  return (
    <span className="flex flex-col items-center" title={s.label}>
      <svg viewBox="0 0 100 24" className="h-6 w-full" aria-hidden>
        {row.kind === "orphan" ? (
          <line x1={55} y1={12} x2={96} y2={12} strokeWidth={1.6} strokeDasharray="3 3" className={s.line} />
        ) : row.kind === "none" || row.kind === "missing" ? (
          <>
            <line x1={4} y1={12} x2={50} y2={12} strokeWidth={1.6} strokeDasharray="3 3" className={s.line} />
            {row.kind === "missing" && <path d="M47 8 l8 8 M55 8 l-8 8" strokeWidth={1.8} className={s.line} />}
          </>
        ) : (
          Array.from({ length: n }, (_, i) => {
            const y = n === 1 ? 12 : 4 + (16 / (n - 1)) * i;
            return <path key={i} d={`M4 12 C 50 12, 50 ${y}, 96 ${y}`} fill="none" strokeWidth={1.3} className={s.line} />;
          })
        )}
      </svg>
      <span className={cn("text-[12px]", row.kind === "match" || row.kind === "none" ? "text-ink-2" : "font-medium text-st-failed-fg")}>{s.label}</span>
    </span>
  );
}

function History({ runs, selected, onSelect }: { runs: ReconcileRun[]; selected: number | null; onSelect: (id: number) => void }) {
  if (!runs.length) return <p className="font-display text-[19px] text-ink-3 italic">No runs yet.</p>;
  return (
    <ol className="max-h-[70vh] overflow-y-auto border-t-2 border-ink" data-lenis-prevent>
      {runs.map((r) => {
        const crit = Object.entries(r.summary).filter(([k]) => ["MISSING_EFFECT", "UNEXPECTED_EFFECT", "DUPLICATE_EFFECT", "ORPHAN_EFFECT"].includes(k)).reduce((n, [, v]) => n + v, 0);
        const warn = (r.summary.UNRESOLVED_UNKNOWN ?? 0) + (r.summary.SUSPECTED_DUPLICATE_REQUEST ?? 0);
        const resolved = (r.summary.RESOLVED_SUCCEEDED ?? 0) + (r.summary.RESOLVED_FAILED ?? 0);
        const on = selected === r.id;
        return (
          <li key={r.id} className="border-b border-rule">
            <button type="button" onClick={() => onSelect(r.id)} aria-current={on} className={cn("relative w-full py-3 pl-4 text-left transition-colors duration-150", !on && "hover:bg-sheet")}>
              {on && <motion.span layoutId="run-selected" aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-mark" transition={RULE_SPRING} />}
              <span className="flex items-baseline justify-between gap-2">
                <span className={cn("text-[15.5px]", on && "font-semibold")}>Run #{r.id}{!r.applied && <span className="font-normal text-ink-2">, dry</span>}</span>
                <time className="text-[13px] text-ink-2">{ago(r.at)}</time>
              </span>
              <span className="mt-0.5 flex gap-3 text-[13.5px]">
                {crit > 0 && <span className="text-st-failed-fg">{crit} critical</span>}
                {warn > 0 && <span className="text-st-verifying-fg">{warn} warning</span>}
                {resolved > 0 && <span className="text-st-unknown-fg">{resolved} resolved</span>}
                {!crit && !warn && !resolved && <span className="text-ink-2">all clear</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
