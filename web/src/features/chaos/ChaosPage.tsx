import { useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowDown, Loader2, Play, RotateCw, Skull, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader } from "@/components/PageHeader";
import { SetHeadline } from "@/components/SetHeadline";
import { StatusPill } from "@/components/StatusPill";
import { Skeleton } from "@/components/ui/skeleton";
import { useActions, useLabState, usePresets, useSystemStatus } from "@/hooks/queries";
import { lab, type Action, type LabState, type Preset, type PresetResult } from "@/lib/api";
import { EASE_OUT, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { Strip } from "./Strip";

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
      <PageHeader title="Chaos" actions={<BenchLine state={state.data} />}>
        Break things on purpose. Every preset injects a real failure, a dropped socket, a crashed process, a hung request, and submits an action, so you can watch OneShot handle it.
      </PageHeader>

      <AnimatePresence initial={false}>{results.length > 0 && <Results results={results} actions={actions.data ?? []} />}</AnimatePresence>

      {!presets.data ? (
        <Skeleton className="h-96 rounded-none bg-well" />
      ) : (
        presets.data.groups.map((g) => {
          const items = presets.data!.presets.filter((p) => p.group === g.id);
          return (
            <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} className="mb-24 grid gap-x-12 gap-y-7 lg:grid-cols-12">
              <div className="lg:col-span-3">
                <SetHeadline as="h2" id={`${g.id}-title`} text={g.title} className="t-title text-[length:calc(var(--ts)*clamp(2rem,3vw,2.625rem))]" />
                <p className="mt-3 text-[15.5px] leading-relaxed text-ink-2">{g.about}</p>
                <p className="mt-4 text-[13.5px] text-ink-3">{items.length} {items.length === 1 ? "story" : "stories"}. Drag, swipe or step through.</p>
              </div>
              <div className="min-w-0 lg:col-span-9">
                <Strip label={g.title}>
                  {items.map((p) => (
                    <PresetCard key={p.name} preset={p} disabled={p.needs_managed && !state.data?.managed} running={run.isPending && run.variables === p.name} onRun={() => run.mutate(p.name)} />
                  ))}
                </Strip>
              </div>
            </section>
          );
        })
      )}

      <section id="bench" aria-labelledby="bench-title" className="scroll-mt-24">
        <div className="mb-8 max-w-3xl">
          <SetHeadline as="h2" id="bench-title" text="The lab bench" className="t-title text-[length:calc(var(--ts)*clamp(2rem,3.4vw,2.875rem))]" />
          <p className="mt-2.5 text-[15.5px] text-ink-2">The real processes behind the console, the faults waiting at the provider, and a log of everything the lab did.</p>
        </div>
        <div className="grid gap-x-12 gap-y-14 border-t-2 border-ink pt-8 lg:grid-cols-3">
          <Processes state={state.data} />
          <Faults state={state.data} />
          <EventLog state={state.data} />
        </div>
      </section>
    </>
  );
}

function BenchLine({ state }: { state?: LabState }) {
  const faults = state?.faults?.length ?? 0;
  const dot = (ok?: boolean) => <span aria-hidden className={cn("size-1.5 rounded-full", ok === undefined ? "bg-ink-3" : ok ? "bg-st-succeeded" : "bg-mark")} />;
  return (
    <div className="flex flex-col items-start gap-1.5 text-[14.5px] lg:items-end">
      <p className="flex items-center gap-2">{dot(state?.provider.running)} Provider {state ? (state.provider.running ? "up" : "down") : "…"}</p>
      <p className="flex items-center gap-2">{dot(state?.worker.running)} Worker {state ? (state.worker.running ? `running, pid ${state.worker.pid}` : "stopped") : "…"}</p>
      <p className="flex items-center gap-2">{dot(state ? faults === 0 : undefined)} {faults === 0 ? "No faults armed" : `${faults} fault${faults > 1 ? "s" : ""} armed`}</p>
      <a href="#bench" className="ink-link mt-1 inline-flex items-center gap-1 text-ink-2">The lab bench <ArrowDown aria-hidden className="size-3.5" /></a>
    </div>
  );
}

