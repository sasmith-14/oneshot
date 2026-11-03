import { Link, useParams } from "react-router";
import { ArrowLeft } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { StatusBadge } from "@/components/StatusBadge";
import { StateDiagram } from "@/components/detail/StateDiagram";
import { FlowDiagram } from "@/components/detail/FlowDiagram";
import { Timeline } from "@/components/detail/Timeline";
import { LedgerCompare } from "@/components/detail/LedgerCompare";
import { ResolveDialog } from "@/components/detail/ResolveDialog";
import { useAction, useActionTypes, useProviderRecord } from "@/hooks/queries";
import { buildFlow } from "@/lib/flow";
import { STATUS_META } from "@/lib/status";
import { ago } from "@/lib/time";

export function ActionDetailPage() {
  const { id = "" } = useParams();
  const { data: action, error, isPending } = useAction(id);
  const record = useProviderRecord(id);
  const types = useActionTypes();

  if (isPending) return <Skeleton className="h-96 w-full" />;
  if (error || !action)
    return (
      <div className="py-10 text-center text-muted-foreground">
        Action <span className="font-mono">{id}</span> not found. <Link to="/" className="underline">Back to actions</Link>
      </div>
    );

  const type = types.data?.find((t) => t.name === action.type);
  const rows = buildFlow(action, record.data?.effects, { idempotent: type?.idempotent_at_provider });
  const nextIn = action.next_attempt_at ? action.next_attempt_at - Date.now() / 1000 : null;

  return (
    <div className="space-y-6">
      <Link to="/" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" /> All actions
      </Link>

      <Card>
        <CardHeader>
          <div className="flex flex-wrap items-center gap-3">
            <CardTitle className="font-mono text-lg">{action.id}</CardTitle>
            <StatusBadge status={action.status} className="text-sm" />
            <span className="text-sm text-muted-foreground">{action.type}</span>
            {type && (
              <span className="text-xs text-muted-foreground">
                · provider {type.idempotent_at_provider ? "deduplicates by key" : "does NOT deduplicate"} ·{" "}
                {type.provider_lookup ? "has a lookup" : "no lookup"}
              </span>
            )}
          </div>
          <CardDescription>{STATUS_META[action.status].meaning}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {action.status === "UNKNOWN" && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-st-unknown/40 bg-st-unknown-soft px-4 py-3 text-sm text-st-unknown-fg">
              <span>
                OneShot stopped instead of guessing. Check the provider's record, then resolve it, or let reconciliation do it.
              </span>
              <ResolveDialog action={action} />
            </div>
          )}
          <StateDiagram status={action.status} events={action.events} className="max-h-64" />
          <div className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2 lg:grid-cols-4">
            <Fact k="created">{ago(action.created_at)}</Fact>
            <Fact k="sends / checks">
              {action.attempt_count} / {action.verify_count}
            </Fact>
            <Fact k="next step">{nextIn !== null && nextIn > 0 ? `in ${nextIn.toFixed(1)}s` : action.status === "PENDING" || action.status === "VERIFYING" ? "due now" : "-"}</Fact>
            <Fact k="effect id">
              <span className="font-mono text-xs">{action.provider_effect_id ?? "-"}</span>
            </Fact>
          </div>
          <details className="text-sm">
            <summary className="cursor-pointer text-muted-foreground">Payload</summary>
            <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs">{JSON.stringify(action.payload, null, 2)}</pre>
          </details>
        </CardContent>
      </Card>

      <Tabs defaultValue="flow">
        <TabsList>
          <TabsTrigger value="flow">Flow</TabsTrigger>
          <TabsTrigger value="timeline">Timeline</TabsTrigger>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
        </TabsList>
        <TabsContent value="flow">
          <Card>
            <CardContent className="pt-2">
              <p className="mb-3 text-sm text-muted-foreground">
                Every arrow is a recorded fact with its real timestamp. A broken arrow (✕) means no usable answer came back. The provider's ledger lane shows
                what the provider actually did, even when OneShot never heard about it.
              </p>
              {record.isError && (
                <p className="mb-3 rounded-lg border border-st-verifying/40 bg-st-verifying-soft px-3 py-2 text-sm text-st-verifying-fg">
                  The provider's ledger cannot be read right now ({(record.error as Error).message}), so the ledger lane below is empty.
                  That does <b>not</b> mean nothing happened at the provider.
                </p>
              )}
              <FlowDiagram rows={rows} start={action.created_at} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="timeline">
          <Card>
            <CardContent className="pt-2">
              <Timeline action={action} />
            </CardContent>
          </Card>
        </TabsContent>
        <TabsContent value="ledger">
          <Card>
            <CardContent className="pt-2">
              <LedgerCompare action={action} effects={record.data?.effects} error={record.error ? (record.error as Error).message : undefined} />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function Fact({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-b py-1.5 sm:block sm:border-0">
      <div className="text-xs text-muted-foreground">{k}</div>
      <div>{children}</div>
    </div>
  );
}
