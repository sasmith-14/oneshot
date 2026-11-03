import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { Cpu, Loader2, Play, RotateCw, Server, Skull, Trash2, Zap } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Section } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { Skeleton } from "@/components/ui/skeleton";
import { useActions, useLabState, usePresets, useSystemStatus } from "@/hooks/queries";
import { lab, type Action, type LabState, type Preset, type PresetResult } from "@/lib/api";
import { clock } from "@/lib/time";
import { EASE_OUT, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export function ChaosPage() {
  const status = useSystemStatus();
  const labOn = !!status.data?.lab;
  const state = useLabState(labOn);
  const presets = usePresets(labOn);
  const actions = useActions();
  const [results, setResults] = useState<PresetResult[]>([]);
  const qc = useQueryClient();
  const navigate = useNavigate();

  const run = useMutation({
    mutationFn: lab.run,
    onSuccess: (r) => {
      setResults((rs) => [r, ...rs].slice(0, 8));
      qc.invalidateQueries();
      toast.success(`Started: ${r.preset.title}`, {
        description: r.note || `Watching ${r.action_ids.join(", ")}`,
        action: { label: "Open", onClick: () => navigate(`/actions/${r.action_ids[0]}`) },
      });
    },
    onError: (e: Error) => toast.error("The preset did not start", { description: e.message }),
  });

  if (status.data && !labOn) return <LabOff />;

  return (
    <>
      <PageHeader title="Chaos">
        Break things on purpose. Every preset injects a real failure (a dropped socket, a crashed process, a hung request) and submits an action, so you can watch OneShot handle it.
      </PageHeader>
      <div className="grid gap-10 lg:grid-cols-[minmax(0,1fr)_340px]">
        <div>
          <AnimatePresence initial={false}>
            {results.length > 0 && <Results results={results} actions={actions.data ?? []} />}
          </AnimatePresence>
          {!presets.data ? (
            <Skeleton className="h-96 rounded-[14px]" />
          ) : (
            presets.data.groups.map((g) => (
              <Section key={g.id} id={g.id} title={g.title} about={g.about}>
                <div className="grid gap-3 sm:grid-cols-2">
                  {presets.data!.presets.filter((p) => p.group === g.id).map((p) => (
                    <PresetCard key={p.name} preset={p} disabled={p.needs_managed && !state.data?.managed} running={run.isPending && run.variables === p.name} onRun={() => run.mutate(p.name)} />
                  ))}
                </div>
              </Section>
            ))
          )}
        </div>
        <aside className="space-y-6 lg:sticky lg:top-20 lg:self-start" id="processes">
          <Processes state={state.data} />
          <Faults state={state.data} />
          <EventLog state={state.data} />
        </aside>
      </div>
    </>
  );
}

function PresetCard({ preset, onRun, running, disabled }: { preset: Preset; onRun: () => void; running: boolean; disabled: boolean }) {
  return (
    <motion.article whileHover={disabled ? undefined : { y: -2 }} transition={{ duration: 0.18, ease: EASE_OUT }} className={cn("flex flex-col rounded-[14px] border bg-card p-4", disabled && "opacity-60")}>
      <h3 className="font-medium">{preset.title}</h3>
      <p className="mt-1 text-[13.5px] text-muted-foreground">{preset.what}</p>
      <p className="mt-3 border-l-2 pl-3 text-[13px]">
        <span className="text-muted-foreground">You should see: </span>
        {preset.expect}
      </p>
      <div className="mt-auto flex items-center justify-between pt-4">
        <span className="font-mono text-[11px] text-muted-foreground" translate="no">{preset.name}</span>
        <motion.button
          type="button"
          whileTap={{ scale: 0.97 }}
          onClick={onRun}
          disabled={running || disabled}
          title={disabled ? "Needs the API to manage processes (ONESHOT_LAB_MANAGE=1, as make dev does)" : undefined}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-foreground px-3 text-[13px] font-medium text-background disabled:opacity-50"
        >
          {running ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Play aria-hidden className="size-3.5" />}
          {running ? "Starting…" : "Run"}
        </motion.button>
      </div>
    </motion.article>
  );
}

function Results({ results, actions }: { results: PresetResult[]; actions: Action[] }) {
  const byId = new Map(actions.map((a) => [a.id, a]));
  return (
    <motion.section initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} className="mb-10 overflow-hidden">
      <h2 className="mb-3 text-lg font-semibold tracking-tight">Your runs</h2>
      <ul className="divide-y rounded-[14px] border bg-card">
        <AnimatePresence initial={false}>
          {results.map((r, i) => (
            <motion.li key={`${r.action_ids[0]}-${i}`} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} className="flex flex-wrap items-center gap-3 px-4 py-3 text-sm">
              <Zap aria-hidden className="size-4 text-muted-foreground" />
              <span className="font-medium">{r.preset.title}</span>
              <span className="flex flex-wrap gap-2">
                {r.action_ids.map((id) => {
                  const a = byId.get(id);
                  return (
                    <Link key={id} to={`/actions/${id}`} className="flex items-center gap-2 rounded-lg border px-2 py-1 hover:bg-muted">
                      <span className="font-mono text-xs">{id}</span>
                      {a && <StatusPill status={a.status} explain={false} />}
                    </Link>
                  );
                })}
              </span>
              {r.note && <p className="w-full text-xs text-muted-foreground">{r.note}</p>}
            </motion.li>
          ))}
        </AnimatePresence>
      </ul>
    </motion.section>
  );
}

