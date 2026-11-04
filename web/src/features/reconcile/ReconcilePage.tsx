import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Loader2, Play, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/PageHeader";
import { NumberRoll } from "@/components/NumberRoll";
import { SetHeadline } from "@/components/SetHeadline";
import { StatusPill } from "@/components/StatusPill";
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
            <button type="button" onClick={() => go.mutate(false)} disabled={go.isPending} className="btn btn-outline">
              <ScanSearch aria-hidden className="size-3.5" /> Dry run
            </button>
            <button type="button" onClick={() => go.mutate(true)} disabled={go.isPending} className="btn btn-primary">
              {go.isPending ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Play aria-hidden className="size-3.5" />}
              {go.isPending ? "Reconciling…" : "Run reconciliation"}
            </button>
          </>
        }
      >
        Compare everything OneShot believes with the provider's own ledger. Reconciliation resolves UNKNOWN actions; everything else it only flags, because the agent was already told a final answer. A dry run changes nothing.
      </PageHeader>

      <div className="mb-4 grid gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          {runs.data && runs.data.length === 0 ? (
            <Panel>
              <p className="t-h2">No runs yet</p>
              <p className="mt-1 text-[13.5px] text-fg-2">Run reconciliation to compare OneShot's records with the provider's ledger. Every run is kept, so you can come back to it.</p>
            </Panel>
          ) : !run.data ? (
            <Skeleton className="h-64 rounded-[12px]" />
          ) : (
            <RunReport run={run.data} />
          )}
        </div>
        <Panel className="lg:sticky lg:top-20 lg:col-span-4 lg:self-start" title="History" bodyClassName="p-1.5">
          <History runs={runs.data ?? []} selected={selectedId} onSelect={(id) => setParams({ run: String(id) }, { replace: true, preventScrollReset: true })} />
        </Panel>
      </div>

      <Panel title="Side by side, right now" aside={<span className="hidden text-[12.5px] text-fg-3 sm:block">computed live, not from the selected run</span>} bodyClassName="p-0">
        <Diff />
      </Panel>
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
  const total = Math.max(1, findings.length);
  return (
    <section className="panel overflow-hidden" aria-labelledby="run-title">
      <div className="panel-head">
        <h2 id="run-title" className="t-h3">Run #{run.id}</h2>
        <span className="text-[12.5px] text-fg-3">
          {run.applied ? "" : "dry run, "}
          {ago(run.at)}, {run.actions_checked} actions against {run.effects_checked} effects
        </span>
      </div>
      <div className="p-[18px]">
        <SetHeadline key={`${run.id}-${verdict}`} as="p" text={verdict} className="t-hero text-[clamp(1.75rem,3vw,2.5rem)]" />
        {notable.length === 0 && <p className="mt-2 text-[14px] text-fg-2">{ok} {ok === 1 ? "action matches" : "actions match"} the provider's ledger, and nothing needs attention.</p>}

        <div className="mt-6 flex h-2 overflow-hidden rounded-full bg-sunken" role="img" aria-label="Findings by severity">
          {SEVERITY_ORDER.map((s) => (
            <motion.span key={s} className={cn("h-full", SEVERITY_STYLE[s].dot)} initial={{ width: 0 }} animate={{ width: `${(count(run, s) / total) * 100}%` }} transition={{ duration: 0.6, ease: EASE_OUT }} />
          ))}
        </div>
        <dl className="mt-3 grid grid-cols-3 gap-y-3 sm:grid-cols-5">
          {SEVERITY_ORDER.map((s) => (
            <div key={s}>
              <dt className="flex items-center gap-1.5 text-[12px] text-fg-3"><span className={cn("size-1.5 rounded-full", SEVERITY_STYLE[s].dot)} />{SEVERITY_STYLE[s].label}</dt>
              <dd><NumberRoll value={count(run, s)} className={cn("t-figure text-[22px]", count(run, s) === 0 && "text-fg-3")} /></dd>
            </div>
          ))}
        </dl>
      </div>
      {notable.length > 0 && (
        <ul className="border-t border-line">
          {notable.map((f, i) => <FindingRow key={`${f.kind}-${f.action_id}-${i}`} finding={f} index={i} />)}
          {ok > 0 && <li className="px-[18px] py-3 text-[12.5px] text-fg-3">Plus {ok} matching action{ok > 1 ? "s" : ""}.</li>}
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
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(index, 8) * 0.03, ease: EASE_OUT }} className="border-b border-line">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-[18px] py-3 text-left transition-colors duration-150 hover:bg-sunken">
        <span className={cn("mt-0.5 shrink-0 rounded-[6px] px-1.5 py-0.5 text-[11px] font-[600] ring-1 ring-inset ring-current/15", style.chip)}>{style.label}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13.5px] font-[560]">{guide?.title ?? finding.kind}</span>
          <span className="mt-0.5 block text-[12.5px] text-fg-2">{finding.message}</span>
        </span>
        {finding.action_id && <span className="hidden pt-0.5 font-mono text-[11.5px] text-fg-3 sm:block">{finding.action_id}</span>}
        <ChevronDown aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-fg-3 transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && guide && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: EASE_OUT }} className="overflow-hidden">
            <dl className="grid gap-x-6 gap-y-3 bg-sunken px-[18px] py-4 text-[13px] sm:grid-cols-3">
              <div><dt className="text-[11.5px] font-[600] text-fg-3">What it means</dt><dd className="mt-1">{guide.means}</dd></div>
              <div><dt className="text-[11.5px] font-[600] text-fg-3">How it happens</dt><dd className="mt-1">{guide.how}</dd></div>
              <div><dt className="text-[11.5px] font-[600] text-fg-3">What to do</dt><dd className="mt-1">{guide.todo}</dd></div>
            </dl>
            {finding.action_id && (
              <p className="bg-sunken px-[18px] pb-4 text-[13px]">
                <Link to={`/actions/${finding.action_id}`} className="link">Open {finding.action_id}</Link>
                {finding.effect_ids.length > 0 && <span className="text-fg-2"> with effects {finding.effect_ids.join(", ")}</span>}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

const DIFF_STYLE: Record<DiffRow["kind"], { label: string; line: string; bad: boolean }> = {
  match: { label: "match", line: "stroke-st-succeeded", bad: false },
  none: { label: "no effect", line: "stroke-line-strong", bad: false },
  missing: { label: "missing at provider", line: "stroke-st-failed", bad: true },
  unexpected: { label: "applied but FAILED", line: "stroke-st-failed", bad: true },
  duplicate: { label: "duplicate", line: "stroke-st-failed", bad: true },
  orphan: { label: "orphan", line: "stroke-st-failed", bad: true },
};

function Diff() {
  const actions = useActions();
  const ledger = useLedger();
  const [problemsOnly, setProblemsOnly] = useState(false);
  const [hover, setHover] = useState<string | null>(null);
  const all = useMemo(
    () => (actions.data && ledger.data ? diffRows([...actions.data].sort((a, b) => b.created_at - a.created_at), ledger.data.effects) : []),
    [actions.data, ledger.data],
  );
  if (ledger.isError) return <p className="px-[18px] py-4 text-[13.5px] text-fg-2">The provider's ledger cannot be read right now, so there is nothing to compare against.</p>;
  if (!actions.data || !ledger.data) return <Skeleton className="m-4 h-64 rounded-[10px]" />;
  const statusById = new Map(actions.data.map((a) => [a.id, a.status]));
  const problems = all.filter((r) => DIFF_STYLE[r.kind].bad).length;
  const rows = problemsOnly ? all.filter((r) => DIFF_STYLE[r.kind].bad) : all;
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 border-b border-line px-[18px] py-2.5 text-[12.5px]">
        <label className="inline-flex items-center gap-2">
          <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} className="size-3.5 accent-[var(--signal)]" />
          Only problems ({problems})
        </label>
        <span className="text-fg-3">{all.filter((r) => r.kind === "match").length} matched · {all.filter((r) => r.kind === "none").length} with no effect · {problems} problems</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)] gap-x-3 border-b border-line px-[18px] py-2 text-[12px] text-fg-3">
        <span>OneShot's record</span>
        <span className="text-center">link</span>
        <span>The provider's ledger</span>
      </div>
      <ul className="max-h-[520px] overflow-y-auto" data-lenis-prevent>
        {rows.slice(0, 300).map((r, i) => {
          const key = r.actionId ?? r.effectIds.join();
          const st = r.actionId ? statusById.get(r.actionId) : undefined;
          const bad = DIFF_STYLE[r.kind].bad;
          return (
            <motion.li
              key={key}
              initial={{ opacity: 0 }}
              whileInView={{ opacity: 1 }}
              viewport={{ once: true, margin: "40px" }}
              transition={{ duration: 0.3, delay: Math.min(i, 6) * 0.02 }}
              onMouseEnter={() => setHover(key)}
              onMouseLeave={() => setHover(null)}
              className={cn("grid grid-cols-[minmax(0,1fr)_10rem_minmax(0,1fr)] items-center gap-x-3 border-b border-line px-[18px] py-2 transition-colors duration-150 last:border-0", bad ? "bg-st-failed-soft/60" : hover === key && "bg-sunken")}
            >
              <span className="flex min-w-0 items-center gap-2">
                {r.actionId ? (
                  <>
                    <Link to={`/actions/${r.actionId}`} className="link-quiet truncate font-mono text-[12px] text-fg-2">{r.actionId}</Link>
                    {st && <StatusPill status={st} explain={false} />}
                  </>
                ) : (
                  <span className="text-[12.5px] text-st-failed-fg">no OneShot action</span>
                )}
              </span>
              <Connector row={r} lit={hover === key} />
              <span className="flex min-w-0 flex-wrap gap-1.5">
                {r.effectIds.length ? r.effectIds.map((e) => <span key={e} className={cn("rounded-[5px] border px-1.5 py-0.5 font-mono text-[11.5px]", bad ? "border-st-failed/40 text-st-failed-fg" : "border-line text-fg-2")}>{e}</span>) : <span className="text-[12.5px] text-fg-3">nothing</span>}
              </span>
            </motion.li>
          );
        })}
      </ul>
    </div>
  );
}

