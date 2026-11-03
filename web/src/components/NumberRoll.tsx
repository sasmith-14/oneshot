import { useEffect, useRef } from "react";
import { animate, useReducedMotion } from "motion/react";

/** A count that rolls to its new value, so a change catches the eye. */
export function NumberRoll({ value, className }: { value: number; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(value);
  const reduce = useReducedMotion();
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (reduce || prev.current === value) {
      el.textContent = String(value);
      prev.current = value;
      return;
    }
    const controls = animate(prev.current, value, {
      duration: 0.45,
      ease: [0.23, 1, 0.32, 1],
      onUpdate: (v) => (el.textContent = String(Math.round(v))),
    });
    prev.current = value;
    return () => controls.stop();
  }, [value, reduce]);
  return (
    <span ref={ref} className={className} style={{ fontVariantNumeric: "tabular-nums" }}>
      {value}
    </span>
  );
}
