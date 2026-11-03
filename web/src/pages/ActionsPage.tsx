import { useSearchParams } from "react-router";
import { Skeleton } from "@/components/ui/skeleton";
import { ActionsTable, AttentionBanner, HealthStrip, Sparkline, StatusCards } from "@/components/actions/Board";
import { useActions, useSystemStatus } from "@/hooks/queries";
import { STATUSES, type Status } from "@/lib/api";

export function ActionsPage() {
  const status = useSystemStatus();
  const actions = useActions();
  const [params, setParams] = useSearchParams();
  const raw = params.get("status");
  const filter = raw && (STATUSES as readonly string[]).includes(raw) ? (raw as Status) : null;

  const all = [...(actions.data ?? [])].sort((a, b) => b.created_at - a.created_at);
  const shown = filter ? all.filter((a) => a.status === filter) : all;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">Actions</h1>
        <p className="text-sm text-muted-foreground">Every action an agent asked for, live. Click a status to filter, or open an action to see its whole story.</p>
      </div>
      <HealthStrip status={status.data} />
      <AttentionBanner status={status.data} />
      <StatusCards
        counts={status.data?.counts ?? {}}
        active={filter}
        onSelect={(s) => setParams(s ? { status: s } : {})}
      />
      <Sparkline actions={all} />
      {actions.isPending ? <Skeleton className="h-64 w-full" /> : <ActionsTable actions={shown} />}
      {filter && (
        <p className="text-xs text-muted-foreground">
          Showing {shown.length} of {all.length} ({filter}).{" "}
          <button className="underline" onClick={() => setParams({})}>Show all</button>
        </p>
      )}
    </div>
  );
}
