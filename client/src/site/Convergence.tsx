import { useEffect, useRef, useState } from 'react';

/**
 * The Autopsy figure: seven wrong answers, three concepts, one cause.
 *
 * Seven curved paths fall from separate mistakes and converge on a single
 * point. The paths draw themselves in on scroll (stroke-dashoffset), staggered
 * so the eye follows them downward rather than seeing them appear at once; the
 * cause node only resolves once every line has arrived.
 *
 * The colour runs red at the mistakes to amber at the cause — the finding is a
 * diagnosis, not a verdict, so it never reaches green.
 */

const W = 860;
const H = 340;

/** Seven sources, spread across the top, converging on (430, 288). */
const SOURCES = [
  { x: 42,  label: 'Q2'  },
  { x: 172, label: 'Q5'  },
  { x: 302, label: 'Q7'  },
  { x: 430, label: 'Q11' },
  { x: 558, label: 'Q14' },
  { x: 688, label: 'Q18' },
  { x: 818, label: 'Q23' },
];

const TOP = 52;
const CX = 430;
const CY = 288;

/** A cubic that leaves the mistake vertically and arrives at the cause
 *  vertically, so every line meets the node square-on. */
function path(x: number): string {
  const midY = (TOP + CY) / 2;
  return `M ${x} ${TOP} C ${x} ${midY}, ${CX} ${midY}, ${CX} ${CY}`;
}

export function Convergence() {
  const ref = useRef<SVGSVGElement>(null);
  const [on, setOn] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setOn(true);
      return;
    }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setOn(true);
          io.disconnect();
        }
      },
      { threshold: 0.35 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <svg
      ref={ref}
      viewBox={`0 0 ${W} ${H}`}
      className="convergence"
      role="img"
      aria-label="Seven wrong answers across three concepts converging on a single misconception."
      data-on={on}
    >
      <defs>
        <linearGradient id="cv-line" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--red)" stopOpacity="0.75" />
          <stop offset="100%" stopColor="var(--amber)" stopOpacity="0.95" />
        </linearGradient>
        <radialGradient id="cv-halo">
          <stop offset="0%" stopColor="var(--amber)" stopOpacity="0.55" />
          <stop offset="100%" stopColor="var(--amber)" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* the seven paths */}
      {SOURCES.map((s, i) => (
        <path
          key={s.label}
          d={path(s.x)}
          fill="none"
          stroke="url(#cv-line)"
          strokeWidth="1.5"
          strokeLinecap="round"
          className="cv-path"
          style={{ ['--i' as string]: i }}
        />
      ))}

      {/* the mistakes */}
      {SOURCES.map((s, i) => (
        <g key={`n-${s.label}`} className="cv-src" style={{ ['--i' as string]: i }}>
          <circle cx={s.x} cy={TOP} r="4.5" fill="var(--red)" />
          <circle cx={s.x} cy={TOP} r="9" fill="var(--red)" opacity="0.16" />
          <text x={s.x} y={TOP - 20} textAnchor="middle" className="cv-label">
            {s.label}
          </text>
        </g>
      ))}

      {/* the cause */}
      <g className="cv-cause">
        <circle cx={CX} cy={CY} r="34" fill="url(#cv-halo)" />
        <circle cx={CX} cy={CY} r="7" fill="var(--amber)" />
        <circle cx={CX} cy={CY} r="13" fill="none" stroke="var(--amber)" strokeWidth="1" opacity="0.45" />
      </g>
    </svg>
  );
}