function useLabAction<T>(fn: () => Promise<T>, success: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      qc.invalidateQueries();
      toast.success(success);
    },
    onError: (e: Error) => toast.error("That did not work", { description: e.message }),
  });
}

function Processes({ state }: { state?: LabState }) {
  const [confirmKill, setConfirmKill] = useState(false);
  const start = useLabAction(lab.startWorker, "Worker started");
  const kill = useLabAction(lab.killWorker, "Worker killed with SIGKILL");
  const crashAfter = useLabAction(() => lab.crashWorker("after_response"), "Worker armed: it dies after the next provider response");
  const crashBefore = useLabAction(() => lab.crashWorker("before_send"), "Worker armed: it dies before the next send");
  const restart = useLabAction(lab.restartProvider, "Provider restarted; its ledger survived on disk");
  const w = state?.worker;
  const p = state?.provider;
  const managed = state?.managed;

  return (
    <section className="rounded-[14px] border bg-card p-4">
      <h2 className="font-medium">Processes</h2>
      <p className="mb-4 text-xs text-muted-foreground">{managed ? "Real child processes of the API. Kills are real SIGKILLs." : "Not managed by this API, so process control is off. Start with make dev to enable it."}</p>
      <ProcessRow icon={Server} name="Provider" running={p?.running} detail={p?.running ? p.url : "down: requests and lookups fail"}>
        {managed && !p?.running && <SmallButton onClick={() => restart.mutate()} busy={restart.isPending} icon={RotateCw}>Restart</SmallButton>}
      </ProcessRow>
      <ProcessRow icon={Cpu} name="Worker" running={w?.running} detail={w?.running ? `pid ${w.pid}${w.failpoints.length ? `, armed: ${w.failpoints.join(", ")}` : ""}` : "down: actions wait safely on disk"}>
        {managed && !w?.running && <SmallButton onClick={() => start.mutate()} busy={start.isPending} icon={Play}>Start</SmallButton>}
        {managed && w?.running && (
          <AnimatePresence mode="wait" initial={false}>
            {confirmKill ? (
              <motion.span key="confirm" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} className="flex gap-1">
                <SmallButton tone="danger" icon={Skull} busy={kill.isPending} onClick={() => { kill.mutate(); setConfirmKill(false); }}>Confirm kill -9</SmallButton>
                <SmallButton onClick={() => setConfirmKill(false)}>Cancel</SmallButton>
              </motion.span>
            ) : (
              <motion.span key="kill" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <SmallButton icon={Skull} onClick={() => setConfirmKill(true)}>kill -9</SmallButton>
              </motion.span>
            )}
          </AnimatePresence>
        )}
      </ProcessRow>
      {managed && (
        <div className="mt-3 border-t pt-3">
          <p className="mb-2 text-xs text-muted-foreground">Crash the worker at a failpoint on its next attempt (it restarts by itself afterwards):</p>
          <div className="flex flex-wrap gap-1.5">
            <SmallButton onClick={() => crashBefore.mutate()} busy={crashBefore.isPending}>Before send</SmallButton>
            <SmallButton onClick={() => crashAfter.mutate()} busy={crashAfter.isPending}>After response</SmallButton>
          </div>
        </div>
      )}
    </section>
  );
}

function ProcessRow({ icon: Icon, name, running, detail, children }: { icon: typeof Cpu; name: string; running?: boolean; detail: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="relative grid size-8 place-items-center rounded-lg bg-muted">
        <Icon aria-hidden className="size-4" />
        <span className={cn("absolute -top-0.5 -right-0.5 size-2.5 rounded-full ring-2 ring-card", running === undefined ? "bg-muted-foreground/40" : running ? "bg-st-succeeded" : "bg-st-failed")} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{name}</p>
        <p className="truncate text-xs text-muted-foreground">{running === undefined ? "…" : detail}</p>
      </div>
      <div className="flex shrink-0 gap-1">{children}</div>
    </div>
  );
}

function SmallButton({ children, onClick, busy, icon: Icon, tone }: { children: React.ReactNode; onClick: () => void; busy?: boolean; icon?: typeof Cpu; tone?: "danger" }) {
  return (
    <button type="button" onClick={onClick} disabled={busy} className={cn("inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs transition-colors hover:bg-muted disabled:opacity-50", tone === "danger" && "border-st-failed/40 bg-st-failed-soft text-st-failed-fg")}>
      {busy ? <Loader2 aria-hidden className="size-3 animate-spin" /> : Icon && <Icon aria-hidden className="size-3" />}
      {children}
    </button>
  );
}

