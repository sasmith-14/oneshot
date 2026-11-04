import { Fragment, createElement, useLayoutEffect, useRef, useState } from "react";
import { useInView, useReducedMotion } from "motion/react";
import { cn } from "@/lib/utils";

type Tag = "h1" | "h2" | "h3" | "p";

/**
 * A headline that is "set" line by line the first time it comes into view:
 * each line rises out of a mask, the way type drops into a forme. Lines are
 * measured after the web fonts load, so the reveal follows the real wrapping.
 * Under reduced motion it is plain text. Transform only; runs once.
 */
export function SetHeadline({ as = "h1", text, className, delay = 0, id }: { as?: Tag; text: string; className?: string; delay?: number; id?: string }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLElement>(null);
  const seen = useInView(ref, { once: true, margin: "0px 0px -8% 0px" });
  const [lines, setLines] = useState<number[] | null>(null);
  const words = text.split(" ");

  useLayoutEffect(() => {
    if (reduce) return;
    let alive = true;
    const measure = () => {
      const el = ref.current;
      if (!el || !alive) return;
      let line = -1;
      let last = -Infinity;
      const out: number[] = [];
      el.querySelectorAll<HTMLElement>("[data-word]").forEach((w) => {
        if (w.offsetTop > last + 4) {
          line += 1;
          last = w.offsetTop;
        }
        out.push(line);
      });
      setLines(out);
    };
    measure();
    document.fonts?.ready.then(measure);
    return () => {
      alive = false;
    };
  }, [text, reduce]);

  if (reduce) return createElement(as, { id, className }, text);

  const shown = seen && lines !== null;
  return createElement(
    as,
    // Headings take their name from aria-label; a paragraph has no name, so it
    // carries a screen-reader copy of its text instead.
    as === "p" ? { id, ref, className } : { id, ref, className, "aria-label": text },
    as === "p" && <span className="sr-only">{text}</span>,
    words.map((w, i) => (
      <Fragment key={i}>
        <span data-word aria-hidden className="inline-block overflow-hidden pb-[0.12em] -mb-[0.12em] align-top">
          <span
            className={cn("inline-block will-change-transform")}
            style={{
              transform: shown ? "translateY(0)" : "translateY(108%)",
              transition: `transform 760ms cubic-bezier(0.23, 1, 0.32, 1) ${delay + (lines?.[i] ?? 0) * 95}ms`,
            }}
          >
            {w}
          </span>
        </span>
        {i < words.length - 1 ? <span aria-hidden> </span> : null}
      </Fragment>
    )),
  );
}
