import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useInView } from "motion/react";
import type { Status } from "@/lib/api";
import { StateMachine, type Path } from "@/components/StateMachine";
import { EASE_OUT } from "@/lib/motion";

// Scrollytelling: the diagram stays put while the story scrolls past it, and
// each step lights up the states and transitions it describes.

interface Step {
  title: string;
  body: string;
  current: Status;
  edges: string[];
  focus?: string;
}

const P = "PENDING>IN_FLIGHT";
const IV = "IN_FLIGHT>VERIFYING";

export const STEPS: Step[] = [
  { title: "An agent asks for something", body: "An agent sends POST /actions with an Idempotency-Key: send this text message. OneShot writes the action to disk before replying 201, so from this moment it survives a crash of the API, the worker, or both. Repeat the request with the same key and you get the same action back, not a second one.", current: "PENDING", edges: [] },
  { title: "A worker claims it, and writes down its intent", body: "In one database transaction a worker takes a time-limited lease on the action and records the attempt before any request leaves. If the worker dies mid-send, recovery will find that open attempt and knows a request may have gone out.", current: "IN_FLIGHT", edges: [P], focus: P },
  { title: "The response is lost", body: "The provider sends the message, then the connection drops. OneShot cannot tell whether it happened. Messages carry no idempotency key, so blindly resending could text the customer twice. Instead of guessing, OneShot moves to VERIFYING.", current: "VERIFYING", edges: [P, IV], focus: IV },
  { title: "Look before resending", body: "After the settle window, the worker asks the provider's own ledger: is there an effect with this action's reference? There is. The action is SUCCEEDED, and nothing is resent. One message, even though the first answer never arrived.", current: "SUCCEEDED", edges: [P, IV, "VERIFYING>SUCCEEDED"], focus: "VERIFYING>SUCCEEDED" },
  { title: "If the ledger had been empty", body: "No record after the settle window is treated as not applied, so a resend is safe and the action goes back to PENDING. That relies on one stated assumption: the provider finishes within the window. If it is slower, the message can be sent twice. That is a documented gap, and reconciliation flags it.", current: "PENDING", edges: [P, IV, "VERIFYING>PENDING"], focus: "VERIFYING>PENDING" },
  { title: "If the provider could not be reached", body: "Lookups fail, so OneShot retries the lookup a few times with backoff. Then it stops at UNKNOWN: an honest “I cannot tell”, which a person or a later process can query, alert on and resolve. It never guesses SUCCEEDED or FAILED.", current: "UNKNOWN", edges: [P, IV, "VERIFYING>VERIFYING", "VERIFYING>UNKNOWN"], focus: "VERIFYING>UNKNOWN" },
  { title: "Reconciliation closes the case", body: "Once the provider is back, reconciliation reads its whole ledger, finds the effect, and resolves the action to SUCCEEDED, recorded in the audit trail with who resolved it and why. Final answers are never flipped silently; only UNKNOWN is resolved automatically.", current: "SUCCEEDED", edges: [P, IV, "VERIFYING>VERIFYING", "VERIFYING>UNKNOWN", "UNKNOWN>SUCCEEDED"], focus: "UNKNOWN>SUCCEEDED" },
];

function pathOf(step: Step): Path {
  const edges = new Map(step.edges.map((e) => [e, 1]));
  const visited = new Set<Status>(["PENDING"]);
  for (const e of step.edges) for (const s of e.split(">")) visited.add(s as Status);
  return { edges, visited };
}

export function LifeOfAnAction() {
  const [active, setActive] = useState(0);
  const step = STEPS[active];
  return (
    <div className="grid gap-x-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
      <div className="order-2 lg:order-1">
        {STEPS.map((s, i) => <StepText key={i} index={i} step={s} active={i === active} onEnter={setActive} />)}
      </div>
      <div className="order-1 lg:order-2">
        <div className="sticky top-16 z-10 -mx-4 border-b bg-background/90 px-4 py-3 backdrop-blur lg:top-24 lg:mx-0 lg:rounded-[14px] lg:border lg:bg-card lg:p-5">
          <StateMachine current={step.current} path={pathOf(step)} focus={step.focus} label={`Diagram for step ${active + 1}: ${step.title}`} />
          <div className="mt-2 flex items-center justify-between gap-3">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={active} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.2, ease: EASE_OUT }} className="text-sm font-medium">
                {step.title}
              </motion.p>
            </AnimatePresence>
            <ol className="flex gap-1" aria-label="Progress through the story">
              {STEPS.map((_, i) => (
                <li key={i} className="relative h-1.5 w-5 overflow-hidden rounded-full bg-muted">
                  {i <= active && <motion.span layoutId={i === active ? "story-dot" : undefined} className="absolute inset-0 rounded-full bg-foreground" />}
                </li>
              ))}
            </ol>
          </div>
        </div>
      </div>
    </div>
  );
}

function StepText({ step, index, active, onEnter }: { step: Step; index: number; active: boolean; onEnter: (i: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: "-45% 0px -45% 0px" });
  useEffect(() => {
    if (inView) onEnter(index);
  }, [inView, onEnter, index]);
  return (
    <div ref={ref} className="flex min-h-[62vh] items-center py-10 first:pt-4 last:min-h-[70vh]">
      <motion.div animate={{ opacity: active ? 1 : 0.32 }} transition={{ duration: 0.3, ease: EASE_OUT }}>
        <p className="font-mono text-xs text-muted-foreground">Step {index + 1} of {STEPS.length}</p>
        <h3 className="mt-2 text-2xl leading-tight font-semibold tracking-[-0.015em]">{step.title}</h3>
        <p className="mt-3 max-w-[60ch] text-[15.5px] leading-relaxed text-muted-foreground">{step.body}</p>
      </motion.div>
    </div>
  );
}
