import { useMemo } from 'react';
import type { CompiledExpression, IntuitionSpec } from '@zynth/shared';
import { compileExpression } from '@zynth/shared';

/**
 * The Intuition visual: an SVG that redraws as the student drags one slider.
 *
 * Expressions are compiled ONCE per spec (compileExpression → a small RPN
 * program) and then evaluated ~240 times per curve per frame. The evaluator runs
 * at roughly 9M evaluations/second, so a three-curve scene costs well under a
 * millisecond per frame and this needs no memo-per-frame gymnastics.
 *
 * A deliberate colour decision: the reveal draws reality in CYAN and the
 * student's prediction in VIOLET, never in red/green. Red/amber/green mean
 * mastery everywhere in this product — borrowing them for "wrong answer" would
 * make the graph's colours ambiguous, which is the one thing Zynth cannot
 * afford. Correctness is carried by the dashed-vs-solid stroke and the label.
 */

const VIEW_W = 640;
const VIEW_H = 340;
const PAD_L = 44;
const PAD_R = 18;
const PAD_T = 18;
const PAD_B = 34;
const SAMPLES = 240;

const PLOT_W = VIEW_W - PAD_L - PAD_R;
const PLOT_H = VIEW_H - PAD_T - PAD_B;

export type CurveTone = 'primary' | 'secondary' | 'truth' | 'prediction';

const TONE: Record<CurveTone, { stroke: string; width: number; dash?: string; opacity: number }> = {
  primary: { stroke: 'var(--accent-cyan)', width: 2.6, opacity: 1 },
  secondary: { stroke: 'var(--text-muted)', width: 1.6, dash: '5 5', opacity: 0.75 },
  truth: { stroke: 'var(--accent-cyan)', width: 3, opacity: 1 },
  prediction: { stroke: 'var(--accent-violet)', width: 2.2, dash: '7 5', opacity: 0.95 },
};

export interface PlottedCurve {
  id: string;
  label: string;
  expr: string;
  tone: CurveTone;
}

/**
 * Builds an SVG path, breaking the line wherever the function is undefined
 * (asymptotes, sqrt of a negative, overflow). Without the break, a single
 * `L` command would draw a straight line straight through an asymptote — a
 * completely fictitious segment that reads as part of the curve.
 */
function buildPath(
  compiled: CompiledExpression,
  t: number,
  domain: readonly [number, number],
  range: readonly [number, number],
): string {
  const [x0, x1] = domain;
  const [y0, y1] = range;
  const xSpan = x1 - x0;
  const ySpan = y1 - y0 || 1;

  let d = '';
  let penDown = false;

  for (let i = 0; i <= SAMPLES; i += 1) {
    const x = x0 + (xSpan * i) / SAMPLES;
    const y = compiled.evaluate(x, t);

    if (!Number.isFinite(y)) {
      penDown = false;
      continue;
    }

    const px = PAD_L + (PLOT_W * (x - x0)) / xSpan;
    const py = PAD_T + PLOT_H * (1 - (y - y0) / ySpan);

    // Values far outside the frame are still emitted (the clip path handles
    // them) but absurd magnitudes are dropped so the path data stays sane.
    if (Math.abs(py) > 1e5) {
      penDown = false;
      continue;
    }

    d += `${penDown ? 'L' : 'M'}${px.toFixed(2)} ${py.toFixed(2)} `;
    penDown = true;
  }

  return d.trim();
}

/** Nice-ish tick values across a span — 5 ticks, rounded for legibility. */
function ticks(from: number, to: number, count = 5): number[] {
  const out: number[] = [];
  for (let i = 0; i <= count; i += 1) {
    out.push(from + ((to - from) * i) / count);
  }
  return out;
}

function formatTick(v: number): string {
  if (Math.abs(v) >= 1000) return v.toExponential(0);
  if (Number.isInteger(v)) return String(v);
  return v.toFixed(Math.abs(v) < 1 ? 2 : 1);
}

interface CurvesVisualProps {
  spec: IntuitionSpec;
  t: number;
  curves: PlottedCurve[];
}