function PresetCard({ preset, onRun, running, disabled }: { preset: Preset; onRun: () => void; running: boolean; disabled: boolean }) {
  return (
    <article className={cn("flex w-[min(84vw,348px)] shrink-0 flex-col bg-sheet p-6 transition-opacity", disabled && "opacity-55")}>
      <h3 className="t-head text-[28px]">{preset.title}</h3>
      <p className="mt-3 text-[15px] leading-relaxed">{preset.what}</p>
      <div className="mt-5 border-l-2 border-mark pl-4">
        <p className="text-[13px] font-semibold text-mark-ink">You should see</p>
        <p className="mt-0.5 text-[14.5px] leading-relaxed text-ink-2">{preset.expect}</p>
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 pt-7">
        <span className="truncate font-mono text-[12px] text-ink-3" translate="no">{preset.name}</span>
        <button
          type="button"
          onClick={onRun}
          disabled={running || disabled}
          title={disabled ? "Needs the API to manage processes (ONESHOT_LAB_MANAGE=1, as make dev does)" : undefined}
          className="btn btn-ink btn-sm"
        >
          {running ? <Loader2 aria-hidden className="size-3.5 animate-spin" /> : <Play aria-hidden className="size-3.5" />}
          {running ? "Starting…" : "Run"}
        </button>
      </div>
    </article>
  );
}

