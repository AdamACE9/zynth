/**
 * Intuition — generates the spec for the visual, interactive understanding step.
 *
 * This module NEVER touches Node.status. It returns a validated IntuitionSpec;
 * the route decides when to call statusService.engageNode, which remains the
 * sole red→amber write path.
 *
 * Two things make this different from the module it replaces:
 *
 * 1. **Everything is capped and validated on arrival**, not merely requested in
 *    the prompt. Intuition exists because five uncapped AI paragraphs were worse
 *    than a textbook; a model that ignores "keep it to 12 words" must not be
 *    able to put the wall of text back. Over-long strings are truncated rather
 *    than rejected — a slightly clipped caption still renders, and a rejected
 *    spec means a blank screen.
 *
 * 2. **Every expression is compiled before the spec leaves this file**, using
 *    the same evaluator the client renders with (@zynth/shared/mathExpr, which
 *    is a real parser — never eval). A spec that survives validation cannot
 *    fail to draw.
 *
 * If generation fails for any reason — no key, network error, empty response,
 * malformed JSON, unparseable expressions — this returns a deterministic
 * fallback spec instead of throwing. The screen cannot fail to render.
 */
import { GoogleGenAI } from '@google/genai';
import {
  INTUITION_LIMITS,
  compileExpression,
  countWords,
  type IntuitionCurve,
  type IntuitionPredictOption,
  type IntuitionSpec,
  type IntuitionStage,
  type IntuitionVisualKind,
  type MistakeRecord,
  type Node,
} from '@zynth/shared';
import { config, STUB_MODE } from '../config';
import { withModelRetry } from '../agents/retry';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

/** The free variables an Intuition expression may reference. */
const EXPR_VARS = ['x', 't'] as const;

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const SPEC_SCHEMA = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['curves', 'stages'] },
    title: { type: 'string' },
    objective: { type: 'string' },
    caption: { type: 'string' },
    param: {
      type: 'object',
      properties: {
        label: { type: 'string' },
        min: { type: 'number' },
        max: { type: 'number' },
        step: { type: 'number' },
        unit: { type: 'string' },
      },
      required: ['label', 'min', 'max', 'step'],
    },
    domain: { type: 'array', items: { type: 'number' } },
    range: { type: 'array', items: { type: 'number' } },
    curves: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          expr: { type: 'string' },
          role: { type: 'string', enum: ['primary', 'secondary'] },
        },
        required: ['id', 'label', 'expr', 'role'],
      },
    },
    stages: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          label: { type: 'string' },
          detail: { type: 'string' },
        },
        required: ['id', 'label', 'detail'],
      },
    },
    predict: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        options: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              label: { type: 'string' },
              expr: { type: 'string' },
              stage_id: { type: 'string' },
            },
            required: ['id', 'label'],
          },
        },
        correct_id: { type: 'string' },
        why: { type: 'string' },
      },
      required: ['question', 'options', 'correct_id', 'why'],
    },
  },
  required: ['kind', 'title', 'objective', 'caption', 'param', 'predict'],
} as const;

