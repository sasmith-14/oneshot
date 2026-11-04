import { useRef } from "react";
import { motion } from "motion/react";
import { RULE_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Accessible tabs (arrow keys move between them). The accent mark
 * slides under the chosen one. */
export function TabBar<T extends string>({ tabs, value, onChange, id }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void; id: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label="Views" className="flex gap-8 border-b border-rule">
      {tabs.map((t, i) => (
        <button
          key={t.id}
          ref={(el) => {
            refs.current[i] = el;
          }}
          role="tab"
          id={`${id}-tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`${id}-panel`}
          tabIndex={value === t.id ? 0 : -1}
          onClick={() => onChange(t.id)}
          onKeyDown={(e) => {
            const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
            if (!d) return;
            const next = (i + d + tabs.length) % tabs.length;
            onChange(tabs[next].id);
            refs.current[next]?.focus();
          }}
          className={cn("relative pt-1 pb-3.5 text-[17px] transition-colors duration-150", value === t.id ? "font-medium text-ink" : "text-ink-2 hover:text-ink")}
        >
          {t.label}
          {value === t.id && <motion.span layoutId={`${id}-underline`} className="absolute inset-x-0 -bottom-px h-[3px] bg-mark" transition={RULE_SPRING} />}
        </button>
      ))}
    </div>
  );
}
