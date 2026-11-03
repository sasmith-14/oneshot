import { useRef } from "react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/** Accessible tabs (arrow keys move between them) with a sliding indicator. */
export function TabBar<T extends string>({ tabs, value, onChange, id }: { tabs: { id: T; label: string }[]; value: T; onChange: (v: T) => void; id: string }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="tablist" aria-label="Views" className="flex gap-1 border-b">
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
          className={cn("relative px-3 pt-1.5 pb-3 text-sm transition-colors", value === t.id ? "text-foreground" : "text-muted-foreground hover:text-foreground")}
        >
          {t.label}
          {value === t.id && <motion.span layoutId={`${id}-underline`} className="absolute inset-x-1 -bottom-px h-0.5 rounded-full bg-foreground" transition={{ type: "spring", stiffness: 500, damping: 40 }} />}
        </button>
      ))}
    </div>
  );
}