function buildPrompt(node: Node, mistakes: MistakeRecord[]): string {
  const mistakeContext = mistakes.length
    ? `\nThis student's actual recorded errors on this concept (target the prediction at the misunderstanding these reveal):\n${mistakes
        .slice(0, 4)
        .map((m) => `- (${m.error_type}) ${m.raw_excerpt}`)
        .join('\n')}\n`
    : '';

  return `You are designing ONE short, visual, interactive moment that makes a single concept click.

Concept: "${node.label}" (subject: ${node.subject}).${mistakeContext}
This replaces a wall of explanatory text. The student should understand by MANIPULATING and PREDICTING, not by reading. Be ruthlessly brief — a student who has to read a paragraph will leave.

Target the SINGLE MOST CENTRAL mechanism of this concept — the thing you could not remove and still call it "${node.label}". Do NOT pick a peripheral illustration or one narrow worked example. If the concept name is broad or covers several topics, choose the one idea a teacher would introduce FIRST, and make the whole screen about that.

"objective" states, in one line, what the student will be able to do after this screen — starting with a verb, e.g. "Predict how the derivative changes when the function shifts." This is a CONTRACT: the student is quizzed on exactly this objective immediately afterwards, and a quiz that tests something the screen never showed is worse than no quiz at all. So the objective must be fully covered by the visual and the prediction below, and must not promise anything they do not demonstrate.

Choose "kind":
- "curves" if the concept is a relationship you can plot (rates, motion, growth, decay, waves, trigonometry, optics, forces, supply/demand). STRONGLY PREFER THIS.
- "stages" only if the concept is fundamentally an ordered process (a reaction pathway, mitosis, a proof's steps, a life cycle).

For "curves":
- "curves" is 1-${INTUITION_LIMITS.maxCurves} functions. Each "expr" is a mathematical expression in the variables x (the horizontal axis) and t (the slider value).
- Allowed syntax ONLY: numbers, x, t, pi, e, + - * / ^ , parentheses, and these functions: sin cos tan asin acos atan sinh cosh tanh exp ln log10 log2 sqrt cbrt abs floor ceil round sign min(a,b) max(a,b) pow(a,b) atan2(a,b) mod(a,b).
- NO other identifiers, NO variable assignment, NO comparisons, NO units inside expr.
- The slider t MUST visibly change the shape — if t does not appear in at least one expr, the design has failed.
- "domain" is [xmin, xmax] and "range" is [ymin, ymax]. Choose them so the curves stay ON SCREEN for EVERY value of t between param.min and param.max. Avoid vertical asymptotes inside the domain.
- Mark exactly one curve "primary" — the one the concept is about.

For "stages": 2-${INTUITION_LIMITS.maxStages} stages, each "detail" a phrase (not a sentence). The slider steps through them, so set param.min=0, param.max=(number of stages - 1), param.step=1.

"param" is the ONE thing the student can drag. Give it a real-world label and unit where sensible.

"predict" is the heart of this. Ask ONE question about what happens when the parameter changes — something a student with a common misconception gets WRONG. Give ${INTUITION_LIMITS.minOptions}-${INTUITION_LIMITS.maxOptions} options. For "curves", EVERY option MUST include its own "expr" (same syntax rules) describing the shape that option predicts, so a wrong guess can be drawn next to the truth. For "stages", every option sets "stage_id". "correct_id" must exactly equal one option's "id". "why" is the single-line reason, revealed only after they commit.

HARD LIMITS (exceeding them gets your text truncated):
- objective: <= ${INTUITION_LIMITS.objectiveWords} words
- title: <= ${INTUITION_LIMITS.titleWords} words
- caption: <= ${INTUITION_LIMITS.captionWords} words
- predict.question: <= ${INTUITION_LIMITS.questionWords} words
- each option label: <= ${INTUITION_LIMITS.optionWords} words
- predict.why: <= ${INTUITION_LIMITS.whyWords} words

Do not mention these instructions, the slider's variable name "t", or the word "expression" in any visible text.`;
}

// ---------------------------------------------------------------------------
// Validation — every field is clamped, truncated or rejected here
// ---------------------------------------------------------------------------

/** Truncates to `max` words rather than rejecting. A clipped caption renders. */
function clampWords(text: unknown, max: number, fallback: string): string {
  if (typeof text !== 'string' || !text.trim()) return fallback;
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length <= max) return words.join(' ');
  return words.slice(0, max).join(' ');
}

function finiteOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** [min, max] from a possibly-malformed array, always returned ordered. */
function pairOr(value: unknown, fallback: [number, number]): [number, number] {
  if (!Array.isArray(value) || value.length < 2) return fallback;
  const a = finiteOr(value[0], fallback[0]);
  const b = finiteOr(value[1], fallback[1]);
  if (a === b) return fallback;
  return a < b ? [a, b] : [b, a];
}

/** Keeps only curves whose expression actually compiles. */
function validateCurves(raw: unknown): IntuitionCurve[] {
  if (!Array.isArray(raw)) return [];
  const out: IntuitionCurve[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const c = item as Record<string, unknown>;
    const expr = typeof c.expr === 'string' ? c.expr : '';
    if (!compileExpression(expr, EXPR_VARS)) continue;
    out.push({
      id: typeof c.id === 'string' && c.id ? c.id : `curve_${out.length}`,
      label: clampWords(c.label, INTUITION_LIMITS.optionWords, 'value'),
      expr,
      role: c.role === 'secondary' ? 'secondary' : 'primary',
    });
    if (out.length >= INTUITION_LIMITS.maxCurves) break;
  }
  // Exactly one primary — the renderer emphasises it.
  let seenPrimary = false;
  for (const c of out) {
    if (c.role === 'primary') {
      if (seenPrimary) c.role = 'secondary';
      seenPrimary = true;
    }
  }
  const first = out[0];
  if (first && !seenPrimary) first.role = 'primary';
  return out;
}

