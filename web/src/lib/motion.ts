// Motion tokens (see docs/FRONTEND_DESIGN.md). Short, strong ease-out for UI;
// critically damped springs for things that physically move (Wire tokens).
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const DUR = { fast: 0.14, base: 0.2, slow: 0.32 } as const;
export const SPRING = { type: "spring", stiffness: 420, damping: 36, mass: 0.8 } as const;
export const SOFT_SPRING = { type: "spring", stiffness: 260, damping: 30 } as const;
