import { useRef } from "react";
import { motion } from "motion/react";
import { RULE_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

/** Accessible segmented tabs (arrow keys move between them); a raised pill
 * slides to the chosen one. */
export function TabBar<T extends string>({ tabs, value, onChange, id, className }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void; id: string; className?: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label="Views" className={cn("inline-flex gap-0.5 rounded-[10px] border border-line bg-sunken p-0.5", className)}>
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
          className={cn("relative h-7 rounded-[8px] px-3 text-[13px] transition-colors duration-150", value === t.id ? "font-[560] text-fg" : "text-fg-2 hover:text-fg")}
        >
          {value === t.id && <motion.span layoutId={`${id}-tab`} aria-hidden className="absolute inset-0 rounded-[8px] border border-line bg-surface shadow-[var(--shadow-card)]" transition={RULE_SPRING} />}
          <span className="relative">{t.label}</span>
        </button>
      ))}
    </div>
  );
}