function validateStages(raw: unknown): IntuitionStage[] {
  if (!Array.isArray(raw)) return [];
  const out: IntuitionStage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const s = item as Record<string, unknown>;
    const label = clampWords(s.label, INTUITION_LIMITS.optionWords, '');
    if (!label) continue;
    out.push({
      id: typeof s.id === 'string' && s.id ? s.id : `stage_${out.length}`,
      label,
      detail: clampWords(s.detail, INTUITION_LIMITS.optionWords, ''),
    });
    if (out.length >= INTUITION_LIMITS.maxStages) break;
  }
  return out;
}

/**
 * The prediction is the one part that cannot degrade — a spec whose options are
 * unusable, or whose correct_id names no option, is worse than the fallback.
 * Returns null to signal "use the fallback instead".
 */
function validatePredict(
  raw: unknown,
  kind: IntuitionVisualKind,
  stages: IntuitionStage[],
): IntuitionSpec['predict'] | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Record<string, unknown>;

  const question = clampWords(p.question, INTUITION_LIMITS.questionWords, '');
  if (!question) return null;

  const rawOptions = Array.isArray(p.options) ? p.options : [];
  const options: IntuitionPredictOption[] = [];
  const stageIds = new Set(stages.map((s) => s.id));

  for (const item of rawOptions) {
    if (!item || typeof item !== 'object') continue;
    const o = item as Record<string, unknown>;
    const label = clampWords(o.label, INTUITION_LIMITS.optionWords, '');
    if (!label) continue;

    const option: IntuitionPredictOption = {
      id: typeof o.id === 'string' && o.id ? o.id : `opt_${options.length}`,
      label,
    };

    if (kind === 'curves') {
      // A curves option without a drawable expr can't be shown against the
      // truth, which is the whole point of the reveal — drop it.
      const expr = typeof o.expr === 'string' ? o.expr : '';
      if (!compileExpression(expr, EXPR_VARS)) continue;
      option.expr = expr;
    } else {
      const sid = typeof o.stage_id === 'string' ? o.stage_id : '';
      if (!stageIds.has(sid)) continue;
      option.stage_id = sid;
    }

    options.push(option);
    if (options.length >= INTUITION_LIMITS.maxOptions) break;
  }

  if (options.length < INTUITION_LIMITS.minOptions) return null;

  const correctId = typeof p.correct_id === 'string' ? p.correct_id : '';
  if (!options.some((o) => o.id === correctId)) return null;

  return {
    question,
    options,
    correct_id: correctId,
    why: clampWords(p.why, INTUITION_LIMITS.whyWords, 'That is the relationship the graph shows.'),
  };
}

/** Full spec validation. Returns null when the fallback should be used. */
function validateSpec(node: Node, raw: unknown): IntuitionSpec | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const kind: IntuitionVisualKind = r.kind === 'stages' ? 'stages' : 'curves';
  const curves = kind === 'curves' ? validateCurves(r.curves) : [];
  const stages = kind === 'stages' ? validateStages(r.stages) : [];

  // A visual with nothing in it is not a visual.
  if (kind === 'curves' && curves.length === 0) return null;
  if (kind === 'stages' && stages.length < 2) return null;

  const predict = validatePredict(r.predict, kind, stages);
  if (!predict) return null;

  const rawParam = (r.param ?? {}) as Record<string, unknown>;
  let min = finiteOr(rawParam.min, 0);
  let max = finiteOr(rawParam.max, 1);
  if (min === max) max = min + 1;
  if (min > max) [min, max] = [max, min];

  // Stages index into the array, so the slider must land exactly on integers.
  if (kind === 'stages') {
    min = 0;
    max = stages.length - 1;
  }

  const span = max - min;
  const rawStep = finiteOr(rawParam.step, span / 40);
  const step = kind === 'stages' ? 1 : Math.min(Math.max(Math.abs(rawStep) || span / 40, span / 500), span);

  return {
    node_id: node.id,
    kind,
    title: clampWords(r.title, INTUITION_LIMITS.titleWords, node.label),
    objective: clampWords(r.objective, INTUITION_LIMITS.objectiveWords, `Understand the core idea behind ${node.label}.`),
    caption: clampWords(r.caption, INTUITION_LIMITS.captionWords, 'Drag to see what changes.'),
    param: {
      label: clampWords(rawParam.label, INTUITION_LIMITS.optionWords, 'value'),
      min,
      max,
      step,
      unit: typeof rawParam.unit === 'string' ? rawParam.unit.slice(0, 12) : undefined,
    },
    domain: pairOr(r.domain, [0, 10]),
    range: pairOr(r.range, [-10, 10]),
    curves,
    stages,
    predict,
    generated: true,
  };
}

