import { useEffect, useState } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, FlaskConical, Scale } from "lucide-react";
import { Panel } from "@/components/PageHeader";
import { SetHeadline } from "@/components/SetHeadline";
import { Skeleton } from "@/components/ui/skeleton";
import { useActions, useLabState, useLedger, useSystemStatus } from "@/hooks/queries";
import { frontPage } from "@/lib/headline";
import { EASE_OUT } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { ActionList, Activity, NeedsYou, StatusStrip } from "./Board";
import { Topology } from "./Topology";

/** Live. Its one question: does anything need me right now? The headline
 * answers it in words, the system map shows it moving, and the strip, list
 * and queue back it up. */
export function LivePage() {
  const status = useSystemStatus();
  const actions = useActions();
  const lab = useLabState(!!status.data?.lab);
  const ledger = useLedger();
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 2000);
    return () => clearInterval(t);
  }, []);

  const all = [...(actions.data ?? [])].sort((a, b) => b.created_at - a.created_at);
  const fp = frontPage(status.data, status.isError);
  const s = status.data?.settings;
  const dot = fp.tone === "attention" ? "bg-st-unknown" : fp.tone === "trouble" ? "bg-st-failed" : "bg-st-succeeded";

  return (
    <>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
        <div className="min-w-0">
          <SetHeadline text="Live" className="t-title" />
          <AnimatePresence mode="wait" initial={false}>
            <motion.p key={fp.headline} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }} className="mt-2.5 flex items-center gap-2.5 text-[15px] text-fg-2">
              <span className={cn("size-2 shrink-0 rounded-full", dot)} />
              <span>
                <span className="font-[560] text-fg">{fp.headline}</span> {fp.standfirst}
              </span>
            </motion.p>
          </AnimatePresence>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {fp.links.slice(0, 1).map((l) => (
            <Link key={l.to} to={l.to} className="btn btn-outline">{l.label}</Link>
          ))}
          <Link to="/reconcile" className="btn btn-outline"><Scale aria-hidden className="size-3.5" />Reconcile</Link>
          <Link to="/chaos" className="btn btn-signal"><FlaskConical aria-hidden className="size-3.5" />Break something</Link>
        </div>
      </header>

      <Panel
        className="mb-4 overflow-hidden"
        bodyClassName="p-0"
        title={<h2 className="t-h3">System map</h2>}
        aside={s && <span className="hidden font-mono text-[11.5px] text-fg-3 sm:block">timeout {s.provider_timeout_seconds}s · lease {s.lease_seconds}s · settle {s.provider_settle_seconds}s</span>}
      >
        <Topology actions={actions.data} status={status.data} lab={lab.data} effects={ledger.data?.effects.length} />
      </Panel>

      <div className="mb-4">
        <StatusStrip status={status.data} />
      </div>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">{actions.isPending ? <Skeleton className="h-80 w-full rounded-[12px]" /> : <ActionList actions={all} />}</div>
        <div className="flex min-w-0 flex-col gap-4 lg:col-span-4">
          <Panel title="Needs you" aside={<Link to="/reconcile" className="link-quiet flex items-center gap-1 text-[12.5px] text-fg-2">Reconcile <ArrowRight aria-hidden className="size-3" /></Link>}>
            <NeedsYou actions={all} />
          </Panel>
          <Panel title="Throughput">
            <Activity actions={all} now={now} />
          </Panel>
        </div>
      </div>
    </>
  );
}
