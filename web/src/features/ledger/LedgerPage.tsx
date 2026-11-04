import { Fragment, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ChevronRight, Search } from "lucide-react";
import { PageHeader } from "@/components/PageHeader";
import { NumberRoll } from "@/components/NumberRoll";
import { Skeleton } from "@/components/ui/skeleton";
import { useActions, useLedger } from "@/hooks/queries";
import { clock } from "@/lib/time";
import { EASE_OUT, RULE_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function LedgerPage() {
  const ledger = useLedger();
  const actions = useActions();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<string | null>(null);
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
        <p className="rounded-[12px] border border-st-failed/30 bg-st-failed-soft px-5 py-4 text-[14px] text-st-failed-fg">The provider is not answering, so its ledger cannot be read. Its data is safe on disk; restart it from Chaos.</p>
      ) : !ledger.data ? (
        <Skeleton className="h-96 rounded-[12px]" />
      ) : (
        <>
          <dl className="panel mb-4 grid grid-cols-2 overflow-hidden sm:grid-cols-4">
            <Stat label="Effects applied" value={effects.length} />
            {kinds.map((k) => <Stat key={k} label={`${k[0].toUpperCase()}${k.slice(1)}s`} value={effects.filter((e) => e.kind === k).length} />)}
            <Stat label="In a duplicate group" value={dupes} bad={dupes > 0} />
            <Stat label="With no OneShot action" value={orphans} bad={orphans > 0} />
          </dl>

          <section className="panel overflow-hidden" aria-label="Effects">
            <div className="flex flex-wrap items-center gap-3 border-b border-line px-[18px] py-3">
              <h2 className="t-h3 mr-auto">Effects</h2>
              <div role="radiogroup" aria-label="Filter by kind" className="flex gap-0.5 rounded-[9px] border border-line bg-sunken p-0.5">
                {[null, ...kinds].map((k) => (
                  <button key={k ?? "all"} type="button" role="radio" aria-checked={kind === k} onClick={() => set("kind", k)} className={cn("relative h-7 rounded-[7px] px-2.5 text-[12.5px] transition-colors duration-150", kind === k ? "font-[560] text-fg" : "text-fg-2 hover:text-fg")}>
                    {kind === k && <motion.span layoutId="ledger-kind" aria-hidden className="absolute inset-0 rounded-[7px] border border-line bg-surface shadow-[var(--shadow-card)]" transition={RULE_SPRING} />}
                    <span className="relative">{k ? `${k[0].toUpperCase()}${k.slice(1)}s` : "All kinds"}</span>
                  </button>
                ))}
              </div>
              <label className="relative">
                <span className="sr-only">Search the ledger</span>
                <Search aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-fg-3" />
                <input name="q" autoComplete="off" spellCheck={false} defaultValue={q} onChange={(e) => set("q", e.target.value || null)} placeholder="Effect id, reference or key" className="field h-8 w-60 pl-8 text-[13px] placeholder:text-fg-3" />
              </label>
            </div>
            <div className="overflow-x-auto" data-lenis-prevent-horizontal>
              <table className="w-full min-w-[820px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] text-fg-3">
                    <th className="w-8 py-2.5 pl-[18px]" />
                    <th className="py-2.5 pr-4 font-[500]">Effect</th>
                    <th className="py-2.5 pr-4 font-[500]">Kind</th>
                    <th className="py-2.5 pr-4 font-[500]">Reference (OneShot action)</th>
                    <th className="py-2.5 pr-4 font-[500]">Idempotency key</th>
                    <th className="py-2.5 pr-[18px] text-right font-[500]">Applied at</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((e) => {
                    const dup = e.reference && (perRef.get(e.reference) ?? 0) > 1;
                    const orphan = actions.data && e.reference && !known.has(e.reference);
                    const isOpen = open === e.id;
                    return (
                      <Fragment key={e.id}>
                        <tr onClick={() => setOpen(isOpen ? null : e.id)} className={cn("cursor-pointer border-b border-line transition-colors duration-150 hover:bg-sunken", (dup || orphan) && "bg-st-failed-soft/60")}>
                          <td className="py-2.5 pl-[18px]">
                            <button type="button" aria-expanded={isOpen} aria-label={`Show the payload of ${e.id}`} className="grid size-5 place-items-center rounded-[5px] text-fg-3" onClick={(ev) => { ev.stopPropagation(); setOpen(isOpen ? null : e.id); }}>
                              <ChevronRight aria-hidden className={cn("size-3.5 transition-transform duration-200", isOpen && "rotate-90")} />
                            </button>
                          </td>
                          <td className="py-2.5 pr-4 font-mono text-[12.5px] font-[560]">{e.id}</td>
                          <td className="py-2.5 pr-4 text-fg-2">{e.kind}</td>
                          <td className="py-2.5 pr-4" onClick={(ev) => ev.stopPropagation()}>
                            {e.reference && known.has(e.reference) ? <Link to={`/actions/${e.reference}`} className="link-quiet font-mono text-[12.5px] text-fg-2">{e.reference}</Link> : <span className="font-mono text-[12.5px] text-fg-2">{e.reference ?? "none"}</span>}
                            {dup && <span className="ml-2 rounded-[5px] bg-st-failed-soft px-1.5 py-0.5 text-[11px] font-[600] text-st-failed-fg">duplicate</span>}
                            {orphan && <span className="ml-2 rounded-[5px] bg-st-failed-soft px-1.5 py-0.5 text-[11px] font-[600] text-st-failed-fg">no such action</span>}
                          </td>
                          <td className="py-2.5 pr-4 font-mono text-[12px] text-fg-2">{e.idempotency_key ?? <span className="font-sans text-fg-3">none (not supported)</span>}</td>
                          <td className="py-2.5 pr-[18px] text-right font-mono text-[12px] text-fg-2">{clock(e.created_at)}</td>
                        </tr>
                        <AnimatePresence initial={false}>
                          {isOpen && (
                            <tr className="border-b border-line bg-sunken">
                              <td colSpan={6} className="p-0">
                                <motion.pre initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} className="overflow-hidden px-[52px] font-mono text-[12px] leading-relaxed text-fg-2">
                                  <span className="block py-3">{JSON.stringify(e.payload, null, 2)}</span>
                                </motion.pre>
                              </td>
                            </tr>
                          )}
                        </AnimatePresence>
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {shown.length === 0 && <p className="px-[18px] py-10 text-center text-[13px] text-fg-3">{effects.length ? "No effects match this filter." : "The provider has not applied anything yet."}</p>}
              {shown.length > 0 && <p className="border-t border-line px-[18px] py-2.5 text-[12px] text-fg-3">{shown.length === effects.length ? `${effects.length} effects in total.` : `${shown.length} of ${effects.length} effects shown.`} Click a row for its payload.</p>}
            </div>
          </section>
        </>
      )}
    </>
  );
}

function Stat({ label, value, bad }: { label: string; value: number; bad?: boolean }) {
  return (
    <div className="border-line px-[18px] py-4 not-first:border-l max-sm:[&:nth-child(3)]:border-l-0 max-sm:[&:nth-child(n+3)]:border-t">
      <dt className="text-[12.5px] text-fg-3">{label}</dt>
      <dd className={cn("t-figure mt-2 text-[28px]", bad && "text-st-failed-fg", !bad && value === 0 && "text-fg-3")}><NumberRoll value={value} /></dd>
    </div>
  );
}
