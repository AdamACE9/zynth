/**
 * Live Co-Pilot diagnosis: the ONE Gemini call in this feature, plus the
 * server-side validators that stand between whatever the model says and an
 * actual `copilot:insight` reaching the student.
 *
 * This module is intentionally dumb about WHY it was called — copilotService
 * owns gates/suppressors/patterns/confidence (the decision to attempt a
 * diagnosis at all) and passes in only machine-verified facts plus the
 * numeric thresholds to validate against (COPILOT.DIAGNOSIS / COPILOT.VALIDATORS
 * from copilotService.ts, passed as `opts` rather than imported directly —
 * copilotService already imports FROM this module, so importing back would
 * create a cycle; passing the numbers in keeps COPILOT the single source of
 * truth without it).
 *
 * Bulletproof by design, same as every other agent call in this codebase:
 * STUB_MODE, a missing/failed Gemini call, a timeout, or malformed JSON all
 * resolve to "no diagnosis" rather than throwing — the Live Co-Pilot simply
 * stays silent, which the spec explicitly calls out as a valued, correct
 * outcome, not a failure.
 */
import { GoogleGenAI } from '@google/genai';
import type { ErrorType, Status } from '@zynth/shared';
import { config, STUB_MODE } from '../config';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

// ---------------------------------------------------------------------------
// Input shape — ONLY machine-verified facts, per the spec.
// ---------------------------------------------------------------------------

export interface DiagnosisNodeFacts {
  id: string;
  label: string;
  subject: string;
  status: Status;
  mastery_score: number;
  retest_count: number;
}

export interface DiagnosisEvidenceQuestion {
  prompt: string;
  choices?: string[];
  correct_answer: string;
  given_answer: string;
  chosen_choice_tag?: string;
  latency_ms?: number;
  explanation?: string;
}

export interface DiagnosisCorrectAnswer {
  prompt: string;
  given_answer: string;
}

export interface DiagnosisPriorMistake {
  raw_excerpt: string;
  error_type: ErrorType;
  source: string;
  created_at: string;
}

export interface DiagnosisCorrelatedNode {
  id: string;
  label: string;
  status: Status;
}

export type DiagnosisPattern = 'repeated_failure_same_node' | 'correlated_cross_node' | 'documented_recurrence';

export interface DiagnosisInput {
  node: DiagnosisNodeFacts;
  evidence_questions: DiagnosisEvidenceQuestion[];
  /** REQUIRED even when empty — without it the model over-claims total ignorance. */
  answered_correctly_on_this_node: DiagnosisCorrectAnswer[];
  /** Max 5, all predating the session. */
  prior_mistakes: DiagnosisPriorMistake[];
  correlated_nodes?: DiagnosisCorrelatedNode[];
  trigger_confidence: number;
  pattern: DiagnosisPattern;
}

export interface DiagnosisValidatorOptions {
  timeoutMs: number;
  minQuoteLen: number;
  minModelConfidence: number;
  minDiagnosisLen: number;
  maxHeadlineLen: number;
  maxDiagnosisLen: number;
  maxEvidenceItems: number;
}

export interface DiagnosisSuccess {
  headline: string;
  diagnosis: string;
  evidence: string[];
  error_type: ErrorType;
  confidence: number;
  suggested_action: 'war_room' | 'explain' | 'none';
}

export type DiagnosisDropReason =
  | 'no_response' // Gemini call failed, timed out, or returned unusable JSON
  | 'v1_no_grounded_evidence'
  | 'v2_careless_slip'
  | 'v3_low_model_confidence'
  | 'v4_diagnosis_quality';

export type DiagnosisOutcome =
  | { ok: true; result: DiagnosisSuccess }
  | { ok: false; reason: DiagnosisDropReason; result?: DiagnosisSuccess };

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

const DIAGNOSIS_SCHEMA = {
  type: 'object',
  properties: {
    headline: { type: 'string' },
    diagnosis: { type: 'string' },
    evidence: { type: 'array', items: { type: 'string' } },
    error_type: { type: 'string' },
    confidence: { type: 'number' },
    suggested_action: { type: 'string' },
  },
  required: ['headline', 'diagnosis', 'evidence', 'error_type', 'confidence'],
} as const;

const ERROR_TYPES: readonly ErrorType[] = ['concept_gap', 'careless_slip', 'prerequisite_gap'];
const SUGGESTED_ACTIONS = ['war_room', 'explain', 'none'] as const;

function isErrorType(v: unknown): v is ErrorType {
  return typeof v === 'string' && (ERROR_TYPES as readonly string[]).includes(v);
}

