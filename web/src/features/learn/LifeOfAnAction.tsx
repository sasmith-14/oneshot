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
    <div className="grid gap-x-16 lg:grid-cols-12">
      <div className="order-2 lg:order-1 lg:col-span-5">
        {STEPS.map((s, i) => <StepText key={i} index={i} step={s} active={i === active} onEnter={setActive} />)}
      </div>
      <div className="order-1 lg:order-2 lg:col-span-7">
        <div className="sticky top-14 z-10 -mx-5 bg-paper px-5 py-4 sm:-mx-8 sm:px-8 lg:top-28 lg:mx-0 lg:bg-sheet lg:p-7">
          <StateMachine current={step.current} path={pathOf(step)} focus={step.focus} label={`Diagram for step ${active + 1}: ${step.title}`} />
          <div className="mt-4 flex items-center justify-between gap-4">
            <AnimatePresence mode="wait" initial={false}>
              <motion.p key={active} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }} transition={{ duration: 0.22, ease: EASE_OUT }} className="t-head text-[22px]">
                {step.title}
              </motion.p>
            </AnimatePresence>
            <ol className="flex shrink-0 gap-1" aria-label={`Part ${active + 1} of ${STEPS.length}`}>
              {STEPS.map((_, i) => (
                <li key={i} className="relative h-[3px] w-5 overflow-hidden bg-rule">
                  <motion.span className="absolute inset-0 origin-left bg-mark" initial={false} animate={{ scaleX: i <= active ? 1 : 0 }} transition={{ duration: 0.35, ease: EASE_OUT }} />
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
    <div ref={ref} className="flex min-h-[64vh] items-center py-10 first:pt-4 last:min-h-[72vh]">
      <motion.div animate={{ opacity: active ? 1 : 0.28 }} transition={{ duration: 0.35, ease: EASE_OUT }}>
        <h3 className="t-title text-[clamp(2rem,3vw,2.5rem)]">{step.title}</h3>
        <p className="mt-4 max-w-[52ch] text-[17px] leading-relaxed">{step.body}</p>
      </motion.div>
    </div>
  );
}
