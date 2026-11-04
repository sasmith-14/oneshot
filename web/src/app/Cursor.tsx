import { useEffect, useState } from "react";
import { motion, useMotionValue, useReducedMotion, useSpring } from "motion/react";

type Mode = "hidden" | "dot" | "link" | "text";

const CLICKABLE = "a, button, [role=button], [role=tab], [role=radio], [role=option], [role=checkbox], [role=switch], label, select, summary, input[type=checkbox], input[type=radio], [data-cursor=link]";
const TYPING = "input, textarea, [contenteditable=true]";

function classify(target: EventTarget | null): Mode {
  const el = target instanceof Element ? target : null;
  if (!el) return "dot";
  const typing = el.closest(TYPING);
  if (typing && !(typing instanceof HTMLInputElement && ["checkbox", "radio", "range"].includes(typing.type))) return "text";
  return el.closest(CLICKABLE) ? "link" : "dot";
}

/**
 * The ink cursor: a small dot that sits exactly under the pointer, and a ring
 * that follows on a spring and grows over anything clickable. Only for a real
 * mouse (fine pointer with hover) and never under reduced motion; text fields
 * keep the native caret. It inverts against whatever it is over, so it stays
 * visible on paper, on ink buttons and in dark mode.
 */
export function Cursor() {
  const reduce = useReducedMotion();
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<Mode>("hidden");
  const [down, setDown] = useState(false);
  const x = useMotionValue(-100);
  const y = useMotionValue(-100);
  const rx = useSpring(x, { stiffness: 700, damping: 48, mass: 0.45 });
  const ry = useSpring(y, { stiffness: 700, damping: 48, mass: 0.45 });

  useEffect(() => {
    const mq = matchMedia("(hover: hover) and (pointer: fine)");
    const update = () => setEnabled(mq.matches && !reduce);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [reduce]);

  useEffect(() => {
    if (!enabled) return;
    const root = document.documentElement;
    root.classList.add("has-cursor");
    const move = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      x.set(e.clientX);
      y.set(e.clientY);
      setMode(classify(e.target));
    };
    const leave = () => setMode("hidden");
    const press = () => setDown(true);
    const release = () => setDown(false);
    window.addEventListener("pointermove", move, { passive: true });
    window.addEventListener("pointerdown", press, { passive: true });
    window.addEventListener("pointerup", release, { passive: true });
    document.documentElement.addEventListener("pointerleave", leave);
    window.addEventListener("blur", leave);
    return () => {
      root.classList.remove("has-cursor");
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerdown", press);
      window.removeEventListener("pointerup", release);
      document.documentElement.removeEventListener("pointerleave", leave);
      window.removeEventListener("blur", leave);
    };
  }, [enabled, x, y]);

  if (!enabled) return null;
  const visible = mode === "dot" || mode === "link";
  const overLink = mode === "link";

  return (
    <div aria-hidden className="pointer-events-none fixed inset-0 z-[80] mix-blend-difference">
      <motion.div
        className="absolute top-0 left-0 size-9 rounded-full border-[1.5px] border-white"
        style={{ x: rx, y: ry, translateX: "-50%", translateY: "-50%" }}
        initial={false}
        animate={{ scale: overLink ? (down ? 0.82 : 1) : 0.3, opacity: visible && overLink ? 1 : 0 }}
        transition={{ type: "spring", stiffness: 520, damping: 36 }}
      />
      <motion.div
        className="absolute top-0 left-0 size-2 rounded-full bg-white"
        style={{ x, y, translateX: "-50%", translateY: "-50%" }}
        initial={false}
        animate={{ scale: !visible ? 0 : overLink ? 0.55 : down ? 0.7 : 1, opacity: visible ? 1 : 0 }}
        transition={{ duration: 0.16, ease: [0.23, 1, 0.32, 1] }}
      />
    </div>
  );
}