const MODES = ["unavailable", "decline", "timeout", "lost_response", "slow_success", "crash_before_apply", "crash_after_apply", "error_after_apply"];

function Faults({ state }: { state?: LabState }) {
  const qc = useQueryClient();
  const [mode, setMode] = useState("lost_response");
  const [endpoint, setEndpoint] = useState("");
  const [times, setTimes] = useState(1);
  const arm = useMutation({
    mutationFn: () => lab.arm({ mode, endpoint: endpoint || undefined, times }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["lab-state"] });
      toast.success(`Armed ${mode}`, { description: "The next matching request to the provider will hit it." });
    },
    onError: (e: Error) => toast.error("Could not arm the fault", { description: e.message }),
  });
  const clear = useLabAction(lab.clear, "Cleared all armed faults");
  const faults = state?.faults;
  return (
    <section className="rounded-[14px] border bg-card p-4">
      <div className="flex items-center justify-between">
        <h2 className="font-medium">Armed faults</h2>
        {!!faults?.length && <SmallButton icon={Trash2} onClick={() => clear.mutate()} busy={clear.isPending}>Clear</SmallButton>}
      </div>
      <p className="mb-3 text-xs text-muted-foreground">Faults wait at the provider and fire on the next matching request, first in, first out.</p>
      {faults === null ? (
        <p className="text-sm text-st-failed-fg">The provider is down.</p>
      ) : faults?.length ? (
        <ul className="mb-3 space-y-1">
          <AnimatePresence initial={false}>
            {faults.map((f, i) => (
              <motion.li key={`${f.mode}-${i}`} layout initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="flex items-center justify-between rounded-lg bg-muted px-2.5 py-1.5 font-mono text-xs">
                <span>{f.mode}</span>
                <span className="text-muted-foreground">{f.endpoint ?? "any"}{f.times > 1 ? `, ${f.times}×` : ""}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="mb-3 text-sm text-muted-foreground">None. Requests succeed normally.</p>
      )}
      <form
        className="grid grid-cols-[1fr_auto] gap-2 border-t pt-3"
        onSubmit={(e) => {
          e.preventDefault();
          arm.mutate();
        }}
      >
        <label className="col-span-2 text-xs text-muted-foreground" htmlFor="fault-mode">Arm a fault manually</label>
        <select id="fault-mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value)} className="col-span-2 h-8 rounded-md border bg-card px-2 font-mono text-xs">
          {MODES.map((m) => <option key={m}>{m}</option>)}
        </select>
        <select aria-label="Endpoint" name="endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="h-8 rounded-md border bg-card px-2 text-xs">
          <option value="">Any endpoint</option>
          <option value="/v1/charges">Charges</option>
          <option value="/v1/messages">Messages</option>
        </select>
        <input aria-label="Times" name="times" type="number" inputMode="numeric" min={1} max={20} value={times} onChange={(e) => setTimes(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="h-8 w-16 rounded-md border bg-card px-2 text-xs tabular-nums" />
        <button type="submit" disabled={arm.isPending} className="col-span-2 h-8 rounded-md bg-foreground text-xs font-medium text-background disabled:opacity-50">
          {arm.isPending ? "Arming…" : "Arm fault"}
        </button>
      </form>
    </section>
  );
}

function EventLog({ state }: { state?: LabState }) {
  const events = state?.events ?? [];
  return (
    <section className="rounded-[14px] border bg-card p-4">
      <h2 className="font-medium">Lab log</h2>
      <p className="mb-3 text-xs text-muted-foreground">What the lab did to the processes, newest first.</p>
      {events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing yet.</p>
      ) : (
        <ol className="max-h-72 space-y-2 overflow-y-auto pr-1" data-lenis-prevent aria-live="polite">
          <AnimatePresence initial={false}>
            {events.slice(0, 30).map((e) => (
              <motion.li key={`${e.at}-${e.message}`} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE_OUT }} className="text-xs">
                <time className="mr-2 font-mono text-muted-foreground">{clock(e.at).slice(0, 8)}</time>
                <span className={cn(e.message.includes("SIGKILL") || e.message.includes("died") || e.message.includes("exited") ? "text-st-failed-fg" : "")}>{e.message}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </section>
  );
}

function LabOff() {
  return (
    <>
      <PageHeader title="Chaos">Fault injection and process control are switched off.</PageHeader>
      <div className="max-w-2xl rounded-[14px] border bg-card p-6 text-[15px]">
        <p>Lab mode is test scaffolding: a real backend never controls its provider's failures, so these controls only exist when you ask for them. Start the stack with:</p>
        <pre className="mt-3 rounded-lg bg-muted p-3 font-mono text-sm">make dev</pre>
        <p className="mt-3 text-sm text-muted-foreground">It sets <code className="font-mono">ONESHOT_LAB=1</code> and <code className="font-mono">ONESHOT_LAB_MANAGE=1</code>. Everything else in the console works without it.</p>
      </div>
    </>
  );
}
