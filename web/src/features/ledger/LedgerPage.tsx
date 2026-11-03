import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { motion } from "motion/react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { NumberRoll } from "@/components/NumberRoll";
import { Skeleton } from "@/components/ui/skeleton";
import { useActions, useLedger } from "@/hooks/queries";
import { clock } from "@/lib/time";
import { cn } from "@/lib/utils";

export function LedgerPage() {
  const ledger = useLedger();
  const actions = useActions();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const kind = params.get("kind");

  const known = useMemo(() => new Set((actions.data ?? []).map((a) => a.id)), [actions.data]);
  const effects = useMemo(() => [...(ledger.data?.effects ?? [])].sort((a, b) => b.created_at - a.created_at), [ledger.data]);
  const perRef = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of effects) if (e.reference) m.set(e.reference, (m.get(e.reference) ?? 0) + 1);
    return m;
  }, [effects]);
  const kinds = [...new Set(effects.map((e) => e.kind))];
  const shown = effects.filter((e) => (!kind || e.kind === kind) && (!q || [e.id, e.reference ?? "", e.idempotency_key ?? ""].some((s) => s.includes(q))));
  const dupes = effects.filter((e) => e.reference && (perRef.get(e.reference) ?? 0) > 1).length;
  const orphans = actions.data ? effects.filter((e) => e.reference && !known.has(e.reference)).length : 0;

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true, preventScrollReset: true });
  };

  return (
    <>
      <PageHeader title="Provider ledger">
        The fake provider's own record of every effect it applied, read over HTTP from its separate process and database. When OneShot and this ledger disagree, this ledger is the truth about what happened.
      </PageHeader>
      {ledger.isError ? (
        <p className="rounded-[14px] border border-st-failed/30 bg-st-failed-soft px-4 py-3 text-sm text-st-failed-fg">The provider is not answering, so its ledger cannot be read. Its data is safe on disk; restart it from Chaos.</p>
      ) : !ledger.data ? (
        <Skeleton className="h-96 rounded-[14px]" />
      ) : (
        <>
          <dl className="mb-8 grid grid-cols-2 gap-px overflow-hidden rounded-[14px] border bg-border sm:grid-cols-4">
            <Stat label="Effects applied" value={effects.length} />
            {kinds.map((k) => <Stat key={k} label={`${k[0].toUpperCase()}${k.slice(1)}s`} value={effects.filter((e) => e.kind === k).length} />)}
            <Stat label="In a duplicate group" value={dupes} bad={dupes > 0} />
            <Stat label="With no OneShot action" value={orphans} bad={orphans > 0} />
          </dl>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            {[null, ...kinds].map((k) => (
              <button key={k ?? "all"} type="button" aria-pressed={kind === k} onClick={() => set("kind", k)} className={cn("relative h-8 rounded-lg px-3 text-xs", kind === k ? "text-foreground" : "text-muted-foreground hover:text-foreground")}>
                {kind === k && <motion.span layoutId="ledger-kind" className="absolute inset-0 rounded-lg border bg-card shadow-xs" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
                <span className="relative">{k ?? "All kinds"}</span>
              </button>
            ))}
            <label className="relative ml-auto">
              <span className="sr-only">Search the ledger</span>
              <Search aria-hidden className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <input name="q" autoComplete="off" spellCheck={false} defaultValue={q} onChange={(e) => set("q", e.target.value || null)} placeholder="Effect id, reference or key…" className="h-8 w-60 rounded-lg border bg-card pr-3 pl-8 text-[13px]" />
            </label>
          </div>
          <div className="overflow-x-auto rounded-[14px] border bg-card" data-lenis-prevent>
            <table className="w-full text-[13px]">
              <thead>
                <tr className="border-b text-left text-xs text-muted-foreground">
                  <th className="px-4 py-2.5 font-medium">Effect</th>
                  <th className="px-4 py-2.5 font-medium">Kind</th>
                  <th className="px-4 py-2.5 font-medium">Reference (OneShot action)</th>
                  <th className="px-4 py-2.5 font-medium">Idempotency key</th>
                  <th className="hidden px-4 py-2.5 font-medium lg:table-cell">Payload</th>
                  <th className="px-4 py-2.5 text-right font-medium">Applied at</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => {
                  const dup = e.reference && (perRef.get(e.reference) ?? 0) > 1;
                  const orphan = actions.data && e.reference && !known.has(e.reference);
                  return (
                    <tr key={e.id} className={cn("border-b last:border-0", (dup || orphan) && "bg-st-failed-soft/40")}>
                      <td className="px-4 py-2.5 font-mono text-xs font-medium">{e.id}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{e.kind}</td>
                      <td className="px-4 py-2.5">
                        {e.reference && known.has(e.reference) ? <Link to={`/actions/${e.reference}`} className="font-mono text-xs hover:underline">{e.reference}</Link> : <span className="font-mono text-xs">{e.reference ?? "none"}</span>}
                        {dup && <span className="ml-2 text-xs text-st-failed-fg">duplicate</span>}
                        {orphan && <span className="ml-2 text-xs text-st-failed-fg">no such action</span>}
                      </td>
                      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">{e.idempotency_key ?? "none (not supported)"}</td>
                      <td className="hidden max-w-72 truncate px-4 py-2.5 font-mono text-[11px] text-muted-foreground lg:table-cell" title={JSON.stringify(e.payload)}>{JSON.stringify(e.payload)}</td>
                      <td className="px-4 py-2.5 text-right font-mono text-xs text-muted-foreground">{clock(e.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {shown.length === 0 && <p className="px-4 py-10 text-center text-sm text-muted-foreground">{effects.length ? "No effects match this filter." : "The provider has not applied anything yet."}</p>}
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="bg-card px-4 py-3">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("text-2xl font-semibold", bad && "text-st-failed-fg")}><NumberRoll value={value} /></dd>
    </div>
  );
}
