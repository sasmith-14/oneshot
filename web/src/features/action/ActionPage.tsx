import { Link, useParams, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyId } from "@/components/CopyId";
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

const TABS = [
  { id: "flow", label: "Flow" },
  { id: "timeline", label: "Timeline" },
  { id: "ledger", label: "Ledger" },
] as const;
type Tab = (typeof TABS)[number]["id"];

/** One action, told as a story: the headline says what happened, the figure
 * shows the path it took, and the tabs hold the evidence. */
export function ActionPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "flow") as Tab;
  const { data: action, error, isPending } = useAction(id);
  const record = useProviderRecord(id);
  const types = useActionTypes();

  if (isPending) return <Skeleton className="h-[520px] w-full rounded-none bg-well" />;
  if (error || !action)
    return (
      <div className="py-16">
        <p className="t-title text-[44px]">There is no action <span className="font-mono text-[0.6em]">{id}</span>.</p>
        <p className="mt-3 text-ink-2">Check the id, or <Link to="/" className="ink-link-static">go back to Live</Link>.</p>
      </div>
    );

  const type = types.data?.find((t) => t.name === action.type);
  const rows = buildFlow(action, record.data?.effects, { idempotent: type?.idempotent_at_provider });
  const nextIn = action.next_attempt_at ? action.next_attempt_at - Date.now() / 1000 : null;
  const headline = storyHeadline(action);
  const created = new Date(action.created_at * 1000).toLocaleTimeString("en-GB", { hour12: false });

  return (
    <article>
      <Link to="/" className="ink-link mb-10 inline-flex items-center gap-1.5 text-[15px] text-ink-2">
        <ArrowLeft aria-hidden className="size-4" /> Live
      </Link>

      <header className="mb-14 grid gap-x-16 gap-y-10 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <p className="text-[15px] text-ink-2">
            A {noun(action.type)}, created at {created} ({ago(action.created_at)})
            {type && <>. The provider {type.idempotent_at_provider ? "deduplicates by key" : "does not deduplicate"}{type.provider_lookup ? " and keeps a ledger OneShot can read" : ""}</>}.
          </p>
          <SetHeadline key={headline} text={headline} className="t-display mt-5 text-[length:calc(var(--ds)*clamp(2.75rem,5.4vw,5rem))]" />
          <p className="t-stand mt-6 text-ink">{STATUS_META[action.status].meaning}</p>
          <div className="mt-7 flex flex-wrap items-center gap-x-4 gap-y-2">
            <motion.span key={action.status} initial={{ scale: 0.92, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
              <StatusPill status={action.status} size="md" />
            </motion.span>
            <CopyId value={action.id} className="text-[14px] text-ink-2" />
          </div>
        </div>
        <dl className="grid grid-cols-2 content-start gap-x-8 lg:col-span-4 lg:grid-cols-1 lg:pt-10">
          <Fact k="Sends">{action.attempt_count}</Fact>
          <Fact k="Ledger checks">{action.verify_count}</Fact>
          <Fact k="Next step">{nextIn !== null && nextIn > 0 ? `in ${nextIn.toFixed(1)}s` : ["PENDING", "VERIFYING"].includes(action.status) ? "due now" : "none"}</Fact>
          <Fact k="Effect at the provider" mono>{action.provider_effect_id ?? "none recorded"}</Fact>
        </dl>
      </header>

      <AnimatePresence initial={false}>
        {action.status === "UNKNOWN" && (
          <motion.div initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
            <div className="mb-14 flex flex-wrap items-center justify-between gap-x-8 gap-y-4 bg-st-unknown-soft px-6 py-5 text-st-unknown-fg">
              <p className="max-w-2xl text-[16px]"><b className="font-semibold">OneShot stopped instead of guessing.</b> Check the provider's record, then resolve it here, or let reconciliation do it.</p>
              <ResolveDialog action={action} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section aria-labelledby="path-title" className="mb-20">
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <SetHeadline as="h2" id="path-title" text="The path it took" className="t-title text-[length:calc(var(--ts)*clamp(2rem,3.4vw,2.875rem))]" />
          <p className="max-w-md text-[14.5px] text-ink-2">The blue line is this action's route through the lifecycle; a number shows a step taken more than once. Hover any arrow for its meaning.</p>
        </div>
        <div className="bg-sheet px-4 py-8 sm:px-8">
          <StateMachine current={action.status} path={pathTaken(action.events)} className="mx-auto max-h-[300px]" />
        </div>
      </section>

      <TabBar id="action" tabs={[...TABS]} value={tab} onChange={(t) => setParams(t === "flow" ? {} : { tab: t }, { replace: true, preventScrollReset: true })} />
      <div id="action-panel" role="tabpanel" aria-labelledby={`action-tab-${tab}`} className="pt-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, transition: { duration: 0.1 } }} transition={{ duration: 0.22, ease: EASE_OUT }}>
            {tab === "flow" && (
              <>
                <p className="mb-6 max-w-3xl text-[15.5px] text-ink-2">
                  Every arrow is a recorded fact with its real timestamp. A cross means no usable answer came back. The ledger lane shows what the provider actually did, even when OneShot never heard about it.
                </p>
                {record.isError && (
                  <p className="mb-6 bg-st-verifying-soft px-5 py-3.5 text-[15px] text-st-verifying-fg">
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
    </article>
  );
}

function Fact({ k, children, mono }: { k: string; children: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 border-b border-rule py-3">
      <dt className="text-[14.5px] text-ink-2">{k}</dt>
      <dd className={mono ? "truncate font-mono text-[13px]" : "font-display text-[30px] leading-none"}>{children}</dd>
    </div>
  );
}