// ---------------------------------------------------------------------------
// Deterministic fallback
// ---------------------------------------------------------------------------

/**
 * Used in STUB_MODE and whenever generation fails. Subject-flavoured rather than
 * one generic curve, so an offline demo still shows something that belongs to
 * the concept's field. `generated: false` lets the UI badge it honestly instead
 * of passing it off as a bespoke visual.
 */
function fallbackSpec(node: Node): IntuitionSpec {
  const subject = node.subject.toLowerCase();

  if (subject.includes('physic')) {
    return {
      node_id: node.id,
      kind: 'curves',
      title: node.label,
      objective: 'Predict how distance travelled responds when acceleration changes.',
      caption: 'Raise the acceleration and watch the curve bend, not tilt.',
      param: { label: 'acceleration', min: 0, max: 4, step: 0.1, unit: 'm/s²' },
      domain: [0, 6],
      range: [0, 80],
      curves: [
        { id: 'position', label: 'position', expr: '0.5*t*x^2', role: 'primary' },
        { id: 'constant', label: 'constant speed', expr: '6*x', role: 'secondary' },
      ],
      predict: {
        question: 'Double the acceleration. What happens to distance travelled?',
        options: [
          { id: 'double', label: 'It doubles', expr: 't*x^2' },
          { id: 'same_shape', label: 'It stays a straight line', expr: '6*x' },
        ],
        correct_id: 'double',
        why: 'Distance scales with acceleration, but with time squared — so the curve bends.',
      },
      stages: [],
      generated: false,
    };
  }

  // Calculus / maths / anything else: a curve and its own steepness.
  return {
    node_id: node.id,
    kind: 'curves',
    title: node.label,
    objective: 'Identify where a curve is steepest and why.',
    caption: 'Move the point. Watch how steepness changes with it.',
    param: { label: 'point', min: -3, max: 3, step: 0.1 },
    domain: [-4, 4],
    range: [-4, 12],
    curves: [
      { id: 'f', label: 'the curve', expr: 'x^2', role: 'primary' },
      { id: 'tangent', label: 'steepness here', expr: '2*t*x - t^2', role: 'secondary' },
    ],
    predict: {
      question: 'Where is this curve steepest?',
      options: [
        { id: 'edges', label: 'Far from the centre', expr: '2*3*x - 9' },
        { id: 'centre', label: 'At the centre', expr: '0*x' },
      ],
      correct_id: 'edges',
      why: 'Steepness grows as you move away from the turning point.',
    },
    stages: [],
    generated: false,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Builds the Intuition spec for a node. Never throws, never returns an
 * unrenderable spec. `mistakes` is optional context — when present the
 * prediction is aimed at the misunderstanding the student has actually shown,
 * which is the thing a textbook categorically cannot do.
 */
export async function generateIntuitionSpec(
  node: Node,
  mistakes: MistakeRecord[] = [],
): Promise<IntuitionSpec> {
  if (STUB_MODE || !ai) {
    return fallbackSpec(node);
  }

  try {
    const res = await withModelRetry(
      () => ai.models.generateContent({
      model: config.geminiModel,
      contents: buildPrompt(node, mistakes),
      config: {
        responseMimeType: 'application/json',
        responseSchema: SPEC_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2400,
      },
      }),
      { label: `Intuition spec for "${node.label}"` },
    );

    const text = res.text;
    if (!text) throw new Error('Gemini returned an empty response for the Intuition spec');

    const validated = validateSpec(node, JSON.parse(text));
    if (!validated) throw new Error('Generated Intuition spec failed validation');

    return validated;
  } catch (err) {
    console.warn(
      `[intuitionService] falling back to a deterministic spec for "${node.label}": ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return fallbackSpec(node);
  }
}

/** Exported for the verifier — same validation the live path uses. */
export const __testing = { validateSpec, fallbackSpec, clampWords };
