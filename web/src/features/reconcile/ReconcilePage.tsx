import { useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, Loader2, Play, ScanSearch } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Section } from "@/components/PageHeader";
import { NumberRoll } from "@/components/NumberRoll";
import { StatusPill } from "@/components/StatusPill";
import { Skeleton } from "@/components/ui/skeleton";
import { useActions, useLedger, useRun, useRuns } from "@/hooks/queries";
import { ops, type Finding, type ReconcileRun, type Severity } from "@/lib/api";
import { FINDING_GUIDE, SEVERITY_ORDER, SEVERITY_STYLE, diffRows, type DiffRow } from "@/lib/findings";
import { ago, clock } from "@/lib/time";
import { EASE_OUT } from "@/lib/motion";
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
            <button type="button" onClick={() => go.mutate(false)} disabled={go.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-lg border bg-card px-3 text-sm disabled:opacity-50">
              <ScanSearch aria-hidden className="size-4" /> Dry run
            </button>
            <button type="button" onClick={() => go.mutate(true)} disabled={go.isPending} className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-foreground px-3 text-sm font-medium text-background disabled:opacity-50">
              {go.isPending ? <Loader2 aria-hidden className="size-4 animate-spin" /> : <Play aria-hidden className="size-4" />}
              {go.isPending ? "Reconciling…" : "Run reconciliation"}
            </button>
          </>
        }
      >
        Compare everything OneShot believes with the provider's own ledger, fetched over HTTP. Reconciliation resolves UNKNOWN actions; everything else it only flags, because the agent was already told a final answer. A dry run changes nothing.
      </PageHeader>

      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_280px]">
        <div className="min-w-0">
          {runs.data && runs.data.length === 0 ? (
            <div className="mb-12 rounded-[14px] border border-dashed p-8 text-center text-sm text-muted-foreground">No runs yet. Run reconciliation to compare OneShot's records with the provider's ledger.</div>
          ) : !run.data ? (
            <Skeleton className="mb-12 h-48 rounded-[14px]" />
          ) : (
            <RunReport run={run.data} />
          )}
          <Section title="Side by side, right now" about="Every OneShot action next to the effects the provider's ledger holds for it. This is computed live, not from the selected run.">
            <Diff />
          </Section>
        </div>
        <aside className="lg:sticky lg:top-20 lg:self-start">
          <h2 className="mb-3 text-sm font-medium">History</h2>
          <History runs={runs.data ?? []} selected={selectedId} onSelect={(id) => setParams({ run: String(id) }, { replace: true, preventScrollReset: true })} />
        </aside>
      </div>
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
  return (
    <section className="mb-12" aria-labelledby="run-title">
      <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="run-title" className="text-lg font-semibold tracking-tight">
          Run #{run.id} <span className="font-normal text-muted-foreground">{run.applied ? "" : "(dry run)"}</span>
        </h2>
        <p className="text-sm text-muted-foreground">
          {clock(run.at).slice(0, 8)}, {ago(run.at)}. Checked {run.actions_checked} actions against {run.effects_checked} effects.
        </p>
      </div>
      <div className="mb-5 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border bg-border sm:grid-cols-5">
        {SEVERITY_ORDER.map((s) => (
          <div key={s} className="bg-card px-4 py-3">
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><span className={cn("size-1.5 rounded-full", SEVERITY_STYLE[s].dot)} />{SEVERITY_STYLE[s].label}</p>
            <NumberRoll value={count(run, s)} className="text-2xl font-semibold" />
          </div>
        ))}
      </div>
      {notable.length === 0 ? (
        <p className="rounded-xl border border-st-succeeded/30 bg-st-succeeded-soft px-4 py-3 text-sm text-st-succeeded-fg">Everything agrees: {ok} actions match the provider's ledger, and nothing needs attention.</p>
      ) : (
        <ul className="space-y-2">
          {notable.map((f, i) => <FindingRow key={`${f.kind}-${f.action_id}-${i}`} finding={f} index={i} />)}
          {ok > 0 && <li className="px-1 pt-1 text-sm text-muted-foreground">Plus {ok} matching action{ok > 1 ? "s" : ""}.</li>}
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
    <motion.li initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.25, delay: Math.min(index, 8) * 0.03, ease: EASE_OUT }} className="rounded-xl border bg-card">
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex w-full items-start gap-3 px-4 py-3 text-left">
        <span className={cn("mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium", style.chip)}>{style.label}</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-medium">{guide?.title ?? finding.kind}</span>
          <span className="block text-[13px] text-muted-foreground">{finding.message}</span>
        </span>
        {finding.action_id && <span className="hidden font-mono text-xs text-muted-foreground sm:block">{finding.action_id}</span>}
        <ChevronDown aria-hidden className={cn("mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform duration-200", open && "rotate-180")} />
      </button>
      <AnimatePresence initial={false}>
        {open && guide && (
          <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.22, ease: EASE_OUT }} className="overflow-hidden">
            <dl className="grid gap-3 border-t px-4 py-3 text-[13.5px] sm:grid-cols-3">
              <div><dt className="text-xs text-muted-foreground">What it means</dt><dd className="mt-0.5">{guide.means}</dd></div>
              <div><dt className="text-xs text-muted-foreground">How it happens</dt><dd className="mt-0.5">{guide.how}</dd></div>
              <div><dt className="text-xs text-muted-foreground">What to do</dt><dd className="mt-0.5">{guide.todo}</dd></div>
            </dl>
            {finding.action_id && (
              <p className="px-4 pb-3 text-sm">
                <Link to={`/actions/${finding.action_id}`} className="underline underline-offset-2">Open {finding.action_id}</Link>
                {finding.effect_ids.length > 0 && <span className="text-muted-foreground"> with effects {finding.effect_ids.join(", ")}</span>}
              </p>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.li>
  );
}

const DIFF_STYLE: Record<DiffRow["kind"], { label: string; line: string }> = {
  match: { label: "match", line: "stroke-st-succeeded" },
  none: { label: "no effect", line: "stroke-muted-foreground/40" },
  missing: { label: "missing at provider", line: "stroke-st-failed" },
  unexpected: { label: "applied but FAILED", line: "stroke-st-failed" },
  duplicate: { label: "duplicate", line: "stroke-st-failed" },
  orphan: { label: "orphan", line: "stroke-st-failed" },
};

function Diff() {
  const actions = useActions();
  const ledger = useLedger();
  const [problemsOnly, setProblemsOnly] = useState(false);
  if (ledger.isError) return <p className="rounded-xl border border-dashed px-4 py-3 text-sm text-muted-foreground">The provider's ledger cannot be read right now, so there is nothing to compare against.</p>;
  if (!actions.data || !ledger.data) return <Skeleton className="h-64 rounded-[14px]" />;
  const statusById = new Map(actions.data.map((a) => [a.id, a.status]));
  const all = diffRows([...actions.data].sort((a, b) => b.created_at - a.created_at), ledger.data.effects);
  const rows = problemsOnly ? all.filter((r) => !["match", "none"].includes(r.kind)) : all;
  return (
    <div>
      <label className="mb-3 inline-flex items-center gap-2 text-sm">
        <input type="checkbox" checked={problemsOnly} onChange={(e) => setProblemsOnly(e.target.checked)} className="size-4 accent-foreground" />
        Show only problems ({all.filter((r) => !["match", "none"].includes(r.kind)).length})
      </label>
      <div className="overflow-hidden rounded-[14px] border bg-card">
        <div className="grid grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)] border-b px-4 py-2.5 text-xs text-muted-foreground">
          <span>OneShot's record</span>
          <span className="text-center">Link</span>
          <span>Provider's ledger</span>
        </div>
        <ul className="max-h-[560px] overflow-y-auto" data-lenis-prevent>
          {rows.slice(0, 300).map((r, i) => {
            const st = r.actionId ? statusById.get(r.actionId) : undefined;
            const bad = !["match", "none"].includes(r.kind);
            return (
              <motion.li key={r.actionId ?? r.effectIds.join()} initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true, margin: "40px" }} transition={{ duration: 0.3, delay: Math.min(i, 6) * 0.02 }} className={cn("grid grid-cols-[minmax(0,1fr)_120px_minmax(0,1fr)] items-center gap-2 border-b px-4 py-2 last:border-0", bad && "bg-st-failed-soft/40")}>
                <span className="flex min-w-0 items-center gap-2">
                  {r.actionId ? (
                    <>
                      <Link to={`/actions/${r.actionId}`} className="truncate font-mono text-xs hover:underline">{r.actionId}</Link>
                      {st && <StatusPill status={st} explain={false} />}
                    </>
                  ) : (
                    <span className="text-xs text-st-failed-fg">no OneShot action</span>
                  )}
                </span>
                <Connector row={r} />
                <span className="flex min-w-0 flex-wrap gap-1">
                  {r.effectIds.length ? r.effectIds.map((e) => <span key={e} className={cn("rounded-md border px-1.5 py-0.5 font-mono text-[11px]", bad ? "border-st-failed/40" : "")}>{e}</span>) : <span className="text-xs text-muted-foreground">nothing</span>}
                </span>
              </motion.li>
            );
          })}
        </ul>
      </div>
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
            return <path key={i} d={`M4 12 C 50 12, 50 ${y}, 96 ${y}`} fill="none" strokeWidth={1.6} className={s.line} />;
          })
        )}
      </svg>
      <span className={cn("text-[10px]", row.kind === "match" || row.kind === "none" ? "text-muted-foreground" : "text-st-failed-fg")}>{s.label}</span>
    </span>
  );
}

