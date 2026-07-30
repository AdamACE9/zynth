import React from 'react';
import { interpolate, useCurrentFrame } from 'remotion';
import { COLORS } from './theme';

/**
 * A small constellation behind the wordmark, with one node cycling
 * red → amber → green over the card's duration.
 *
 * This is not decoration. It is the product's entire thesis playing once, in
 * silence, on the last frame the judge sees: engagement earns amber, proof earns
 * green, and there is no way to skip the middle. The other nodes hold steady so
 * the eye lands on the one that changes.
 *
 * The geometry mirrors graph/NodeMesh.tsx: an emissive core plus an additive
 * halo at roughly 2.7x the core radius. Rendered flat in SVG rather than as real
 * WebGL because a still, legible mark reads better at the end of a video than a
 * rotating 3D scene competing with the text.
 */

interface NodeSpec {
  id: string;
  x: number;
  y: number;
  r: number;
  /** Fixed colour, or null for the node that transitions. */
  color: string | null;
}

/** Positions are hand-placed to read as a constellation, not a grid. */
const NODES: NodeSpec[] = [
  { id: 'a', x: 148, y: 96, r: 7, color: COLORS.green },
  { id: 'b', x: 292, y: 42, r: 5.5, color: COLORS.red },
  { id: 'hero', x: 226, y: 158, r: 11, color: null },
  { id: 'c', x: 70, y: 208, r: 6, color: COLORS.amber },
  { id: 'd', x: 352, y: 196, r: 6.5, color: COLORS.green },
  { id: 'e', x: 178, y: 268, r: 5, color: COLORS.red },
  { id: 'f', x: 320, y: 300, r: 6, color: COLORS.green },
];

const EDGES: Array<[string, string]> = [
  ['a', 'hero'],
  ['b', 'hero'],
  ['hero', 'c'],
  ['hero', 'd'],
  ['hero', 'e'],
  ['d', 'f'],
  ['e', 'f'],
  ['a', 'c'],
];

const byId = (id: string) => NODES.find((n) => n.id === id) as NodeSpec;

/**
 * Blends between two hex colours. Used for the hero node's transition — a hard
 * swap would read as a glitch at 30fps, a blend reads as a state settling.
 */
function mix(from: string, to: string, t: number): string {
  const parse = (hex: string) => [
    parseInt(hex.slice(1, 3), 16),
    parseInt(hex.slice(3, 5), 16),
    parseInt(hex.slice(5, 7), 16),
  ];
  const [r1, g1, b1] = parse(from);
  const [r2, g2, b2] = parse(to);
  const c = (a: number, b: number) => Math.round(a + (b - a) * t);
  return `rgb(${c(r1 as number, r2 as number)}, ${c(g1 as number, g2 as number)}, ${c(b1 as number, b2 as number)})`;
}

/** red → amber → green across the card, with a settle at each state. */
function heroColor(frame: number): string {
  // Hold red, cross to amber over ~20 frames, hold, cross to green, hold.
  if (frame < 55) return COLORS.red;
  if (frame < 75) return mix(COLORS.red, COLORS.amber, (frame - 55) / 20);
  if (frame < 125) return COLORS.amber;
  if (frame < 145) return mix(COLORS.amber, COLORS.green, (frame - 125) / 20);
  return COLORS.green;
}

export const Constellation: React.FC<{ opacity: number }> = ({ opacity }) => {
  const frame = useCurrentFrame();
  const hero = heroColor(frame);

  // A single slow breath, so the mark is alive without drawing attention from
  // the wordmark beside it.
  const breath = 1 + Math.sin(frame / 38) * 0.022;

  return (
    <svg
      width={520}
      height={430}
      viewBox="0 0 420 350"
      style={{ opacity, transform: `scale(${breath})`, overflow: 'visible' }}
    >
      <defs>
        {NODES.map((n) => {
          const c = n.color ?? hero;
          return (
            <radialGradient key={`halo-${n.id}`} id={`halo-${n.id}`}>
              <stop offset="0%" stopColor={c} stopOpacity={0.55} />
              <stop offset="45%" stopColor={c} stopOpacity={0.16} />
              <stop offset="100%" stopColor={c} stopOpacity={0} />
            </radialGradient>
          );
        })}
      </defs>

      {/* Edges first so nodes always sit on top of them. */}
      <g>
        {EDGES.map(([a, b]) => {
          const na = byId(a);
          const nb = byId(b);
          // The hero's own edges pick up its current colour, so the transition
          // propagates outward instead of being confined to one dot.
          const touchesHero = a === 'hero' || b === 'hero';
          return (
            <line
              key={`${a}-${b}`}
              x1={na.x}
              y1={na.y}
              x2={nb.x}
              y2={nb.y}
              stroke={touchesHero ? hero : COLORS.accentViolet}
              strokeOpacity={touchesHero ? 0.42 : 0.2}
              strokeWidth={touchesHero ? 1.6 : 1.1}
            />
          );
        })}
      </g>

      <g>
        {NODES.map((n, i) => {
          const c = n.color ?? hero;
          // Staggered entrance, same 24px-and-settle language as the app.
          const appear = interpolate(frame, [6 + i * 4, 26 + i * 4], [0, 1], {
            extrapolateLeft: 'clamp',
            extrapolateRight: 'clamp',
          });
          return (
            <g key={n.id} opacity={appear}>
              <circle cx={n.x} cy={n.y} r={n.r * 2.7} fill={`url(#halo-${n.id})`} />
              <circle cx={n.x} cy={n.y} r={n.r} fill={c} />
              <circle cx={n.x} cy={n.y} r={n.r} fill="#fff" fillOpacity={0.28} />
            </g>
          );
        })}
      </g>
    </svg>
  );
};
