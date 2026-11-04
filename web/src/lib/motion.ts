// Motion tokens (see docs/FRONTEND_DESIGN.md). A strong ease-out for anything
// that enters; critically damped springs for things that physically move
// (Wire tokens, indicators). Nothing bounces: this is a paper, not a toy.
export const EASE_OUT = [0.23, 1, 0.32, 1] as const;
export const EASE_IN_OUT = [0.77, 0, 0.175, 1] as const;
export const DUR = { fast: 0.14, base: 0.22, slow: 0.36 } as const;
export const SPRING = { type: "spring", stiffness: 420, damping: 38, mass: 0.8 } as const;
export const SOFT_SPRING = { type: "spring", stiffness: 260, damping: 32 } as const;
/** the indicator under the active section or tab */
export const RULE_SPRING = { type: "spring", stiffness: 520, damping: 44 } as const;