function History({ runs, selected, onSelect }: { runs: ReconcileRun[]; selected: number | null; onSelect: (id: number) => void }) {
  if (!runs.length) return <p className="text-sm text-muted-foreground">No runs yet.</p>;
  return (
    <ol className="relative max-h-[70vh] space-y-1 overflow-y-auto" data-lenis-prevent>
      {runs.map((r) => {
        const crit = Object.entries(r.summary).filter(([k]) => ["MISSING_EFFECT", "UNEXPECTED_EFFECT", "DUPLICATE_EFFECT", "ORPHAN_EFFECT"].includes(k)).reduce((n, [, v]) => n + v, 0);
        const warn = (r.summary.UNRESOLVED_UNKNOWN ?? 0) + (r.summary.SUSPECTED_DUPLICATE_REQUEST ?? 0);
        const resolved = (r.summary.RESOLVED_SUCCEEDED ?? 0) + (r.summary.RESOLVED_FAILED ?? 0);
        return (
          <li key={r.id}>
            <button type="button" onClick={() => onSelect(r.id)} aria-current={selected === r.id} className={cn("relative w-full rounded-lg px-3 py-2 text-left text-sm transition-colors", selected === r.id ? "" : "hover:bg-muted/60")}>
              {selected === r.id && <motion.span layoutId="run-selected" className="absolute inset-0 rounded-lg border bg-card" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
              <span className="relative flex items-center justify-between">
                <span className="font-medium">#{r.id}{!r.applied && <span className="font-normal text-muted-foreground"> dry</span>}</span>
                <time className="text-xs text-muted-foreground">{ago(r.at)}</time>
              </span>
              <span className="relative mt-1 flex gap-2 text-xs">
                {crit > 0 && <span className="text-st-failed-fg">{crit} critical</span>}
                {warn > 0 && <span className="text-st-verifying-fg">{warn} warning</span>}
                {resolved > 0 && <span className="text-st-unknown-fg">{resolved} resolved</span>}
                {!crit && !warn && !resolved && <span className="text-muted-foreground">all clear</span>}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}
