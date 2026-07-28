/**
 * Motion constants mirrored from the global tokens in `client/src/index.css`
 * (`--ease-out` / `--ease-inout` / `--ease-micro`, `--t-micro` / `--t-base` /
 * `--t-reveal`). A framer-motion `transition.ease` can't read a CSS custom
 * property, so the same curves are duplicated here in array form — keep both
 * in sync if the app's motion language ever changes.
 *
 * The rule these encode (binding, see DESIGN-LANGUAGE.md): entrances travel
 * opacity 0->1, translateY 24px->0, blur 6px->0, eased with EASE_OUT. Nothing
 * travels further, nothing springs or overshoots — this product diagnoses,
 * it doesn't celebrate.
 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;
export const EASE_INOUT = [0.65, 0, 0.35, 1] as const;
export const EASE_MICRO = [0.4, 0, 0.2, 1] as const;

export const T_MICRO = 0.16;
export const T_BASE = 0.32;
export const T_REVEAL = 0.76;

/** The one entrance recipe, ready to spread into a motion element's props. */
export const REVEAL_IN = { opacity: 1, y: 0, filter: 'blur(0px)' };
export function revealFrom(distance = 24, blur = 6) {
  return { opacity: 0, y: distance, filter: `blur(${blur}px)` };
}
