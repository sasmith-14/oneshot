import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
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
 * a choice can be made, the evidence-backed answer is pre-selected, going against
 * it shows a warning, and a note is required for the audit trail. */
export function ResolveDialog({ action }: { action: ActionDetail }) {
  const [open, setOpen] = useState(false);
  const record = useProviderRecord(action.id);
  const status = useSystemStatus();
  const qc = useQueryClient();
  const effects = record.data?.effects;
  const verdict = effects ? compare(action, effects) : null;
  const suggested: Choice | null = verdict?.kind === "evidence" ? verdict.suggest : null;
  const [picked, setPicked] = useState<Choice | null>(null);
  const choice = picked ?? suggested; // derived, not synced in an effect
  const [note, setNote] = useState("");

  const settle = status.data ? settleDeadline(action, status.data.settings.provider_settle_seconds) : null;
  const settling = settle !== null && Date.now() / 1000 < settle && (effects?.length ?? 0) === 0;

  const mutation = useMutation({
    mutationFn: () => api.resolve(action.id, choice!, note.trim()),
    onSuccess: () => {
      qc.invalidateQueries();
      setOpen(false);
      toast.success(`Resolved as ${choice}`, { description: "Recorded in the action's audit trail." });
    },
  });

  const against = choice && suggested && choice !== suggested;
  const canSubmit = !!choice && note.trim().length >= 3 && !!effects;

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button type="button" className="btn btn-ink">Investigate and resolve</button>
      </DialogTrigger>
      <DialogContent className="rounded-[3px] border-ink bg-sheet p-7 sm:max-w-xl" data-lenis-prevent>
        <DialogHeader>
          <DialogTitle className="t-title text-[34px] font-normal">Resolve an UNKNOWN action</DialogTitle>
          <DialogDescription className="text-[15px] text-ink-2">Look at the provider's own record first. Resolving is final and audited, and the agent will be told this answer.</DialogDescription>
        </DialogHeader>
        <div className="space-y-6">
          <div>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[15px] font-semibold">1. Evidence from the provider's ledger</h3>
              <button type="button" onClick={() => record.refetch()} disabled={record.isFetching} className="btn btn-line btn-sm">
                <RefreshCw aria-hidden className={record.isFetching ? "size-3 animate-spin motion-reduce:animate-none" : "size-3"} /> Check provider now
              </button>
            </div>
            {verdict ? (
              <VerdictBanner verdict={verdict} />
            ) : (
              <p className="bg-well px-4 py-3 text-[15px] text-ink-2">
                {record.isError ? "The provider cannot be reached, so there is no evidence to resolve with. Restart it from Chaos, then check again." : "Checking…"}
              </p>
            )}
            {settling && <p className="mt-2 bg-st-verifying-soft px-4 py-2.5 text-[14px] text-st-verifying-fg">The settle window after the last send has not passed. The provider might still apply it, so “no effect” is not conclusive yet.</p>}
          </div>
          <div>
            <h3 className="mb-2 text-[15px] font-semibold">2. Your decision</h3>
            <RadioGroup value={choice ?? ""} onValueChange={(v) => setPicked(v as Choice)} className="grid grid-cols-2 gap-2" disabled={!effects}>
              {(["SUCCEEDED", "FAILED"] as Choice[]).map((c) => (
                <Label key={c} className="flex cursor-pointer items-center gap-2.5 rounded-[2px] border border-rule bg-paper p-3.5 transition-colors has-[[data-state=checked]]:border-ink has-[[data-state=checked]]:shadow-[inset_0_0_0_1px_var(--ink)]">
                  <RadioGroupItem value={c} />
                  <span className="font-mono text-[13px]">{c}</span>
                  {c === suggested && <span className="ml-auto text-[12.5px] text-ink-2">Matches evidence</span>}
                </Label>
              ))}
            </RadioGroup>
            {against && <p className="mt-2 bg-st-failed-soft px-4 py-2.5 text-[14px] text-st-failed-fg">This goes against the provider's ledger. Only do this if you have other evidence, and say what it is in the note.</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="resolve-note" className="text-[15px] font-semibold">3. Note for the audit trail (required)</Label>
            <Textarea id="resolve-note" name="note" autoComplete="off" value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ledger shows eff_00012 created 12:03:04…" className="rounded-[2px] border-input bg-paper text-[15px]" />
          </div>
          {mutation.isError && <p role="alert" className="text-[14px] text-st-failed-fg">{(mutation.error as Error).message}</p>}
        </div>
        <DialogFooter>
          <button type="button" onClick={() => setOpen(false)} className="btn btn-quiet">Cancel</button>
          <button type="button" onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending} className="btn btn-ink">
            {mutation.isPending ? "Resolving…" : `Resolve as ${choice ?? "…"}`}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
