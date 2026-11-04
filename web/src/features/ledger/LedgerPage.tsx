import { useMemo } from "react";
import { Link, useSearchParams } from "react-router";
import { motion } from "motion/react";
import { Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { NumberRoll } from "@/components/NumberRoll";
import { Skeleton } from "@/components/ui/skeleton";
import { useActions, useLedger } from "@/hooks/queries";
import { clock } from "@/lib/time";
import { RULE_SPRING } from "@/lib/motion";
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
        <p className="bg-st-failed-soft px-5 py-4 text-[16px] text-st-failed-fg">The provider is not answering, so its ledger cannot be read. Its data is safe on disk; restart it from Chaos.</p>
      ) : !ledger.data ? (
        <Skeleton className="h-96 rounded-none bg-well" />
      ) : (
        <>
          <dl className="mb-16 grid grid-cols-2 gap-x-10 border-t-2 border-ink sm:grid-cols-4">
            <Stat label="Effects applied" value={effects.length} />
            {kinds.map((k) => <Stat key={k} label={`${k[0].toUpperCase()}${k.slice(1)}s`} value={effects.filter((e) => e.kind === k).length} />)}
            <Stat label="In a duplicate group" value={dupes} bad={dupes > 0} />
            <Stat label="With no OneShot action" value={orphans} bad={orphans > 0} />
          </dl>
          <div className="mb-6 flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <div role="radiogroup" aria-label="Filter by kind" className="flex flex-wrap gap-x-6">
              {[null, ...kinds].map((k) => (
                <button key={k ?? "all"} type="button" role="radio" aria-checked={kind === k} onClick={() => set("kind", k)} className={cn("relative h-10 text-[15px] transition-colors duration-150", kind === k ? "font-medium text-ink" : "text-ink-2 hover:text-ink")}>
                  {k ? `${k[0].toUpperCase()}${k.slice(1)}s` : "All kinds"}
                  {kind === k && <motion.span layoutId="ledger-kind" aria-hidden className="absolute inset-x-0 bottom-0 h-[2px] bg-mark" transition={RULE_SPRING} />}
                </button>
              ))}
            </div>
            <label className="relative">
              <span className="sr-only">Search the ledger</span>
              <Search aria-hidden className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-2" />
              <input name="q" autoComplete="off" spellCheck={false} defaultValue={q} onChange={(e) => set("q", e.target.value || null)} placeholder="Effect id, reference or key…" className="field w-72 pl-9 text-[14.5px] placeholder:text-ink-3" />
            </label>
          </div>
          <div className="overflow-x-auto" data-lenis-prevent-horizontal>
            <table className="w-full min-w-[820px] text-[14.5px]">
              <thead>
                <tr className="border-t-2 border-b border-ink text-left text-[13px] text-ink-2">
                  <th className="py-3 pr-4 font-normal">Effect</th>
                  <th className="py-3 pr-4 font-normal">Kind</th>
                  <th className="py-3 pr-4 font-normal">Reference (OneShot action)</th>
                  <th className="py-3 pr-4 font-normal">Idempotency key</th>
                  <th className="hidden py-3 pr-4 font-normal xl:table-cell">Payload</th>
                  <th className="py-3 text-right font-normal">Applied at</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((e) => {
                  const dup = e.reference && (perRef.get(e.reference) ?? 0) > 1;
                  const orphan = actions.data && e.reference && !known.has(e.reference);
                  return (
                    <tr key={e.id} className={cn("border-b border-rule", (dup || orphan) && "bg-st-failed-soft")}>
                      <td className="py-3 pr-4 font-mono text-[13.5px] font-medium">{e.id}</td>
                      <td className="py-3 pr-4 text-ink-2">{e.kind}</td>
                      <td className="py-3 pr-4">
                        {e.reference && known.has(e.reference) ? <Link to={`/actions/${e.reference}`} className="ink-link font-mono text-[13.5px]">{e.reference}</Link> : <span className="font-mono text-[13.5px]">{e.reference ?? "none"}</span>}
                        {dup && <span className="ml-2 text-[13px] font-medium text-st-failed-fg">duplicate</span>}
                        {orphan && <span className="ml-2 text-[13px] font-medium text-st-failed-fg">no such action</span>}
                      </td>
                      <td className="py-3 pr-4 font-mono text-[13px] text-ink-2">{e.idempotency_key ?? <span className="font-sans text-ink-3">none (not supported)</span>}</td>
                      <td className="hidden max-w-80 truncate py-3 pr-4 font-mono text-[12.5px] text-ink-2 xl:table-cell" title={JSON.stringify(e.payload)}>{JSON.stringify(e.payload)}</td>
                      <td className="py-3 text-right font-mono text-[13px] text-ink-2">{clock(e.created_at)}</td>
                    </tr>
                  );
                })}
              </tbody>
              {shown.length > 0 && (
                <tfoot>
                  <tr className="border-t-[3px] border-double border-ink">
                    <td colSpan={6} className="py-3 text-[14px] text-ink-2">{shown.length === effects.length ? `${effects.length} effects in total.` : `${shown.length} of ${effects.length} effects shown.`}</td>
                  </tr>
                </tfoot>
              )}
            </table>
            {shown.length === 0 && <p className="py-12 font-display text-[19px] text-ink-3 italic">{effects.length ? "No effects match this filter." : "The provider has not applied anything yet."}</p>}
          </div>
        </>
      )}
    </>
  );
}

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="border-b border-rule py-4">
      <dt className="text-[14px] text-ink-2">{label}</dt>
      <dd className={cn("mt-1 font-display text-[52px] leading-none", bad && "text-st-failed-fg", !bad && value === 0 && "text-ink-3")}><NumberRoll value={value} /></dd>
    </div>
  );
}