function CurvesVisual({ spec, t, curves }: CurvesVisualProps) {
  // One compile per unique expression, not per frame.
  const compiled = useMemo(() => {
    const map = new Map<string, CompiledExpression>();
    for (const c of curves) {
      if (map.has(c.expr)) continue;
      const fn = compileExpression(c.expr, ['x', 't']);
      if (fn) map.set(c.expr, fn);
    }
    return map;
  }, [curves]);

  const xTicks = ticks(spec.domain[0], spec.domain[1]);
  const yTicks = ticks(spec.range[0], spec.range[1]);

  const xAt = (x: number) => PAD_L + (PLOT_W * (x - spec.domain[0])) / (spec.domain[1] - spec.domain[0]);
  const yAt = (y: number) => PAD_T + PLOT_H * (1 - (y - spec.range[0]) / (spec.range[1] - spec.range[0] || 1));

  // Draw the zero lines only when zero is actually inside the frame.
  const zeroY = spec.range[0] < 0 && spec.range[1] > 0 ? yAt(0) : null;
  const zeroX = spec.domain[0] < 0 && spec.domain[1] > 0 ? xAt(0) : null;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      className="iv-svg"
      role="img"
      aria-label={`${spec.title}: ${spec.caption}`}
    >
      <defs>
        <clipPath id="iv-clip">
          <rect x={PAD_L} y={PAD_T} width={PLOT_W} height={PLOT_H} />
        </clipPath>
      </defs>

      {/* Grid */}
      <g aria-hidden>
        {xTicks.map((v) => (
          <line
            key={`gx${v}`}
            x1={xAt(v)}
            y1={PAD_T}
            x2={xAt(v)}
            y2={PAD_T + PLOT_H}
            stroke="var(--border-glass)"
            strokeWidth={1}
          />
        ))}
        {yTicks.map((v) => (
          <line
            key={`gy${v}`}
            x1={PAD_L}
            y1={yAt(v)}
            x2={PAD_L + PLOT_W}
            y2={yAt(v)}
            stroke="var(--border-glass)"
            strokeWidth={1}
          />
        ))}
        {zeroY !== null && (
          <line x1={PAD_L} y1={zeroY} x2={PAD_L + PLOT_W} y2={zeroY} stroke="var(--border-glass-hover)" strokeWidth={1.5} />
        )}
        {zeroX !== null && (
          <line x1={zeroX} y1={PAD_T} x2={zeroX} y2={PAD_T + PLOT_H} stroke="var(--border-glass-hover)" strokeWidth={1.5} />
        )}
      </g>

      {/* Tick labels */}
      <g aria-hidden className="iv-tick">
        {xTicks.map((v) => (
          <text key={`tx${v}`} x={xAt(v)} y={VIEW_H - 12} textAnchor="middle">
            {formatTick(v)}
          </text>
        ))}
        {yTicks.map((v) => (
          <text key={`ty${v}`} x={PAD_L - 8} y={yAt(v) + 3.5} textAnchor="end">
            {formatTick(v)}
          </text>
        ))}
      </g>

      {/* Curves — secondary first so the primary always sits on top. */}
      <g clipPath="url(#iv-clip)">
        {[...curves]
          .sort((a, b) => (a.tone === 'secondary' ? -1 : b.tone === 'secondary' ? 1 : 0))
          .map((c) => {
            const fn = compiled.get(c.expr);
            if (!fn) return null;
            const tone = TONE[c.tone];
            return (
              <path
                key={`${c.id}-${c.tone}`}
                d={buildPath(fn, t, spec.domain, spec.range)}
                fill="none"
                stroke={tone.stroke}
                strokeWidth={tone.width}
                strokeDasharray={tone.dash}
                strokeLinecap="round"
                opacity={tone.opacity}
                className="iv-path"
              />
            );
          })}
      </g>
    </svg>
  );
}

interface StagesVisualProps {
  spec: IntuitionSpec;
  t: number;
  /** When set, the stage the student predicted — outlined alongside the active one. */
  predictedStageId?: string | null;
}

/**
 * The `stages` visual: an ordered process, one stage lit as the slider advances.
 * For concepts that are a sequence rather than a function, where a plot would be
 * a lie.
 */
function StagesVisual({ spec, t, predictedStageId }: StagesVisualProps) {
  const activeIndex = Math.max(0, Math.min(spec.stages.length - 1, Math.round(t)));

  return (
    <div className="iv-stages" role="img" aria-label={`${spec.title}: stage ${activeIndex + 1} of ${spec.stages.length}`}>
      {spec.stages.map((stage, i) => {
        const isActive = i === activeIndex;
        const isPredicted = predictedStageId === stage.id;
        return (
          <div key={stage.id} className="iv-stage-wrap">
            <div
              className="iv-stage"
              data-active={isActive || undefined}
              data-predicted={isPredicted || undefined}
            >
              <span className="iv-stage-num">{i + 1}</span>
              <span className="iv-stage-label">{stage.label}</span>
              {stage.detail && <span className="iv-stage-detail">{stage.detail}</span>}
            </div>
            {i < spec.stages.length - 1 && (
              <span className="iv-stage-arrow" aria-hidden>
                →
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

export interface IntuitionVisualProps {
  spec: IntuitionSpec;
  /** Current slider value. */
  t: number;
  /** Extra curves to overlay (the reveal's truth + prediction pair). */
  overlay?: PlottedCurve[];
  /** Hide the spec's own curves — used so the reveal shows only the comparison. */
  soloOverlay?: boolean;
  predictedStageId?: string | null;
}

export function IntuitionVisual({ spec, t, overlay, soloOverlay, predictedStageId }: IntuitionVisualProps) {
  if (spec.kind === 'stages') {
    return <StagesVisual spec={spec} t={t} predictedStageId={predictedStageId} />;
  }

  const base: PlottedCurve[] = soloOverlay
    ? []
    : spec.curves.map((c) => ({ id: c.id, label: c.label, expr: c.expr, tone: c.role as CurveTone }));

  return <CurvesVisual spec={spec} t={t} curves={[...base, ...(overlay ?? [])]} />;
}
