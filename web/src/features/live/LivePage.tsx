import { useEffect, useState } from "react";
import { Section } from "@/components/PageHeader";
import { SetHeadline } from "@/components/SetHeadline";
import { Skeleton } from "@/components/ui/skeleton";
import { useActions, useSystemStatus } from "@/hooks/queries";
import { ActionList, Activity, Lead, StateOfThings, WireReport } from "./Board";
import { Wire } from "./Wire";

const WIRE_WINDOW = 15 * 60; // settled actions stay on the wire for 15 minutes

/** The front page. Its one question: does anything need me right now? The
 * lead headline answers it; the wire shows it moving; the report and the full
 * list back it up. */
export function LivePage() {
  const status = useSystemStatus();
  const actions = useActions();
  const [now, setNow] = useState(() => Date.now() / 1000);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now() / 1000), 2000);
    return () => clearInterval(t);
  }, []);

  const all = [...(actions.data ?? [])].sort((a, b) => b.created_at - a.created_at);
  const onWire = all.filter((a) => !["SUCCEEDED", "FAILED"].includes(a.status) || now - a.updated_at < WIRE_WINDOW);
  const updated = status.dataUpdatedAt ? new Date(status.dataUpdatedAt).toLocaleTimeString("en-GB", { hour12: false }) : null;

  return (
    <>
      <div className="mb-10 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <SetHeadline text="Live" className="t-title text-[length:calc(var(--ts)*44px)]" />
        <p className="text-[14px] text-ink-2">{updated ? `Read at ${updated}, every second` : "Connecting…"}</p>
      </div>

      <div className="mb-28 grid gap-x-16 gap-y-14 lg:grid-cols-12">
        <div className="lg:col-span-8">
          <Lead status={status.data} apiDown={status.isError} />
        </div>
        <div className="lg:col-span-4 lg:pt-3">
          <StateOfThings status={status.data} />
        </div>
      </div>

      <Section title="The wire" about="Recent actions, placed by their real status and read every second. Settled ones leave after fifteen minutes. Open any token for its full story.">
        {actions.isPending ? <Skeleton className="h-[280px] w-full rounded-none bg-well" /> : <Wire actions={onWire} />}
      </Section>

      <div className="mb-24 grid gap-x-16 gap-y-16 lg:grid-cols-12">
        <section aria-labelledby="report-title" className="min-w-0 lg:col-span-7">
          <SetHeadline as="h2" id="report-title" text="The wire report" className="t-title mb-2 text-[length:calc(var(--ts)*clamp(2rem,3.4vw,2.875rem))]" />
          <p className="mb-6 text-[15.5px] text-ink-2">Each change as it happens, in plain words.</p>
          <WireReport actions={actions.data} />
        </section>
        <section aria-labelledby="activity-title" className="min-w-0 lg:col-span-5">
          <SetHeadline as="h2" id="activity-title" text="The last five minutes" className="t-title mb-2 text-[length:calc(var(--ts)*clamp(2rem,3.4vw,2.875rem))]" />
          <p className="mb-6 text-[15.5px] text-ink-2">Submissions per ten seconds, coloured by how they turned out.</p>
          <Activity actions={all} now={now} />
        </section>
      </div>

      <Section title="Every action" id="actions">
        {actions.isPending ? <Skeleton className="h-64 w-full rounded-none bg-well" /> : <ActionList actions={all} />}
      </Section>
    </>
  );
}