function isSuggestedAction(v: unknown): v is DiagnosisSuccess['suggested_action'] {
  return typeof v === 'string' && (SUGGESTED_ACTIONS as readonly string[]).includes(v);
}

interface RawDiagnosis {
  headline: string;
  diagnosis: string;
  evidence: string[];
  error_type: ErrorType;
  confidence: number;
  suggested_action: DiagnosisSuccess['suggested_action'];
}

function validateRawShape(parsed: unknown): RawDiagnosis | null {
  if (!parsed || typeof parsed !== 'object') return null;
  const p = parsed as Record<string, unknown>;
  if (typeof p.headline !== 'string' || !p.headline.trim()) return null;
  if (typeof p.diagnosis !== 'string' || !p.diagnosis.trim()) return null;
  if (!Array.isArray(p.evidence) || !p.evidence.every((e) => typeof e === 'string')) return null;
  if (!isErrorType(p.error_type)) return null;
  if (typeof p.confidence !== 'number' || !Number.isFinite(p.confidence)) return null;
  return {
    headline: p.headline.trim(),
    diagnosis: p.diagnosis.trim(),
    evidence: (p.evidence as string[]).map((e) => e.trim()).filter((e) => e.length > 0),
    error_type: p.error_type,
    confidence: Math.max(0, Math.min(1, p.confidence)),
    suggested_action: isSuggestedAction(p.suggested_action) ? p.suggested_action : 'none',
  };
}

function buildPrompt(input: DiagnosisInput): string {
  return `You are Zynth's Live Co-Pilot: an unprompted, mid-quiz diagnostic tutor. You speak ONLY when you have identified a REAL misconception grounded in verbatim evidence below — false positives erode trust, so staying silent (by returning error_type "careless_slip" with confidence below 0.5) is a valued, CORRECT answer whenever the wrong answers share no identifiable structure. Do not manufacture a pattern that isn't there.

DETECTION CONTEXT (already statistically gated before you were called — trust it, but ground your own reasoning in the evidence, not this number):
pattern = ${input.pattern}, trigger_confidence = ${input.trigger_confidence.toFixed(2)}

CONCEPT NODE:
${JSON.stringify(input.node)}

WRONG ANSWERS USED AS EVIDENCE (you must quote from these verbatim in your "evidence" array):
${JSON.stringify(input.evidence_questions)}

ANSWERED CORRECTLY ON THIS NODE THIS SESSION (use this to tell "doesn't know the rule" apart from "knows the rule, slipped here" — if this list is non-empty, do NOT claim total ignorance of the concept):
${JSON.stringify(input.answered_correctly_on_this_node)}

PRIOR RECORDED MISTAKES ON THIS NODE (from before this session, at most 5):
${JSON.stringify(input.prior_mistakes)}
${input.correlated_nodes && input.correlated_nodes.length > 0 ? `\nOTHER CONCEPTS ALSO FAILING THIS SESSION (for a cross-node pattern):\n${JSON.stringify(input.correlated_nodes)}\n` : ''}
Return JSON with:
- "headline": one line, <=60 characters, e.g. "This isn't an arithmetic slip."
- "diagnosis": 2-3 sentences, <=320 characters. Explain the MECHANISM of the misconception (what the student is actually doing wrong and why it produces these specific answers) — do not just restate the correct answer, and never say "you always" or "you never".
- "evidence": 1 to 3 short strings. EVERY one must quote the student's own answer, a distractor they picked, or a prior record VERBATIM — do not paraphrase.
- "error_type": one of "concept_gap" (the rule itself is wrong in their head), "careless_slip" (they know the rule, executed it wrong this time — check the "answered correctly" list above before choosing this), "prerequisite_gap" (missing an earlier concept this depends on).
- "confidence": 0 to 1, YOUR OWN confidence that this is a genuine, evidence-backed misconception (not a copy of trigger_confidence above).
- "suggested_action": one of "war_room", "explain", "none".

If the wrong answers do not share a clear, nameable structure, you MUST return error_type "careless_slip" with confidence below 0.5 rather than invent a misconception.`;
}

async function callGeminiWithTimeout(input: DiagnosisInput, timeoutMs: number): Promise<RawDiagnosis | null> {
  if (STUB_MODE || !ai) return null;

  const call = (async (): Promise<RawDiagnosis | null> => {
    try {
      const res = await ai.models.generateContent({
        model: config.geminiModel,
        contents: buildPrompt(input),
        config: {
          responseMimeType: 'application/json',
          responseSchema: DIAGNOSIS_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 512,
          temperature: 0.2,
        },
      });
      const text = res.text;
      if (!text) return null;
      return validateRawShape(JSON.parse(text));
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[copilotDiagnosis] Gemini call failed:', err);
      return null;
    }
  })();

  // "6s timeout, dropped silently on timeout" — the in-flight call is simply
  // ignored if it resolves after the timeout wins; no side effects either way.
  const timeout = new Promise<null>((resolve) => {
    setTimeout(() => resolve(null), timeoutMs);
  });

  return Promise.race([call, timeout]);
}

