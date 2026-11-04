import { useEffect, useRef, useState } from "react";
import { motion, useMotionValue, useSpring } from "motion/react";
import { ArrowLeft, ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A horizontal chapter strip. It scrolls natively (trackpad swipe, shift+wheel,
 * touch with snapping, keyboard focus), can be dragged with a mouse, and has
 * step buttons. A red line under it shows how far through the chapter you are.
 * Vertical wheel always scrolls the page: the strip never hijacks it.
 */
export function Strip({ label, children }: { label: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: true, end: false });
  const progress = useMotionValue(0);
  const smooth = useSpring(progress, { stiffness: 260, damping: 34 });
  const drag = useRef<{ x: number; left: number; moved: boolean } | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const max = el.scrollWidth - el.clientWidth;
      progress.set(max <= 0 ? 1 : el.scrollLeft / max);
      setEdges({ start: el.scrollLeft < 4, end: el.scrollLeft > max - 4 });
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      el.removeEventListener("scroll", update);
      ro.disconnect();
    };
  }, [progress]);

  const step = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    const card = el.firstElementChild as HTMLElement | null;
    const w = card ? card.getBoundingClientRect().width + 20 : el.clientWidth * 0.8;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    el.scrollBy({ left: dir * w, behavior: reduce ? "auto" : "smooth" });
  };

  return (
    <div className="min-w-0">
      <div
        ref={ref}
        role="group"
        aria-label={label}
        data-lenis-prevent-horizontal
        className="strip flex gap-5 overflow-x-auto pb-1 select-none"
        onPointerDown={(e) => {
          if (e.pointerType !== "mouse" || e.button !== 0 || (e.target as HTMLElement).closest("button, a")) return;
          drag.current = { x: e.clientX, left: ref.current!.scrollLeft, moved: false };
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          if (Math.abs(dx) > 4) d.moved = true;
          ref.current!.scrollLeft = d.left - dx;
        }}
        onPointerUp={() => (drag.current = null)}
        onPointerLeave={() => (drag.current = null)}
      >
        {children}
      </div>
      <div className="mt-5 flex items-center gap-4">
        <div aria-hidden className="relative h-[2px] flex-1 bg-rule">
          <motion.div className="absolute inset-0 origin-left bg-mark" style={{ scaleX: smooth }} />
        </div>
        <div className="flex gap-1">
          <button type="button" aria-label={`Back in ${label}`} onClick={() => step(-1)} disabled={edges.start} className={cn("btn btn-line btn-sm size-9 px-0")}>
            <ArrowLeft aria-hidden className="size-4" />
          </button>
          <button type="button" aria-label={`Forward in ${label}`} onClick={() => step(1)} disabled={edges.end} className={cn("btn btn-line btn-sm size-9 px-0")}>
            <ArrowRight aria-hidden className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
