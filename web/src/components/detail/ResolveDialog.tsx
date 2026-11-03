import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Textarea } from "@/components/ui/textarea";
import { VerdictBanner } from "./LedgerCompare";
import { api, type ActionDetail } from "@/lib/api";
import { compare, settleDeadline } from "@/lib/compare";
import { useProviderRecord, useSystemStatus } from "@/hooks/queries";

type Choice = "SUCCEEDED" | "FAILED";

/** Evidence first: the provider's record is shown (and can be re-checked) before
 * any choice is possible, the evidence-backed answer is pre-selected, going
 * against it shows a warning, and a note is required for the audit trail. */
export function ResolveDialog({ action }: { action: ActionDetail }) {
  const [open, setOpen] = useState(false);
  const record = useProviderRecord(action.id);
  const status = useSystemStatus();
  const qc = useQueryClient();
  const effects = record.data?.effects;
  const verdict = effects ? compare(action, effects) : null;
  const suggested: Choice | null = verdict?.kind === "evidence" ? verdict.suggest : null;
  const [choice, setChoice] = useState<Choice | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (open && choice === null && suggested) setChoice(suggested);
  }, [open, choice, suggested]);

  const settle = status.data ? settleDeadline(action, status.data.settings.provider_settle_seconds) : null;
  const settling = settle !== null && Date.now() / 1000 < settle && (effects?.length ?? 0) === 0;

  const mutation = useMutation({
    mutationFn: () => api.resolve(action.id, choice!, note.trim()),
    onSuccess: () => {
      qc.invalidateQueries();
      setOpen(false);
    },
  });

  const against = choice && suggested && choice !== suggested;
  const canSubmit = !!choice && note.trim().length >= 3 && !!effects && !mutation.isPending;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">Investigate &amp; resolve</Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve UNKNOWN action</DialogTitle>
          <DialogDescription>
            Look at the provider's own record first. Resolving is final and audited; the agent will be told this answer.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex items-center justify-between text-sm">
            <span className="font-medium">1. Evidence from the provider's ledger</span>
            <Button variant="outline" size="xs" onClick={() => record.refetch()} disabled={record.isFetching}>
              <RefreshCw className={record.isFetching ? "animate-spin motion-reduce:animate-none" : ""} /> Check provider now
            </Button>
          </div>
          {verdict ? (
            <VerdictBanner verdict={verdict} />
          ) : (
            <p className="rounded-lg border border-dashed px-3 py-2 text-sm text-muted-foreground">
              {record.isError ? "The provider cannot be reached, so there is no evidence to resolve with. Try again when it is back." : "Checking…"}
            </p>
          )}
          {effects && (
            <p className="text-xs text-muted-foreground">
              {effects.length ? `Found: ${effects.map((e) => e.id).join(", ")}` : "No effect found"} · checked {new Date((record.data!.checked_at) * 1000).toLocaleTimeString()}
            </p>
          )}
          {settling && (
            <p className="rounded-md bg-st-verifying-soft px-3 py-2 text-xs text-st-verifying-fg">
              The settle window after the last send has not passed yet. The provider might still apply it, so "no effect" is not conclusive. Wait and check again.
            </p>
          )}

          <div className="pt-1 text-sm font-medium">2. Your decision</div>
          <RadioGroup value={choice ?? ""} onValueChange={(v) => setChoice(v as Choice)} className="grid grid-cols-2 gap-2" disabled={!effects}>
            {(["SUCCEEDED", "FAILED"] as Choice[]).map((c) => (
              <Label key={c} className="flex cursor-pointer items-center gap-2 rounded-lg border p-3 has-[[data-state=checked]]:border-foreground">
                <RadioGroupItem value={c} />
                <span className="font-mono text-xs">{c}</span>
                {c === suggested && <span className="ml-auto text-[10px] text-muted-foreground">matches evidence</span>}
              </Label>
            ))}
          </RadioGroup>
          {against && (
            <p className="rounded-md bg-st-failed-soft px-3 py-2 text-xs text-st-failed-fg">
              This goes against what the provider's ledger shows. Only do this if you have other evidence, and say what it is in the note.
            </p>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="resolve-note">3. Note for the audit trail (required)</Label>
            <Textarea id="resolve-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. provider ledger shows eff_… created 12:03:04" />
          </div>
          {mutation.isError && <p className="text-sm text-st-failed-fg">{(mutation.error as Error).message}</p>}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={() => mutation.mutate()} disabled={!canSubmit}>
            Resolve as {choice ?? "…"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