// ---------------------------------------------------------------------------
// Validators (V1-V5) — "the teeth". Run in order; the first failure drops the
// card. A drop never throws — it's expressed as a `{ ok: false }` outcome.
// ---------------------------------------------------------------------------

function collectSourceTexts(input: DiagnosisInput): string[] {
  const texts: string[] = [];
  for (const q of input.evidence_questions) {
    texts.push(q.given_answer);
    if (q.choices) texts.push(...q.choices);
  }
  for (const m of input.prior_mistakes) texts.push(m.raw_excerpt);
  return texts.filter((t) => typeof t === 'string' && t.trim().length > 0);
}

/** True iff `evidence` contains, verbatim (case-insensitive), some >=minLen-char run from one of `sourceTexts`. */
function isGrounded(evidence: string, sourceTexts: string[], minLen: number): boolean {
  const evLower = evidence.toLowerCase();
  for (const src of sourceTexts) {
    const srcLower = src.toLowerCase();
    for (let i = 0; i + minLen <= srcLower.length; i += 1) {
      if (evLower.includes(srcLower.slice(i, i + minLen))) return true;
    }
  }
  return false;
}

function clampText(text: string, maxLen: number): string {
  return text.length <= maxLen ? text : `${text.slice(0, Math.max(0, maxLen - 1)).trimEnd()}…`;
}

function normalize(raw: RawDiagnosis, groundedEvidence: string[], opts: DiagnosisValidatorOptions): DiagnosisSuccess {
  return {
    headline: clampText(raw.headline, opts.maxHeadlineLen),
    diagnosis: clampText(raw.diagnosis, opts.maxDiagnosisLen),
    evidence: groundedEvidence.slice(0, opts.maxEvidenceItems),
    error_type: raw.error_type,
    confidence: raw.confidence,
    suggested_action: raw.suggested_action,
  };
}

/** V4: length floor, not a restatement of the answer/explanation, no "you always/never". */
function failsQualityCheck(raw: RawDiagnosis, input: DiagnosisInput, minLen: number): boolean {
  if (raw.diagnosis.length < minLen) return true;
  const diagLower = raw.diagnosis.toLowerCase();
  const isRestatement = input.evidence_questions.some((q) => {
    const answerLower = q.correct_answer.toLowerCase();
    const explanationLower = q.explanation?.toLowerCase();
    return answerLower.includes(diagLower) || (!!explanationLower && explanationLower.includes(diagLower));
  });
  if (isRestatement) return true;
  if (/you (always|never)/i.test(raw.diagnosis)) return true;
  return false;
}

/**
 * The single entry point: calls Gemini (timeboxed), then runs V1-V5. Never
 * throws. `opts` carries every tunable number from copilotService's COPILOT
 * object so this module has zero hardcoded thresholds of its own.
 */
export async function diagnoseAndValidate(
  input: DiagnosisInput,
  opts: DiagnosisValidatorOptions,
): Promise<DiagnosisOutcome> {
  const raw = await callGeminiWithTimeout(input, opts.timeoutMs);
  if (!raw) {
    return { ok: false, reason: 'no_response' };
  }

  // V1: strip ungrounded evidence items; 0 survivors -> DROP.
  const sourceTexts = collectSourceTexts(input);
  const grounded = raw.evidence.filter((e) => isGrounded(e, sourceTexts, opts.minQuoteLen));
  if (grounded.length === 0) {
    return { ok: false, reason: 'v1_no_grounded_evidence' };
  }

  // V2: careless_slip -> DROP, but the caller still needs error_type to log a MistakeRecord.
  if (raw.error_type === 'careless_slip') {
    return { ok: false, reason: 'v2_careless_slip', result: normalize(raw, grounded, opts) };
  }

  // V3: model's own confidence too low -> DROP.
  if (raw.confidence < opts.minModelConfidence) {
    return { ok: false, reason: 'v3_low_model_confidence' };
  }

  // V4: diagnosis quality -> DROP.
  if (failsQualityCheck(raw, input, opts.minDiagnosisLen)) {
    return { ok: false, reason: 'v4_diagnosis_quality' };
  }

  // V5: clamp lengths on the way out.
  return { ok: true, result: normalize(raw, grounded, opts) };
}
