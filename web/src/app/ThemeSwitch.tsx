import { useRef } from "react";
import { motion } from "motion/react";
import { Monitor, Moon, Sun } from "lucide-react";
import type { ThemeMode } from "./theme";
import { RULE_SPRING } from "@/lib/motion";
import { cn } from "@/lib/utils";

export const THEME_MODES: { mode: ThemeMode; label: string; Icon: typeof Sun }[] = [
  { mode: "system", label: "System", Icon: Monitor },
  { mode: "light", label: "Light", Icon: Sun },
  { mode: "dark", label: "Dark", Icon: Moon },
];

/** System, light or dark, as a three-way switch (a radio group: arrow keys
 * move the choice). `id` keeps the sliding marker separate when the switch
 * appears twice (masthead and condensed bar). */
export function ThemeSwitch({ id, mode, setMode }: { id: string; mode: ThemeMode; setMode: (m: ThemeMode) => void }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  return (
    <div role="radiogroup" aria-label="Theme" className="flex items-center rounded-[3px] border border-rule p-0.5">
      {THEME_MODES.map(({ mode: m, label, Icon }, i) => {
        const on = mode === m;
        return (
          <button
            key={m}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`${label} theme`}
            title={m === "system" ? "System: follow the computer's setting" : `${label} theme`}
            tabIndex={on ? 0 : -1}
            onClick={() => setMode(m)}
            onKeyDown={(e) => {
              const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
              if (!d) return;
              e.preventDefault();
              const next = (i + d + THEME_MODES.length) % THEME_MODES.length;
              setMode(THEME_MODES[next].mode);
              refs.current[next]?.focus();
            }}
            className={cn("relative grid size-7 place-items-center rounded-[2px] transition-colors duration-150", on ? "text-paper" : "text-ink-2 hover:text-ink")}
          >
            {on && <motion.span layoutId={`${id}-theme`} aria-hidden className="absolute inset-0 rounded-[2px] bg-ink" transition={RULE_SPRING} />}
            <Icon aria-hidden className="relative size-3.5" />
          </button>
        );
      })}
    </div>
  );
}
