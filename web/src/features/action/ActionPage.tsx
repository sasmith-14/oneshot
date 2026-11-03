import { Link, useParams, useSearchParams } from "react-router";
import { AnimatePresence, motion } from "motion/react";
import { ArrowLeft, CreditCard, MessageSquare } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { CopyId } from "@/components/CopyId";
import { StatusPill } from "@/components/StatusPill";
import { StateMachine, pathTaken } from "@/components/StateMachine";
import { TabBar } from "@/components/Tabs";
import { useAction, useActionTypes, useProviderRecord } from "@/hooks/queries";
import { buildFlow } from "@/lib/flow";
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

export function ActionPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.id === params.get("tab"))?.id ?? "flow") as Tab;
  const { data: action, error, isPending } = useAction(id);
  const record = useProviderRecord(id);
  const types = useActionTypes();

  if (isPending) return <Skeleton className="h-[520px] w-full rounded-[14px]" />;
  if (error || !action)
    return (
      <div className="py-16 text-center">
        <p className="font-medium">There is no action <span className="font-mono">{id}</span>.</p>
        <p className="mt-1 text-sm text-muted-foreground">Check the id, or <Link to="/" className="underline">go back to Live</Link>.</p>
      </div>
    );

  const type = types.data?.find((t) => t.name === action.type);
  const rows = buildFlow(action, record.data?.effects, { idempotent: type?.idempotent_at_provider });
  const nextIn = action.next_attempt_at ? action.next_attempt_at - Date.now() / 1000 : null;
  const Icon = action.type === "message.send" ? MessageSquare : CreditCard;

  return (
    <article>
      <Link to="/" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft aria-hidden className="size-4" /> Live
      </Link>
      <header className="mb-6 flex flex-wrap items-start justify-between gap-4 border-b pb-6">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-[26px] font-semibold tracking-[-0.02em]">
              <CopyId value={action.id} />
            </h1>
            <motion.span key={action.status} initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.25, ease: EASE_OUT }}>
              <StatusPill status={action.status} size="md" />
            </motion.span>
          </div>
          <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground">
            <span className="flex items-center gap-1.5"><Icon aria-hidden className="size-4" />{action.type}</span>
            {type && <span>Provider {type.idempotent_at_provider ? "deduplicates by key" : "does not deduplicate"}</span>}
            {type && <span>{type.provider_lookup ? "Has a ledger lookup" : "No lookup available"}</span>}
            <span>Created {ago(action.created_at)}</span>
          </p>
          <p className="mt-3 max-w-2xl text-[15px]">{STATUS_META[action.status].meaning}</p>
        </div>
        <dl className="grid grid-cols-3 gap-6 text-sm">
          <Fact k="Sends">{action.attempt_count}</Fact>
          <Fact k="Ledger checks">{action.verify_count}</Fact>
          <Fact k="Next step">{nextIn !== null && nextIn > 0 ? `in ${nextIn.toFixed(1)}s` : ["PENDING", "VERIFYING"].includes(action.status) ? "due now" : "None"}</Fact>
        </dl>
      </header>

      <AnimatePresence initial={false}>
        {action.status === "UNKNOWN" && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-st-unknown/35 bg-st-unknown-soft px-4 py-3 text-sm text-st-unknown-fg">
              <p>OneShot stopped instead of guessing. Check the provider's record, then resolve it here, or let reconciliation do it.</p>
              <ResolveDialog action={action} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <section aria-label="Lifecycle" className="mb-8 rounded-[14px] border bg-card px-4 py-5">
        <StateMachine current={action.status} path={pathTaken(action.events)} className="mx-auto max-h-[290px]" />
        <p className="mt-1 text-center text-xs text-muted-foreground">Solid arrows show the path this action took; a number shows how many times. Hover any arrow for its meaning.</p>
      </section>

      <TabBar id="action" tabs={[...TABS]} value={tab} onChange={(t) => setParams(t === "flow" ? {} : { tab: t }, { replace: true, preventScrollReset: true })} />
      <div id="action-panel" role="tabpanel" aria-labelledby={`action-tab-${tab}`} className="pt-6">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.16, ease: EASE_OUT }}>
            {tab === "flow" && (
              <>
                <p className="mb-4 max-w-3xl text-sm text-muted-foreground">
                  Every arrow is a recorded fact with its real timestamp. A ✕ means no usable answer came back. The ledger lane shows what the provider actually did, even when OneShot never heard about it.
                </p>
                {record.isError && (
                  <p className="mb-4 rounded-xl border border-st-verifying/40 bg-st-verifying-soft px-3.5 py-2.5 text-sm text-st-verifying-fg">
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

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{k}</dt>
      <dd className="mt-0.5 text-lg font-semibold tabular-nums">{children}</dd>
    </div>
  );
}
