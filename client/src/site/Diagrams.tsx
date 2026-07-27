import type { CSSProperties } from 'react';

/**
 * Original inline-SVG diagrams and stroke icons for the marketing site.
 *
 * Idiom copied from the app's OWN icon language (see ui/NodePanel.tsx's
 * WarRoomIcon/ExplainIcon/QuizIcon: 19-24px viewBox, 1.6-1.9px stroke,
 * currentColor, no emoji) — not from either reference site. What IS ported
 * from the references (see site.css's top comment for the extracted
 * numbers) is the *construction technique* observed in Chorus's larger
 * illustrative SVGs: several small gradient defs per drawing rather than
 * flat fills, so a diagram reads as lit rather than flat-colored. Edge
 * colours follow the app's own edge palette (graph/Edges.tsx / Hero3D.tsx):
 * cyan for structural flow, violet for loose relation, amber-dashed for a
 * correlated exception — red/green never appear on a line, only on a node,
 * exactly as in the real graph.
 */

const RED = 'var(--status-red)';
const AMBER = 'var(--status-amber)';
const GREEN = 'var(--status-green)';

/** A soft radial "halo" behind a flat node — the SVG equivalent of the
 * additive billboard glow every 3D node uses (Hero3D.tsx / NodeMesh). */
function Halo({ id, color }: { id: string; color: string }) {
  return (
    <radialGradient id={id} cx="50%" cy="50%" r="50%">
      <stop offset="0%" stopColor={color} stopOpacity="0.55" />
      <stop offset="100%" stopColor={color} stopOpacity="0" />
    </radialGradient>
  );
}

/** 01 — the standard-of-proof state machine: red -> amber -> green is the
 * only forward route (cyan, solid); a failed retest vacates green back to
 * amber (amber, dashed) — decay, not a fresh path, so it reuses the
 * "correlated exception" dash idiom rather than a new colour. */
export function RuleStateMachine({ style }: { style?: CSSProperties }) {
  return (
    <svg viewBox="0 0 380 190" width="100%" height="100%" fill="none" aria-hidden focusable="false" style={style}>
      <defs>
        <Halo id="rsm-red" color={RED} />
        <Halo id="rsm-amber" color={AMBER} />
        <Halo id="rsm-green" color={GREEN} />
        <linearGradient id="rsm-flow" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--accent-cyan)" stopOpacity="0.85" />
          <stop offset="100%" stopColor="var(--accent-violet)" stopOpacity="0.85" />
        </linearGradient>
      </defs>

      {/* forward flow */}
      <path d="M70 95 H170" stroke="url(#rsm-flow)" strokeWidth="1.6" markerEnd="url(#rsm-arrow)" />
      <path d="M210 95 H310" stroke="url(#rsm-flow)" strokeWidth="1.6" markerEnd="url(#rsm-arrow)" />

      {/* decay: green fails a retest, drops back to amber */}
      <path
        d="M290 118 C 240 165, 180 165, 150 118"
        stroke={AMBER}
        strokeWidth="1.4"
        strokeDasharray="3 4"
        strokeOpacity="0.75"
        markerEnd="url(#rsm-arrow-amber)"
      />

      <defs>
        <marker id="rsm-arrow" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 Z" fill="var(--accent-violet)" fillOpacity="0.85" />
        </marker>
        <marker id="rsm-arrow-amber" viewBox="0 0 8 8" refX="6" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
          <path d="M0 0 L8 4 L0 8 Z" fill={AMBER} fillOpacity="0.75" />
        </marker>
      </defs>

      {/* nodes */}
      <circle cx="45" cy="95" r="30" fill="url(#rsm-red)" />
      <circle cx="45" cy="95" r="11" fill={RED} />
      <text x="45" y="140" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="11" letterSpacing="0.14em" fill="var(--text-muted)">RED</text>

      <circle cx="190" cy="95" r="30" fill="url(#rsm-amber)" />
      <circle cx="190" cy="95" r="13" fill={AMBER} />
      <text x="190" y="140" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="11" letterSpacing="0.14em" fill="var(--text-muted)">AMBER</text>

      <circle cx="335" cy="95" r="30" fill="url(#rsm-green)" />
      <circle cx="335" cy="95" r="15" fill={GREEN} />
      <text x="335" y="140" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="11" letterSpacing="0.14em" fill="var(--text-muted)">GREEN</text>

      <text x="112" y="82" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="0.08em" fill="var(--text-muted)">engage</text>
      <text x="260" y="82" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="0.08em" fill="var(--text-muted)">pass quiz</text>
      <text x="220" y="180" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="0.08em" fill={AMBER} opacity="0.8">fail retest — decays</text>
    </svg>
  );
}

/** 03 — Autopsy Board's "one misconception behind many mistakes": seven
 * loose wrong-answer points converge on a single cyan finding, which then
 * fans back out as new violet, dashed correlation edges across three
 * concepts — the exact edge grammar the live graph itself uses. */
