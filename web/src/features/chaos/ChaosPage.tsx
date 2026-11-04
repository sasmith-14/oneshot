import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, Loader2, Play, RotateCw, Skull, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { PageHeader, Panel } from "@/components/PageHeader";
import { StatusPill } from "@/components/StatusPill";
import { TabBar } from "@/components/Tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useActions, useLabState, usePresets, useSystemStatus } from "@/hooks/queries";
import { lab, type Action, type LabState, type Preset, type PresetResult } from "@/lib/api";
import { EASE_OUT, SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { FAULT_AT, FaultRoute } from "./FaultRoute";

export function ChaosPage() {
  const status = useSystemStatus();
  const labOn = !!status.data?.lab;
  const state = useLabState(labOn);
  const presets = usePresets(labOn);
  const actions = useActions();
  const [results, setResults] = useState<PresetResult[]>([]);
  const [group, setGroup] = useState<string>("all");
  const qc = useQueryClient();
  const navigate = useNavigate();
  const byId = useMemo(() => new Map((actions.data ?? []).map((a) => [a.id, a])), [actions.data]);

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

  const groups = presets.data?.groups ?? [];
  const tabs = [{ id: "all", label: "All" }, ...groups.map((g) => ({ id: g.id, label: g.title }))];
  const lastRun = new Map(results.map((r) => [r.preset.name, r] as const));

  return (
    <>
      <PageHeader title="Chaos" actions={<LabLine state={state.data} />}>
        Break things on purpose. Every preset injects a real failure (a dropped socket, a crashed process, a hung request) and submits an action, so you can watch OneShot handle it on the system map.
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-12">
        <div className="min-w-0 lg:col-span-8">
          <AnimatePresence initial={false}>{results.length > 0 && <Results results={results} byId={byId} />}</AnimatePresence>

          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            {groups.length > 0 && <TabBar id="groups" tabs={tabs} value={group} onChange={setGroup} />}
            <p className="text-[12.5px] text-fg-3">{presets.data?.presets.length ?? 0} presets, each a real fault</p>
          </div>

          {!presets.data ? (
            <Skeleton className="h-96 rounded-[12px]" />
          ) : (
            groups
              .filter((g) => group === "all" || g.id === group)
              .map((g) => (
                <section key={g.id} id={g.id} aria-labelledby={`${g.id}-title`} className="mb-8">
                  <div className="mb-3">
                    <h2 id={`${g.id}-title`} className="t-h2">{g.title}</h2>
                    <p className="mt-0.5 text-[13px] text-fg-2">{g.about}</p>
                  </div>
                  <motion.div layout className="grid gap-3 md:grid-cols-2">
                    {presets.data!.presets
                      .filter((p) => p.group === g.id)
                      .map((p) => (
                        <PresetCard
                          key={p.name}
                          preset={p}
                          disabled={p.needs_managed && !state.data?.managed}
                          running={run.isPending && run.variables === p.name}
                          onRun={() => run.mutate(p.name)}
                          last={lastRun.get(p.name)}
                          byId={byId}
                        />
                      ))}
                  </motion.div>
                </section>
              ))
          )}
        </div>

        <aside id="bench" className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:col-span-4 lg:self-start">
          <Processes state={state.data} />
          <Faults state={state.data} />
          <EventLog state={state.data} />
        </aside>
      </div>
    </>
  );
}

function LabLine({ state }: { state?: LabState }) {
  const faults = state?.faults?.length ?? 0;
  const chip = (ok: boolean | undefined, text: string) => (
    <span className="chip h-7">
      <span className={cn("size-1.5 rounded-full", ok === undefined ? "bg-fg-3" : ok ? "bg-st-succeeded" : "bg-st-failed")} />
      {text}
    </span>
  );
  return (
    <>
      {chip(state?.provider.running, state ? (state.provider.running ? "Provider up" : "Provider down") : "Provider …")}
      {chip(state?.worker.running, state ? (state.worker.running ? `Worker pid ${state.worker.pid}` : "Worker stopped") : "Worker …")}
      {chip(state ? faults === 0 : undefined, faults === 0 ? "No faults armed" : `${faults} fault${faults > 1 ? "s" : ""} armed`)}
    </>
  );
}

const FINAL = ["SUCCEEDED", "FAILED", "UNKNOWN"];

function PresetCard({ preset, onRun, running, disabled, last, byId }: { preset: Preset; onRun: () => void; running: boolean; disabled: boolean; last?: PresetResult; byId: Map<string, Action> }) {
  const runActions = (last?.action_ids ?? []).map((id) => byId.get(id)).filter(Boolean) as Action[];
  const settled = runActions.length > 0 && runActions.every((a) => FINAL.includes(a.status));
  return (
    <motion.article layout transition={SPRING} className={cn("panel flex flex-col p-4 transition-[border-color,opacity] duration-200", disabled && "opacity-60", runActions.length > 0 && !settled && "border-signal/60")}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="t-h3">{preset.title}</h3>
          <p className="mt-1 text-[13px] leading-relaxed text-fg-2">{preset.what}</p>
        </div>
        <button
          type="button"
          onClick={onRun}
          disabled={running || disabled}
          title={disabled ? "Needs the API to manage processes (ONESHOT_LAB_MANAGE=1, as make dev does)" : undefined}
          className="btn btn-primary btn-sm shrink-0"
        >
          {running ? <Loader2 aria-hidden className="size-3 animate-spin" /> : <Play aria-hidden className="size-3" />}
          {running ? "Starting" : "Run"}
        </button>
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <FaultRoute preset={preset.name} className="flex-1" />
        <span className="shrink-0 pb-1 text-right text-[11.5px] text-fg-3">{FAULT_AT[preset.name]?.note}</span>
      </div>

      <p className="mt-2 rounded-[8px] bg-sunken px-3 py-2 text-[12.5px] leading-relaxed text-fg-2">
        <span className="font-[600] text-fg">Expect </span>
        {preset.expect}
      </p>

      <AnimatePresence initial={false}>
        {runActions.length > 0 && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }} transition={{ duration: 0.25, ease: EASE_OUT }} className="overflow-hidden">
            <div className="mt-3 flex flex-col gap-1.5 border-t border-line pt-3">
              {runActions.map((a) => (
                <Link key={a.id} to={`/actions/${a.id}`} className="group flex items-center gap-2.5 text-[12.5px]">
                  <StatusPill status={a.status} explain={false} />
                  <span className="truncate font-mono text-fg-2">{a.id}</span>
                  <ArrowRight aria-hidden className="ml-auto size-3.5 text-fg-3 transition-transform duration-150 group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <p className="mt-auto pt-3 font-mono text-[11px] text-fg-3" translate="no">{preset.name}</p>
    </motion.article>
  );
}

function Results({ results, byId }: { results: PresetResult[]; byId: Map<string, Action> }) {
  return (
    <motion.section initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3, ease: EASE_OUT }} className="panel mb-6 overflow-hidden" aria-labelledby="runs-title">
      <div className="panel-head">
        <h2 id="runs-title" className="t-h3">Your runs</h2>
        <Link to="/" className="link-quiet flex items-center gap-1 text-[12.5px] text-fg-2">Watch on the system map <ArrowRight aria-hidden className="size-3" /></Link>
      </div>
      <ul>
        <AnimatePresence initial={false}>
          {results.map((r, i) => (
            <motion.li key={`${r.action_ids[0]}-${i}`} layout initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0 }} transition={SPRING} className="grid gap-x-6 gap-y-1.5 border-b border-line px-[18px] py-3 last:border-0 md:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <p className="text-[13.5px] font-[560]">{r.preset.title}</p>
                {r.note && <p className="text-[12.5px] text-fg-3">{r.note}</p>}
              </div>
              <span className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                {r.action_ids.map((id) => {
                  const a = byId.get(id);
                  return (
                    <Link key={id} to={`/actions/${id}`} className="flex items-center gap-2">
                      <span className="link-quiet font-mono text-[12px] text-fg-2">{id}</span>
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
    <Panel title="Processes" aside={<span className="text-[12px] text-fg-3">{managed ? "real child processes" : "not managed"}</span>}>
      {!managed && <p className="mb-3 text-[12.5px] text-fg-2">This API does not manage processes, so control is off. Start with <code className="font-mono">make dev</code> to enable it.</p>}
      <ProcessRow name="Provider" running={p?.running} detail={p?.running ? p.url : "down: requests and lookups fail"}>
        {managed && !p?.running && <button type="button" className="btn btn-primary btn-sm" onClick={() => restart.mutate()} disabled={restart.isPending}><RotateCw aria-hidden className="size-3" />Restart</button>}
      </ProcessRow>
      <ProcessRow name="Worker" running={w?.running} detail={w?.running ? `pid ${w.pid}${w.failpoints.length ? `, armed: ${w.failpoints.join(", ")}` : ""}` : "down: actions wait safely on disk"}>
        {managed && !w?.running && <button type="button" className="btn btn-primary btn-sm" onClick={() => start.mutate()} disabled={start.isPending}><Play aria-hidden className="size-3" />Start</button>}
        {managed && w?.running && (
          <AnimatePresence mode="wait" initial={false}>
            {confirmKill ? (
              <motion.span key="confirm" initial={{ opacity: 0, scale: 0.96 }} animate={{ opacity: 1, scale: 1 }} transition={{ duration: 0.16, ease: EASE_OUT }} className="flex gap-1">
                <button type="button" className="btn btn-danger btn-sm" disabled={kill.isPending} onClick={() => { kill.mutate(); setConfirmKill(false); }}>
                  <Skull aria-hidden className="size-3" />Confirm
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setConfirmKill(false)}>Cancel</button>
              </motion.span>
            ) : (
              <motion.span key="kill" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                <button type="button" className="btn btn-outline btn-sm" onClick={() => setConfirmKill(true)}><Skull aria-hidden className="size-3" />kill -9</button>
              </motion.span>
            )}
          </AnimatePresence>
        )}
      </ProcessRow>
      {managed && (
        <div className="mt-3 border-t border-line pt-3">
          <p className="mb-2 text-[12.5px] text-fg-2">Crash the worker at a failpoint on its next attempt. It restarts by itself afterwards.</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className="btn btn-outline btn-sm" onClick={() => crashBefore.mutate()} disabled={crashBefore.isPending}>Before send</button>
            <button type="button" className="btn btn-outline btn-sm" onClick={() => crashAfter.mutate()} disabled={crashAfter.isPending}>After response</button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ProcessRow({ name, running, detail, children }: { name: string; running?: boolean; detail: string; children?: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="relative flex size-2 shrink-0">
        {running && <span className="os-ring absolute inset-0 rounded-full bg-st-succeeded" />}
        <span className={cn("relative size-2 rounded-full", running === undefined ? "bg-fg-3" : running ? "bg-st-succeeded" : "bg-st-failed")} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-[13.5px] font-[560]">{name} <span className="font-normal text-fg-3">{running === undefined ? "" : running ? "running" : "down"}</span></p>
        <p className="truncate font-mono text-[11.5px] text-fg-3">{running === undefined ? "…" : detail}</p>
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
    <Panel title="Armed faults" aside={!!faults?.length && <button type="button" className="btn btn-ghost btn-sm" onClick={() => clear.mutate()} disabled={clear.isPending}><Trash2 aria-hidden className="size-3" />Clear</button>}>
      <p className="mb-3 text-[12.5px] text-fg-2">Faults wait at the provider and fire on the next matching request, first in, first out.</p>
      {faults === null ? (
        <p className="mb-3 text-[13px] text-st-failed-fg">The provider is down.</p>
      ) : faults?.length ? (
        <ul className="mb-3 space-y-1">
          <AnimatePresence initial={false}>
            {faults.map((f, i) => (
              <motion.li key={`${f.mode}-${i}`} layout initial={{ opacity: 0, x: 8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -8 }} className="flex items-center justify-between rounded-[7px] bg-st-verifying-soft px-2.5 py-1.5 font-mono text-[12px] text-st-verifying-fg">
                <span>{f.mode}</span>
                <span className="opacity-80">{f.endpoint ?? "any"}{f.times > 1 ? `, ${f.times}×` : ""}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      ) : (
        <p className="mb-3 text-[13px] text-fg-3">None. Requests succeed normally.</p>
      )}
      <form
        className="grid grid-cols-[1fr_4.5rem] gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          arm.mutate();
        }}
      >
        <label className="col-span-2 text-[12px] font-[560] text-fg-2" htmlFor="fault-mode">Arm a fault by hand</label>
        <select id="fault-mode" name="mode" value={mode} onChange={(e) => setMode(e.target.value)} className="field col-span-2 font-mono text-[12.5px]">
          {MODES.map((m) => <option key={m}>{m}</option>)}
        </select>
        <select aria-label="Endpoint" name="endpoint" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} className="field text-[13px]">
          <option value="">Any endpoint</option>
          <option value="/v1/charges">Charges</option>
          <option value="/v1/messages">Messages</option>
        </select>
        <input aria-label="Times" name="times" type="number" inputMode="numeric" min={1} max={20} value={times} onChange={(e) => setTimes(Math.max(1, Math.min(20, Number(e.target.value) || 1)))} className="field text-[13px] tnum" />
        <button type="submit" disabled={arm.isPending} className="btn btn-outline col-span-2">
          {arm.isPending ? "Arming…" : "Arm fault"}
        </button>
      </form>
    </Panel>
  );
}

function EventLog({ state }: { state?: LabState }) {
  const events = state?.events ?? [];
  return (
    <Panel title="Lab log" bodyClassName="p-0">
      {events.length === 0 ? (
        <p className="px-[18px] py-4 text-[13px] text-fg-3">Nothing yet.</p>
      ) : (
        <ol className="max-h-[18rem] overflow-y-auto bg-sunken px-[18px] py-3 font-mono text-[11.5px] leading-relaxed" data-lenis-prevent aria-live="polite">
          <AnimatePresence initial={false}>
            {events.slice(0, 40).map((e) => (
              <motion.li key={`${e.at}-${e.message}`} layout initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.2, ease: EASE_OUT }} className="grid grid-cols-[4.25rem_minmax(0,1fr)] gap-2 py-0.5">
                <time className="text-fg-3">{new Date(e.at * 1000).toLocaleTimeString("en-GB", { hour12: false })}</time>
                <span className={cn("break-words", /SIGKILL|died|exited/.test(e.message) ? "text-st-failed-fg" : "text-fg-2")}>{e.message}</span>
              </motion.li>
            ))}
          </AnimatePresence>
        </ol>
      )}
    </Panel>
  );
}

function LabOff() {
  return (
    <>
      <PageHeader title="Chaos">Fault injection and process control are switched off.</PageHeader>
      <Panel className="max-w-3xl">
        <p className="text-[14px] leading-relaxed">Lab mode is test scaffolding: a real backend never controls its provider's failures, so these controls exist only when you ask for them. Everything else in the console works without it.</p>
        <pre className="well mt-4 p-3 font-mono text-[13px]">make dev</pre>
        <p className="mt-3 text-[12.5px] text-fg-2">It sets <code className="font-mono">ONESHOT_LAB=1</code> and <code className="font-mono">ONESHOT_LAB_MANAGE=1</code>.</p>
      </Panel>
    </>
  );
}