function Connector({ row, lit }: { row: DiffRow; lit: boolean }) {
  const s = DIFF_STYLE[row.kind];
  const n = Math.max(1, row.effectIds.length);
  return (
    <span className="flex flex-col items-center" title={s.label}>
      <svg viewBox="0 0 100 24" className="h-6 w-full overflow-visible" aria-hidden>
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
            return <motion.path key={i} d={`M4 12 C 50 12, 50 ${y}, 96 ${y}`} fill="none" strokeWidth={lit ? 2.2 : 1.4} className={s.line} initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 0.5, ease: EASE_OUT }} />;
          })
        )}
        <circle cx={4} cy={12} r={2.5} className={row.actionId ? "fill-fg-3" : "fill-transparent"} />
      </svg>
      <span className={cn("text-[10.5px]", s.bad ? "font-[600] text-st-failed-fg" : "text-fg-3")}>{s.label}</span>
    </span>
  );
}

function History({ runs, selected, onSelect }: { runs: ReconcileRun[]; selected: number | null; onSelect: (id: number) => void }) {
  if (!runs.length) return <p className="px-3 py-3 text-[13px] text-fg-3">No runs yet.</p>;
  return (
    <ol className="max-h-[60vh] overflow-y-auto" data-lenis-prevent>
      {runs.map((r) => {
        const crit = Object.entries(r.summary).filter(([k]) => ["MISSING_EFFECT", "UNEXPECTED_EFFECT", "DUPLICATE_EFFECT", "ORPHAN_EFFECT"].includes(k)).reduce((n, [, v]) => n + v, 0);
        const warn = (r.summary.UNRESOLVED_UNKNOWN ?? 0) + (r.summary.SUSPECTED_DUPLICATE_REQUEST ?? 0);
        const resolved = (r.summary.RESOLVED_SUCCEEDED ?? 0) + (r.summary.RESOLVED_FAILED ?? 0);
        const on = selected === r.id;
        return (
          <li key={r.id}>
            <button type="button" onClick={() => onSelect(r.id)} aria-current={on} className={cn("relative w-full rounded-[8px] px-3 py-2.5 text-left transition-colors duration-150", !on && "hover:bg-sunken")}>
              {on && <motion.span layoutId="run-selected" aria-hidden className="absolute inset-0 rounded-[8px] border border-line bg-sunken" transition={RULE_SPRING} />}
              <span className="relative flex items-baseline justify-between gap-2">
                <span className="text-[13px] font-[560]">Run #{r.id}{!r.applied && <span className="font-normal text-fg-3"> · dry</span>}</span>
                <time className="text-[12px] text-fg-3">{ago(r.at)}</time>
              </span>
              <span className="relative mt-0.5 flex gap-3 text-[12px]">
                {crit > 0 && <span className="text-st-failed-fg">{crit} critical</span>}
                {warn > 0 && <span className="text-st-verifying-fg">{warn} warning</span>}
                {resolved > 0 && <span className="text-st-unknown-fg">{resolved} resolved</span>}
                {!crit && !warn && !resolved && <span className="text-fg-3">all clear</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