function Results({ results, actions }: { results: PresetResult[]; actions: Action[] }) {
  const byId = new Map(actions.map((a) => [a.id, a]));
  return (
    <motion.section initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="mb-24" aria-labelledby="runs-title">
      <h2 id="runs-title" className="t-title mb-5 text-[length:calc(var(--ts)*clamp(2rem,3.4vw,2.875rem))]">Your runs</h2>
      <ul className="border-t-2 border-ink">
        <AnimatePresence initial={false}>
          {results.map((r, i) => (
            <motion.li key={`${r.action_ids[0]}-${i}`} layout initial={{ opacity: 0, y: -8 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} className="grid gap-x-8 gap-y-2 border-b border-rule py-4 md:grid-cols-[minmax(0,1fr)_auto]">
              <div>
                <p className="t-head text-[22px]">{r.preset.title}</p>
                {r.note && <p className="mt-1 text-[14px] text-ink-2">{r.note}</p>}
              </div>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-2">
                {r.action_ids.map((id) => {
                  const a = byId.get(id);
                  return (
                    <Link key={id} to={`/actions/${id}`} className="group flex items-center gap-2.5">
                      <span className="ink-link font-mono text-[13.5px]">{id}</span>
                      {a && <StatusPill status={a.status} explain={false} />}
                    </Link>
                  );
                })}
              </span>
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

function BenchTitle({ children, aside }: { children: React.ReactNode; aside?: React.ReactNode }) {
  return (
    <div className="mb-1 flex items-baseline justify-between gap-3">
      <h3 className="t-head text-[26px]">{children}</h3>
      {aside}
    </div>
  );
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
    <section>
      <BenchTitle>Processes</BenchTitle>
      <p className="mb-5 text-[14.5px] text-ink-2">{managed ? "Real child processes of the API. Kills are real SIGKILLs." : "Not managed by this API, so process control is off. Start with make dev to enable it."}</p>
      <ProcessRow name="Provider" running={p?.running} detail={p?.running ? p.url : "down: requests and lookups fail"}>
        {managed && !p?.running && <button type="button" className="btn btn-ink btn-sm" onClick={() => restart.mutate()} disabled={restart.isPending}><RotateCw aria-hidden className="size-3.5" />Restart</button>}
      </ProcessRow>
      <ProcessRow name="Worker" running={w?.running} detail={w?.running ? `pid ${w.pid}${w.failpoints.length ? `, armed: ${w.failpoints.join(", ")}` : ""}` : "down: actions wait safely on disk"}>
        {managed && !w?.running && <button type="button" className="btn btn-ink btn-sm" onClick={() => start.mutate()} disabled={start.isPending}><Play aria-hidden className="size-3.5" />Start</button>}
        {managed && w?.running && (
          <AnimatePresence mode="wait" initial={false}>
            {confirmKill ? (
              <motion.span key="confirm" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.16, ease: EASE_OUT }} className="flex gap-1">
                <button type="button" className="btn btn-danger btn-sm" disabled={kill.isPending} onClick={() => { kill.mutate(); setConfirmKill(false); }}>
                  <Skull aria-hidden className="size-3.5" />Confirm kill -9
                </button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirmKill(false)}>Cancel</button>
              </motion.span>
            ) : (
              <motion.span key="kill" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <button type="button" className="btn btn-line btn-sm" onClick={() => setConfirmKill(true)}><Skull aria-hidden className="size-3.5" />kill -9</button>
              </motion.span>
            )}
          </AnimatePresence>
        )}
      </ProcessRow>
      {managed && (
        <div className="mt-6">
          <p className="mb-3 text-[14.5px] text-ink-2">Crash the worker at a failpoint on its next attempt. It restarts by itself afterwards.</p>
          <div className="flex flex-wrap gap-2">
            <button type="button" className="btn btn-line btn-sm" onClick={() => crashBefore.mutate()} disabled={crashBefore.isPending}>Before send</button>
            <button type="button" className="btn btn-line btn-sm" onClick={() => crashAfter.mutate()} disabled={crashAfter.isPending}>After response</button>
          </div>
        </div>
      )}
    </section>
  );
}

function ProcessRow({ name, running, detail, children }: { name: string; running?: boolean; detail: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-4 border-b border-rule py-3.5 first-of-type:border-t">
      <span aria-hidden className={cn("size-2 shrink-0 rounded-full", running === undefined ? "bg-ink-3" : running ? "bg-st-succeeded" : "bg-mark")} />
      <div className="min-w-0 flex-1">
        <p className="text-[16px] font-medium">{name} <span className="font-normal text-ink-2">{running === undefined ? "" : running ? "running" : "down"}</span></p>
        <p className="truncate font-mono text-[12.5px] text-ink-2">{running === undefined ? "…" : detail}</p>
      </div>
      <div className="flex shrink-0 gap-1">{children}</div>
    </div>
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
    <section>
      <BenchTitle aside={!!faults?.length && <button type="button" className="btn btn-quiet btn-sm" onClick={() => clear.mutate()} disabled={clear.isPending}><Trash2 aria-hidden className="size-3.5" />Clear</button>}>
        Armed faults
      </BenchTitle>
      <p className="mb-5 text-[14.5px] text-ink-2">Faults wait at the provider and fire on the next matching request, first in, first out.</p>
      {faults === null ? (
        <p className="mb-5 text-[15px] text-mark-ink">The provider is down.</p>
      ) : faults?.length ? (
        <ul className="mb-5 border-t border-rule">
          <AnimatePresence initial={false}>
            {faults.map((f, i) => (
              <motion.li key={`${f.mode}-${i}`} layout initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="flex items-center justify-between border-b border-rule py-2.5 font-mono text-[13px]">
                <span>{f.mode}</span>
                <span className="text-ink-2">{f.endpoint ?? "any"}{f.times > 1 ? `, ${f.times}×` : ""}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="mb-5 font-display text-[19px] text-ink-3 italic">None. Requests succeed normally.</p>
      )}
      <form
        className="grid grid-cols-[1fr_5rem] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          arm.mutate();
        }}
      >
        <label className="col-span-2 text-[14px] font-medium" htmlFor="fault-mode">Arm a fault by hand</label>
        <select id="fault-mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value)} className="field col-span-2 font-mono text-[13.5px]">
          {MODES.map((m) => <option key={m}>{m}</option>)}
        </select>
        <select aria-label="Endpoint" name="endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="field text-[14px]">
          <option value="">Any endpoint</option>
          <option value="/v1/charges">Charges</option>
          <option value="/v1/messages">Messages</option>
        </select>
        <input aria-label="Times" name="times" type="number" inputMode="numeric" min={1} max={20} value={times} onChange={(e) => setTimes(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="field text-[14px] tnum" />
        <button type="submit" disabled={arm.isPending} className="btn btn-ink col-span-2 mt-1">
          {arm.isPending ? "Arming…" : "Arm fault"}
        </button>
      </form>
    </section>
  );
}

function EventLog({ state }: { state?: LabState }) {
  const events = state?.events ?? [];
  return (
    <section>
      <BenchTitle>Lab log</BenchTitle>
      <p className="mb-5 text-[14.5px] text-ink-2">What the lab did to the processes, newest first.</p>
      {events.length === 0 ? (
        <p className="font-display text-[19px] text-ink-3 italic">Nothing yet.</p>
      ) : (
        <ol className="max-h-[22rem] overflow-y-auto border-t border-rule pr-1" data-lenis-prevent aria-live="polite">
          <AnimatePresence initial={false}>
            {events.slice(0, 40).map((e) => (
              <motion.li key={`${e.at}-${e.message}`} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.22, ease: EASE_OUT }} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 border-b border-rule py-2.5 text-[14px]">
                <time className="pt-px font-mono text-[12.5px] text-ink-2">{new Date(e.at * 1000).toLocaleTimeString("en-GB", { hour12: false })}</time>
                <span className={cn(/SIGKILL|died|exited/.test(e.message) && "text-mark-ink")}>{e.message}</span>
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
      <div className="grid gap-10 border-t-2 border-ink pt-8 lg:grid-cols-12">
        <p className="text-[17px] leading-relaxed lg:col-span-6">Lab mode is test scaffolding: a real backend never controls its provider's failures, so these controls exist only when you ask for them. Everything else in the console works without it.</p>
        <div className="lg:col-span-6">
          <pre className="bg-sheet p-5 font-mono text-[14px]">make dev</pre>
          <p className="mt-3 text-[14.5px] text-ink-2">It sets <code className="font-mono">ONESHOT_LAB=1</code> and <code className="font-mono">ONESHOT_LAB_MANAGE=1</code>.</p>
        </div>
      </div>
    </>
  );
}