export function FanInDiagram({ style }: { style?: CSSProperties }) {
  const mistakes = Array.from({ length: 7 }, (_, i) => ({
    x: 26,
    y: 18 + i * 24,
  }));
  const concepts = [
    { x: 330, y: 40, label: 'Chain Rule' },
    { x: 330, y: 95, label: 'Implicit Diff.' },
    { x: 330, y: 150, label: 'Related Rates' },
  ];
  return (
    <svg viewBox="0 0 380 190" width="100%" height="100%" fill="none" aria-hidden focusable="false" style={style}>
      <defs>
        <Halo id="fan-core" color="var(--accent-cyan)" />
        <linearGradient id="fan-in" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--text-muted)" stopOpacity="0.5" />
          <stop offset="100%" stopColor="var(--accent-cyan)" stopOpacity="0.7" />
        </linearGradient>
      </defs>

      {mistakes.map((m, i) => (
        <path key={i} d={`M${m.x} ${m.y} C 100 ${m.y}, 130 95, 178 95`} stroke="url(#fan-in)" strokeWidth="1" strokeOpacity="0.55" />
      ))}
      {mistakes.map((m, i) => (
        <circle key={i} cx={m.x} cy={m.y} r="3.2" fill="var(--text-muted)" fillOpacity="0.7" />
      ))}

      {/* the one misconception */}
      <circle cx="196" cy="95" r="34" fill="url(#fan-core)" />
      <circle cx="196" cy="95" r="14" fill="var(--accent-cyan)" />

      {concepts.map((c, i) => (
        <g key={c.label}>
          <path
            d={`M214 95 C 260 95, 280 ${c.y}, ${c.x - 14} ${c.y}`}
            stroke="var(--accent-violet)"
            strokeOpacity="0.55"
            strokeWidth="1.3"
            strokeDasharray="4 3"
          />
          <circle cx={c.x} cy={c.y} r="5" fill="var(--accent-violet)" fillOpacity="0.85" />
          <text
            x={c.x + 10}
            y={c.y + 3.5}
            fontFamily="'IBM Plex Mono', monospace"
            fontSize="9.5"
            letterSpacing="0.02em"
            fill="var(--text-secondary)"
          >
            {c.label}
          </text>
        </g>
      ))}

      <text x="26" y="8" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="0.14em" fill="var(--text-muted)">
        07 MISTAKES
      </text>
      <text x="196" y="150" textAnchor="middle" fontFamily="'IBM Plex Mono', monospace" fontSize="9" letterSpacing="0.14em" fill="var(--accent-cyan)">
        01 CAUSE
      </text>
    </svg>
  );
}

/** Circular confidence/mastery meter — gradient stroke, tabular-num label.
 * Used both for the Autopsy finding's confidence score and as a compact
 * "mastery ring" echo of the real NodePanel's status chip. */
export function MeterRing({ value, size = 64, label }: { value: number; size?: number; label?: string }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const dash = c * value;
  return (
    <div style={{ position: 'relative', width: size, height: size, flex: 'none' }}>
      <svg viewBox="0 0 64 64" width={size} height={size} style={{ transform: 'rotate(-90deg)' }} aria-hidden focusable="false">
        <defs>
          <linearGradient id="meter-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--accent-cyan)" />
            <stop offset="100%" stopColor="var(--accent-violet)" />
          </linearGradient>
        </defs>
        <circle cx="32" cy="32" r={r} stroke="var(--border-glass)" strokeWidth="4" fill="none" />
        <circle
          cx="32"
          cy="32"
          r={r}
          stroke="url(#meter-grad)"
          strokeWidth="4"
          fill="none"
          strokeDasharray={`${dash} ${c - dash}`}
          strokeLinecap="round"
        />
      </svg>
      <div
        className="mono"
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: size < 56 ? 12 : 14,
          fontWeight: 600,
          color: 'var(--text-primary)',
        }}
      >
        {label ?? Math.round(value * 100)}
      </div>
    </div>
  );
}

/* ── module row icons — same idiom as ui/NodePanel.tsx's action icons:
   19-22px viewBox, 1.6-1.9px stroke, currentColor, no emoji. ─────────────── */

const ICON_PROPS = { width: 22, height: 22, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7 } as const;

export function IconGraph() {
  return (
    <svg {...ICON_PROPS} aria-hidden focusable="false">
      <path d="M12 4.5 5 8v8l7 3.5 7-3.5V8z" strokeLinejoin="round" />
      <path d="M12 4.5v17M5 8l7 3.5 7-3.5" strokeLinejoin="round" />
    </svg>
  );
}

export function IconQuiz() {
  return (
    <svg {...ICON_PROPS} aria-hidden focusable="false">
      <rect x="3.6" y="3.6" width="16.8" height="16.8" rx="4.2" />
      <path d="m7.8 12.2 2.9 2.9 5.5-5.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconExplain() {
  return (
    <svg {...ICON_PROPS} aria-hidden focusable="false">
      <path d="M3.6 6.6a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H10l-4.5 3.5V16.6h-.9a3 3 0 0 1-3-3z" strokeLinejoin="round" />
      <path d="M8.4 10h7.2M8.4 13h4.2" strokeLinecap="round" />
    </svg>
  );
}

export function IconCopilot() {
  return (
    <svg {...ICON_PROPS} aria-hidden focusable="false">
      <path d="M3 13h3.4l2-6 3.2 12 2.4-9 1.6 3H21" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function IconPlan() {
  return (
    <svg {...ICON_PROPS} aria-hidden focusable="false">
      <path d="M4 18c4-1 4-5 8-5s4 4 8 5" strokeLinecap="round" strokeDasharray="1.2 3.4" />
      <circle cx="4" cy="18" r="1.8" fill="currentColor" stroke="none" />
      <circle cx="20" cy="6" r="1.8" fill="currentColor" stroke="none" />
      <path d="M4 18c4-1 4-5 8-5" strokeLinecap="round" opacity="0" />
    </svg>
  );
}

export function IconExam() {
  return (
    <svg {...ICON_PROPS} aria-hidden focusable="false">
      <circle cx="12" cy="13" r="8" />
      <path d="M12 8.6V13l3 2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 2.6h5" strokeLinecap="round" />
    </svg>
  );
}
