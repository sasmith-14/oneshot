import { Link, useParams, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, CircleHelp } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyId } from "@/components/CopyId";
import { Panel } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { SetHeadline } from "@/components/SetHeadline";
import { StateMachine, pathTaken } from "@/components/StateMachine";
import { TabBar } from "@/components/Tabs";
import { useAction, useActionTypes, useProviderRecord } from "@/hooks/queries";
import { buildFlow } from "@/lib/flow";
import { noun, storyHeadline } from "@/lib/headline";
import { STATUS_META } from "@/lib/status";
import { ago } from "@/lib/time";
import { EASE_OUT } from "@/lib/motion";
import { FlowSequence } from "./FlowSequence";
import { LedgerCompare } from "./LedgerCompare";
import { ResolveDialog } from "./ResolveDialog";
import { Timeline } from "./Timeline";
import { Trace } from "./Trace";

const TABS = [
  { id: "trace", label: "Trace" },
  { id: "sequence", label: "Sequence" },
  { id: "timeline", label: "Timeline" },
  { id: "ledger", label: "Ledger" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** One action: what happened, in a sentence; the evidence, as a trace, a
 * message sequence, a timeline and the two records side by side; and the
 * route it took through the lifecycle. */
export function ActionPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "trace") as Tab;
  const { data: action, error, isPending } = useAction(id);
  const record = useProviderRecord(id);
  const types = useActionTypes();

  if (isPending) return <Skeleton className="h-[520px] w-full rounded-[12px]" />;
  if (error || !action)
    return (
      <div className="py-16">
        <p className="t-title">There is no action <span className="font-mono text-[0.7em]">{id}</span></p>
        <p className="mt-3 text-fg-2">Check the id, or <Link to="/" className="link">go back to Live</Link>.</p>
      </div>
    );

  const type = types.data?.find((t) => t.name === action.type);
  const rows = buildFlow(action, record.data?.effects, { idempotent: type?.idempotent_at_provider });
  const nextIn = action.next_attempt_at ? action.next_attempt_at - Date.now() / 1000 : null;
  const headline = storyHeadline(action);

  return (
    <article>
      <Link to="/" className="link-quiet mb-6 inline-flex items-center gap-1.5 text-[13px] text-fg-2">
        <ArrowLeft aria-hidden className="size-3.5" /> Live
      </Link>

      <header className="mb-6 grid gap-x-10 gap-y-6 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <div className="flex flex-wrap items-center gap-2">
            <motion.span key={action.status} initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
              <StatusPill status={action.status} size="md" />
            </motion.span>
            <CopyId value={action.id} className="chip h-7 font-mono text-[12px]" />
            <span className="chip h-7">{noun(action.type)}</span>
            {type && <span className="chip h-7">{type.idempotent_at_provider ? "provider deduplicates by key" : "no deduplication at provider"}</span>}
            <span className="chip h-7">created {ago(action.created_at)}</span>
          </div>
          <SetHeadline key={headline} text={headline} className="t-hero mt-5" />
          <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-fg-2">{STATUS_META[action.status].meaning}</p>
        </div>
        <dl className="panel grid grid-cols-2 self-end overflow-hidden lg:col-span-4">
          <Fact k="Sends">{action.attempt_count}</Fact>
          <Fact k="Ledger checks" border>{action.verify_count}</Fact>
          <Fact k="Next step" top>{nextIn !== null && nextIn > 0 ? `in ${nextIn.toFixed(1)}s` : ["PENDING", "VERIFYING"].includes(action.status) ? "due now" : "none"}</Fact>
          <Fact k="Effect id" top border mono>{action.provider_effect_id ?? "none"}</Fact>
        </dl>
      </header>

      <AnimatePresence initial={false}>
        {action.status === "UNKNOWN" && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
            <div className="mb-6 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 rounded-[12px] border border-st-unknown/30 bg-st-unknown-soft px-5 py-4 text-st-unknown-fg">
              <p className="flex max-w-2xl items-start gap-2.5 text-[14px]">
                <CircleHelp aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span><b className="font-[600]">OneShot stopped instead of guessing.</b> Check the provider's record, then resolve it here, or let reconciliation do it.</span>
              </p>
              <ResolveDialog action={action} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section className="panel mb-4 min-w-0 overflow-hidden" aria-label="Evidence">
        <div className="panel-head flex-wrap">
          <TabBar id="action" tabs={[...TABS]} value={tab} onChange={(t) => setParams(t === "trace" ? {} : { tab: t }, { replace: true, preventScrollReset: true })} />
          <span className="text-[12.5px] text-fg-3">
            {tab === "trace" && "Status over time, every attempt, and what the ledger recorded"}
            {tab === "sequence" && "Every message between the four parties, with real timestamps"}
            {tab === "timeline" && "Each decision, with the reason in plain English"}
            {tab === "ledger" && "OneShot's record next to the provider's ledger"}
          </span>
        </div>
        <div id="action-panel" role="tabpanel" aria-labelledby={`action-tab-${tab}`} className="p-[18px]">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.22, ease: EASE_OUT }}>
              {tab === "trace" && <Trace action={action} effects={record.data?.effects} />}
              {tab === "sequence" && (
                <>
                  {record.isError && (
                    <p className="mb-4 rounded-[10px] bg-st-verifying-soft px-4 py-3 text-[13.5px] text-st-verifying-fg">
                      The provider's ledger cannot be read right now, so the ledger lane is empty. That does <b>not</b> mean nothing happened at the provider.
                    </p>
                  )}
                  <FlowSequence rows={rows} start={action.created_at} />
                </>
              )}
              {tab === "timeline" && <Timeline action={action} />}
              {tab === "ledger" && <LedgerCompare action={action} effects={record.data?.effects} error={record.error ? (record.error as Error).message : undefined} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-12">
        <Panel className="lg:col-span-8" title="The route it took" aside={<span className="text-[12.5px] text-fg-3">orange marks the path; a number, a step taken more than once</span>}>
          <StateMachine current={action.status} path={pathTaken(action.events)} className="mx-auto max-h-[280px]" />
        </Panel>
        <Panel className="lg:col-span-4" title="Payload" aside={<span className="font-mono text-[11.5px] text-fg-3">{action.type}</span>}>
          <pre className="well max-h-[260px] overflow-auto p-3.5 font-mono text-[12px] leading-relaxed" data-lenis-prevent>{JSON.stringify(action.payload, null, 2)}</pre>
          {action.resolution && <p className="mt-3 text-[12.5px] text-fg-2"><span className="font-[560] text-fg">Resolution: </span>{action.resolution}</p>}
        </Panel>
      </div>
    </article>
  );
}

function Fact({ k, children, mono, border, top }: { k: string; children: React.ReactNode; mono?: boolean; border?: boolean; top?: boolean }) {
  return (
    <div className={`min-w-0 px-4 py-3.5 ${border ? "border-l border-line" : ""} ${top ? "border-t border-line" : ""}`}>
      <dt className="text-[12px] text-fg-3">{k}</dt>
      <dd className={mono ? "mt-1.5 truncate font-mono text-[13px]" : "t-figure mt-1 text-[22px]"}>{children}</dd>
    </div>
  );
}
