import { useEffect, useState } from "react";
import { PageHeader, Section } from "@/components/PageHeader";
import { Skeleton } from "@/components/ui/skeleton";
import { useActions, useSystemStatus } from "@/hooks/queries";
import { ActionList, Activity, Attention, HealthBar } from "./Board";
import { Wire } from "./Wire";

const WIRE_WINDOW = 15 * 60; // settled actions stay on the wire for 15 minutes

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

  return (
    <>
      <PageHeader title="Live" actions={<HealthBar status={status.data} />}>
        Every action an agent asked for, moving through its lifecycle as the worker handles it. Open any token to see its whole story.
      </PageHeader>
      <Attention status={status.data} />
      <Section title="The wire" about="Recent actions, positioned by their real status and polled every second. Settled ones leave after 15 minutes.">
        {actions.isPending ? <Skeleton className="h-[240px] w-full rounded-[14px]" /> : <Wire actions={onWire} />}
      </Section>
      <Section title="Activity" about="What was submitted, and how it turned out.">
        <Activity actions={all} now={now} />
      </Section>
      <Section title="All actions" id="actions">
        {actions.isPending ? <Skeleton className="h-64 w-full rounded-[14px]" /> : <ActionList actions={all} />}
      </Section>
    </>
  );
}
