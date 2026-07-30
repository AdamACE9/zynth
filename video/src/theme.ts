/**
 * Zynth's design tokens, copied verbatim from client/src/index.css.
 *
 * Copied rather than imported because this Remotion project is deliberately
 * outside the npm workspaces — but the VALUES must match the product exactly.
 * An end card in slightly-off brand colours is worse than no end card: it is the
 * last frame a judge sees, and it should look like it came out of the same
 * machine as everything before it.
 */

export const COLORS = {
  bgVoid: '#030308',
  bgDeep: '#06070f',
  textPrimary: '#f4f6ff',
  textSecondary: 'rgba(240, 243, 253, 0.80)',
  textMuted: 'rgba(240, 243, 253, 0.58)',

  // Status colours. These mean mastery and nothing else, anywhere in the
  // product — including here.
  red: '#ff3b5c',
  amber: '#ffb020',
  green: '#28e0a0',

  accentCyan: '#52e5e8',
  accentViolet: '#9b7bff',

  // Nebula washes from the app's body background.
  nebulaIndigo: 'rgba(90, 74, 255, 0.22)',
  nebulaCyan: 'rgba(24, 200, 205, 0.14)',
  nebulaMagenta: 'rgba(200, 60, 190, 0.06)',
} as const;

/**
 * The app's motion language. `--ease-out` in index.css: entrances travel and
 * settle, nothing bounces or overshoots. This product diagnoses; it does not
 * celebrate, and the end card holds that line.
 */
export const EASE_OUT = [0.22, 1, 0.36, 1] as const;

export const VIDEO = {
  width: 1920,
  height: 1080,
  fps: 30,
  /** 8 seconds — long enough to read three lines and let the rule play once. */
  durationInFrames: 240,
} as const;

/**
 * Set to true ONLY after you have put a track at video/public/music.mp3.
 * Remotion's staticFile() throws at render time if the file is missing, so this
 * stays false by default and the card renders silently rather than failing.
 */
export const HAS_MUSIC = false;
