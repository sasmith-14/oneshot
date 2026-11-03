import { createContext, useContext, useEffect, useState } from "react";
import Lenis from "lenis";
import { useReducedMotion } from "motion/react";

const LenisContext = createContext<Lenis | null>(null);
export const useLenis = () => useContext(LenisContext);

/** Smooth wheel scrolling on fine pointers. Off for reduced motion and touch,
 * where native scrolling is the accessible choice. Scrollable panels opt out
 * with `data-lenis-prevent`. */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  const reduce = useReducedMotion();
  const [lenis, setLenis] = useState<Lenis | null>(null);
  useEffect(() => {
    if (reduce || !matchMedia("(pointer: fine)").matches) return;
    const l = new Lenis({ lerp: 0.12, wheelMultiplier: 1, autoRaf: true, anchors: { offset: -80 } });
    setLenis(l);
    return () => {
      l.destroy();
      setLenis(null);
    };
  }, [reduce]);
  return <LenisContext.Provider value={lenis}>{children}</LenisContext.Provider>;
}
