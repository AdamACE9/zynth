import { motion, useReducedMotion } from 'motion/react';

export type DemoStatus = 'red' | 'amber' | 'green';

export interface DemoStatusMeta {
  color: string;
  glow: string;
  /** One-word state, used as the headline term. */
  term: string;
  /** The evidence rule behind that word. */
  gloss: string;
  /** Full sentence label for screen readers. */
  label: string;
}

export const DEMO_STATUS_META: Record<DemoStatus, DemoStatusMeta> = {
  red: { color: 'var(--status-red)', glow: 'var(--status-red-glow)', term: 'Unproven', gloss: 'never touched', label: 'Untouched' },
  amber: {
    color: 'var(--status-amber)',
    glow: 'var(--status-amber-glow)',
    term: 'Engaged',
    gloss: 'worked on, not proven',
    label: 'Engaged, not proven',
  },
  green: { color: 'var(--status-green)', glow: 'var(--status-green-glow)', term: 'Proven', gloss: 'passed a quiz', label: 'Proven' },
};

export interface DemoNodeProps {
  status: DemoStatus;
  /** Bump this to replay the transition pulse (ring burst + core bump + fresh breathing glow). */
  pulseKey: number;
  /** Outer square size in px. */
  size?: number;
}

/**
 * A single self-contained "living graph node" rendered in CSS/DOM (no r3f —
 * this is a teaching prop, not the real graph). Colored strictly by the same
 * mastery-status language as the app: red/amber/green via CSS status tokens.
 *
 * Remounting the *pulse* layers on `pulseKey` change is a deliberate trick —
 * it restarts the ring burst, core bump and ambient breathing in sync so a
 * status change reads as one clean pulse rather than three independent tweens.
 * The orbit + satellite are intentionally NOT keyed: they spin continuously so
 * the node feels alive between interactions.
 */
export function DemoNode({ status, pulseKey, size = 176 }: DemoNodeProps) {
  const meta = DEMO_STATUS_META[status];
  const core = Math.round(size * 0.5);
  const orbitR = size * 0.42;
  // The orbit/satellite/glow are continuous infinite loops — genuinely
  // decorative motion rather than a state entrance, so reduced-motion turns
  // them off outright instead of just speeding them up.
  const reduceMotion = useReducedMotion();

  return (
    <div
      role="img"
      aria-label={`Demo concept node, currently ${meta.label.toLowerCase()}`}
      className="relative flex shrink-0 items-center justify-center"
      style={{ width: size, height: size }}
    >
      {/* ambient breathing glow */}
      <motion.div
        key={`glow-${pulseKey}`}
        aria-hidden
        className="absolute rounded-full"
        style={{ width: size, height: size, background: meta.glow, filter: `blur(${Math.round(size * 0.17)}px)` }}
        initial={{ opacity: 0.95 }}
        animate={{ opacity: reduceMotion ? 0.78 : [0.95, 0.55, 0.78] }}
        transition={{ duration: 2.2, ease: 'easeInOut', repeat: reduceMotion ? 0 : Infinity, repeatType: 'mirror' }}
      />

      {/* slow dashed orbit — continuous, never remounts */}
      <motion.svg
        aria-hidden
        className="absolute"
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        animate={{ rotate: reduceMotion ? 0 : 360 }}
        transition={{ duration: 34, repeat: reduceMotion ? 0 : Infinity, ease: 'linear' }}
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={orbitR}
          fill="none"
          stroke={meta.color}
          strokeOpacity={0.3}
          strokeWidth={1}
          strokeDasharray="2 9"
          style={{ transition: 'stroke 600ms ease-out' }}
        />
      </motion.svg>

      {/* satellite riding the orbit */}
      <motion.div
        aria-hidden
        className="absolute"
        style={{ width: size, height: size }}
        animate={{ rotate: reduceMotion ? 0 : 360 }}
        transition={{ duration: 16, repeat: reduceMotion ? 0 : Infinity, ease: 'linear' }}
      >
        <span
          className="absolute rounded-full"
          style={{
            left: '50%',
            top: size / 2 - orbitR - 3,
            width: 6,
            height: 6,
            marginLeft: -3,
            background: meta.color,
            boxShadow: `0 0 12px ${meta.glow}`,
            transition: 'background-color 600ms ease-out',
          }}
        />
      </motion.div>

      {/* transition burst ring */}
      <motion.div
        key={`ring-${pulseKey}`}
        aria-hidden
        className="absolute rounded-full"
        style={{ width: core, height: core, border: `2px solid ${meta.color}` }}
        initial={{ opacity: 0.9, scale: 0.6 }}
        animate={{ opacity: 0, scale: 2.1 }}
        transition={{ duration: reduceMotion ? 0 : 1, ease: 'easeOut' }}
      />

      {/* core sphere */}
      <motion.div
        key={`core-${pulseKey}`}
        aria-hidden
        className="relative rounded-full"
        style={{
          width: core,
          height: core,
          background: `radial-gradient(circle at 32% 26%, rgba(255,255,255,0.62) 0%, ${meta.color} 46%, ${meta.color} 100%)`,
          boxShadow: `0 0 46px ${meta.glow}, inset 0 0 20px rgba(255,255,255,0.2)`,
        }}
        initial={{ scale: 0.84 }}
        animate={{ scale: 1 }}
        transition={{ duration: reduceMotion ? 0 : 0.5, ease: [0.22, 1, 0.36, 1] }}
      />
    </div>
  );
}
