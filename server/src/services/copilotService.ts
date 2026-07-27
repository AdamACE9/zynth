/**
 * Live Co-Pilot: watches a quiz in progress, question by question, and
 * (rarely, deliberately) surfaces an unprompted diagnosis when the evidence
 * clears a stack of gates, suppressors, and a confidence threshold.
 *
 * This module owns the WHOLE detection pipeline: session state, the heatmap
 * (always emitted, never suppressed), and the gates -> suppressors ->
 * patterns -> confidence-threshold decision of whether to even ATTEMPT a
 * diagnosis. The diagnosis itself (the one Gemini call + validators) lives in
 * ../agents/copilotDiagnosis.ts — this module calls it and owns what happens
 * to the result (budget/cooldown bookkeeping, the MistakeRecord write on a
 * V2 drop, the final emit).
 *
 * LOCKED RULE: this module NEVER writes Node.status or Node.mastery_score.
 * The heatmap is display-only and session-scoped; only statusService may
 * mutate a node, and only via a completed Quiz.
 *
 * State is in-memory, keyed by session_id (== the quiz_id handed back from
 * POST /quiz/generate — see quizService.registerQuizSession). There is no DB
 * table for an in-progress quiz, so this is deliberately process-lifetime
 * only; fine for a live demo, not meant to survive a restart mid-quiz.
 */
import { nanoid } from 'nanoid';
import type {
  CopilotHeatCell,
  CopilotInsight,
  ErrorType,
  MistakeRecord,
  QuizQuestion,
  Status,
} from '@zynth/shared';
import { getActiveStudentId } from '../config';
import { edgesRepo, mistakeRecordsRepo, nodesRepo } from '../db/repositories';
import { emitCopilotHeatmap, emitCopilotInsight } from '../socket';
import { lexicalOverlap } from '../agents/groqGrader';
import {
  diagnoseAndValidate,
  type DiagnosisCorrectAnswer,
  type DiagnosisCorrelatedNode,
  type DiagnosisEvidenceQuestion,
  type DiagnosisInput,
  type DiagnosisPattern,
  type DiagnosisPriorMistake,
} from '../agents/copilotDiagnosis';
import {
  buildMistakeExcerpt,
  chosenChoiceTag,
  gradeSingleQuestion,
  getQuizSession,
  type RegisteredQuizSession,
} from './quizService';

// ---------------------------------------------------------------------------
// COPILOT — every tunable number in the spec, in one place.
// ---------------------------------------------------------------------------

export const COPILOT = {
  GATES: {
    G1_MIN_ANSWERED: 3,
    G4_MAX_CARDS_PER_SESSION: 2,
    G5_MIN_ANSWERED_SINCE_LAST_CARD: 3,
  },
  SUPPRESSORS: {
    S5A_WINDOW_MAX: 6,
    S5A_MIN_ANSWERED: 4,
    S5A_FLIP_RATIO_MIN: 0.6,
    S5A_ACCURACY_LOW: 0.3,
    S5A_ACCURACY_HIGH: 0.7,
    S5B_MIN_WRONGS: 3,
    S5B_MIN_NODES: 3,
    S6_FR_OVERLAP_MIN: 0.45,
    S6_FR_LEN_MIN: 12,
    S7B_MCQ_LATENCY_MS: 3000,
    S7B_FR_LATENCY_MS: 8000,
    // S8a/b/c/d are literal re-checks of G4/G5/G6/G2 (defense in depth, per
    // spec) — they intentionally reuse these same GATES numbers rather than
    // duplicating them, so the two layers can never drift apart.
  },
  PATTERNS: {
    ALLOW_RECURRENCE_SINGLE_WRONG: true, // gates P3 entirely, per spec
    P1_RECENT_WINDOW_CAP: 3,
    P1_MIN_ELIGIBLE_WRONGS: 2,
    P2_MIN_SESSION_WRONGS: 3,
    P2_MIN_NODES: 2,
    P2_EDGE_STRENGTH_MIN: 0.5,
    P3_OVERLAP_MIN: 0.55,
  },
  CONFIDENCE: {
    THRESHOLD: 0.62,

    P1_BASE: 0.3,
    P1_PER_EXTRA_WRONG: 0.12,
    P1_PER_EXTRA_WRONG_CAP: 0.24,
    P1_C1_SHARED_TAG: 0.22,
    P1_C2_PRIOR_RECORD: 0.15,
    P1_C2B_DISTRACTOR_OVERLAP: 0.08,
    P1_C2B_MIN_OVERLAP: 0.4,
    P1_C3_GREEN_NODE: 0.22,
    P1_C5_ZERO_CORRECT: 0.18,
    P1_C4_EFFORT: 0.08,
    P1_PENALTY_ALL_FR: -0.15,
    P1_PENALTY_AMBER_LOW_MASTERY: -0.1,
    P1_PENALTY_AMBER_MASTERY_MAX: 40,
    P1_PENALTY_RECOVERY: -0.1,
    P1_PENALTY_CONTAMINATED: -0.12,

    P2_BASE: 0.32,
    P2_PER_EDGE: 0.1,
    P2_PER_EDGE_CAP: 0.2,
    P2_AUTOPSY_EDGE_BONUS: 0.12,
    P2_SHARED_ERROR_TYPE_BONUS: 0.1,
    P2_PENALTY_AMBER_LOW_MASTERY: -0.08,
    P2_PENALTY_AMBER_MASTERY_MAX: 40,

    P3_BASE: 0.36,
    P3_PRIOR_RECORD_BONUS: 0.14,
    P3_OVERLAP_BONUS: 0.16,
    P3_EARLIER_SESSION_BONUS: 0.06,
  },
  HEATMAP: {
    RHO: 0.85,
    K_GREEN: 2.0,
    K_AMBER: 1.5,
    K_RED: 1.0,
    W_MCQ_CORRECT: 1.0,
    C_MCQ_CORRECT: 0.9,
    W_MCQ_WRONG: 1.0,
    C_MCQ_WRONG: 0,
    W_MCQ_WRONG_UNCONSIDERED: 0.5,
    C_MCQ_WRONG_UNCONSIDERED: 0,
    W_FR_CORRECT: 1.4,
    C_FR_CORRECT: 1.4,
    W_FR_NEAR_MISS: 1.4,
    C_FR_NEAR_MISS: 0.7,
    W_FR_WRONG: 1.4,
    C_FR_WRONG: 0,
    W_FR_BLANK: 0.6,
    C_FR_BLANK: 0,
    TREND_COLLAPSE_DELTA: -10,
    TREND_COLLAPSE_CONF_MAX: 40,
    TREND_FALL_DELTA: -6,
    TREND_RISE_DELTA: 6,
  },
  DIAGNOSIS: {
    GEMINI_TIMEOUT_MS: 6000,
    MAX_PRIOR_MISTAKES: 5,
    MAX_EVIDENCE_QUESTIONS_SENT: 5,
  },
  VALIDATORS: {
    MIN_QUOTE_LEN: 8,
    MIN_MODEL_CONFIDENCE: 0.6,
    MIN_DIAGNOSIS_LEN: 60,
    MAX_HEADLINE_LEN: 60,
    MAX_DIAGNOSIS_LEN: 320,
    MAX_EVIDENCE_ITEMS: 3,
  },
} as const;

// ---------------------------------------------------------------------------
// Session state (in-memory)
// ---------------------------------------------------------------------------

interface AnsweredRecord {
  question: QuizQuestion; // the cached, node_id/prompt/choices/correct_answer/choice_tags-bearing question
  session_index: number; // server-computed position in the full session
  node_index: number; // server-computed position among this node's own questions
  given_answer: string;
  is_correct: boolean;
  chosen_choice_tag: string | null;
  latency_ms: number | null;
  revision_count: number;
  considered: boolean; // NOT an S7b "unconsidered" (too-fast) answer
  eligible: boolean; // an eligible wrong per S6/S6b/S7b — false for correct answers too
  at: string;
}

interface NodeState {
  node_id: string;
  answered: AnsweredRecord[];
  cardFired: boolean; // G6: a card has actually been emitted for this node
  geminiAttempted: boolean; // G6: an attempt (fired OR dropped) has been made for this node
}

export interface DetectionDecision {
  fired: boolean;
  pattern?: DiagnosisPattern;
  confidence?: number;
  /** Which gate/suppressor/threshold blocked it, or why it fired — for logs and tests. */
  reason: string;
}

interface CopilotSessionState {
  session_id: string;
  quizMeta: RegisteredQuizSession;
  answeredOrder: AnsweredRecord[];
  answeredQuestionIds: Set<string>;
  answeredById: Map<string, AnsweredRecord>;
  nodeStates: Map<string, NodeState>;
  cardsShown: number; // budget (G4/S8a)
  answeredSinceLastCardAttempt: number; // cooldown (G5/S8b) — reset on ANY attempt, fired or dropped
  lastDetectionDecision: DetectionDecision | null;
}

const copilotSessions = new Map<string, CopilotSessionState>();

export class CopilotSessionError extends Error {}

function getOrCreateCopilotSession(sessionId: string, quizMeta: RegisteredQuizSession): CopilotSessionState {
  let session = copilotSessions.get(sessionId);
  if (session) return session;
  session = {
    session_id: sessionId,
    quizMeta,
    answeredOrder: [],
    answeredQuestionIds: new Set(),
    answeredById: new Map(),
    nodeStates: new Map(quizMeta.node_ids.map((id) => [id, { node_id: id, answered: [], cardFired: false, geminiAttempted: false }])),
    cardsShown: 0,
    answeredSinceLastCardAttempt: 0,
    lastDetectionDecision: null,
  };
  copilotSessions.set(sessionId, session);
  return session;
}

/** Called right after /quiz/generate registers a session, so the heatmap shows every node's baseline immediately. */
export function initializeCopilotSession(sessionId: string): void {
  const quizMeta = getQuizSession(sessionId);
  if (!quizMeta) return;
  const session = getOrCreateCopilotSession(sessionId, quizMeta);
  emitCopilotHeatmap({ session_id: sessionId, cells: computeHeatmapCells(session) });
}

export function getHeatmapSnapshot(sessionId: string): CopilotHeatCell[] | null {
  const quizMeta = getQuizSession(sessionId);
  if (!quizMeta) return null;
  const session = getOrCreateCopilotSession(sessionId, quizMeta);
  return computeHeatmapCells(session);
}

/** Read-only — reflects the outcome of the most recent answer event's detection pass. Exported for tests/debugging. */
export function getLastDetectionDecision(sessionId: string): DetectionDecision | null {
  return copilotSessions.get(sessionId)?.lastDetectionDecision ?? null;
}

// ---------------------------------------------------------------------------
// Eligibility (S6 / S6b / S7b) + lexical helpers
// ---------------------------------------------------------------------------

function computeConsidered(questionType: 'mcq' | 'free_response', latencyMs: number | null): boolean {
  if (latencyMs == null) return true; // null counts as considered, per spec
  const threshold = questionType === 'mcq' ? COPILOT.SUPPRESSORS.S7B_MCQ_LATENCY_MS : COPILOT.SUPPRESSORS.S7B_FR_LATENCY_MS;
  return latencyMs >= threshold;
}

function isFreeResponseNearMiss(question: QuizQuestion, givenAnswer: string): boolean {
  const trimmed = givenAnswer.trim();
  if (trimmed.length === 0) return false;
  const overlap = lexicalOverlap(givenAnswer, question.correct_answer);
  return overlap >= COPILOT.SUPPRESSORS.S6_FR_OVERLAP_MIN && trimmed.length >= COPILOT.SUPPRESSORS.S6_FR_LEN_MIN;
}

function computeEligible(question: QuizQuestion, givenAnswer: string, isCorrect: boolean, considered: boolean): boolean {
  if (isCorrect) return false;
  if (!considered) return false; // S7b
  if (question.question_type === 'free_response') {
    if (givenAnswer.trim().length === 0) return false; // S6b blank
    if (isFreeResponseNearMiss(question, givenAnswer)) return false; // S6 near-miss
  }
  return true;
}

// ---------------------------------------------------------------------------
// Answer event — the whole pipeline for one POST /api/quiz/answer
// ---------------------------------------------------------------------------

export interface AnswerEventInput {
  session_id: string;
  question_id: string;
  node_id: string;
  question_type: 'mcq' | 'free_response';
  session_index: number;
  node_index: number;
  given_answer: string;
  latency_ms?: number;
  revision_count?: number;
}

export interface AnswerEventResult {
  is_correct: boolean;
  correct_answer: string;
  explanation?: string;
}

export async function handleQuizAnswerEvent(input: AnswerEventInput): Promise<AnswerEventResult> {
  const quizMeta = getQuizSession(input.session_id);
  if (!quizMeta) {
    throw new CopilotSessionError(`Unknown quiz session ${input.session_id}`);
  }
  const session = getOrCreateCopilotSession(input.session_id, quizMeta);

  const cachedQuestion = quizMeta.questions.find((q) => q.id === input.question_id);
  if (!cachedQuestion || cachedQuestion.node_id !== input.node_id) {
    throw new CopilotSessionError(`Unknown question ${input.question_id} in session ${input.session_id}`);
  }

  // "Fires once per question on first commit; revisits never re-fire a card."
  const existing = session.answeredById.get(input.question_id);
  if (existing) {
    return { is_correct: existing.is_correct, correct_answer: cachedQuestion.correct_answer, explanation: cachedQuestion.explanation };
  }

  const graded = await gradeSingleQuestion({ ...cachedQuestion, given_answer: input.given_answer });
  const isCorrect = !!graded.is_correct;

  // Server-computed indices, not trusted client input — the cache is the
  // authority on question order, so this can never desync from reality.
  const sessionIndex = quizMeta.questions.findIndex((q) => q.id === cachedQuestion.id);
  const nodeQuestions = quizMeta.questions.filter((q) => q.node_id === cachedQuestion.node_id);
  const nodeIndex = nodeQuestions.findIndex((q) => q.id === cachedQuestion.id);

  const latencyMs = typeof input.latency_ms === 'number' ? input.latency_ms : null;
  const considered = computeConsidered(input.question_type, latencyMs);
  const eligible = computeEligible(cachedQuestion, input.given_answer, isCorrect, considered);
  const tag = chosenChoiceTag({ ...cachedQuestion, given_answer: input.given_answer }) ?? null;

  const record: AnsweredRecord = {
    question: cachedQuestion,
    session_index: sessionIndex,
    node_index: nodeIndex,
    given_answer: input.given_answer,
    is_correct: isCorrect,
    chosen_choice_tag: tag,
    latency_ms: latencyMs,
    revision_count: input.revision_count ?? 0,
    considered,
    eligible,
    at: new Date().toISOString(),
  };

  recordAnswer(session, record);

  // STEP 1 — heatmap: ALWAYS updated, never suppressed.
  emitCopilotHeatmap({ session_id: session.session_id, cells: computeHeatmapCells(session) });

  // STEPS 2-7 — gates -> suppressors -> patterns -> confidence -> Gemini ->
  // validators -> emit. Fire-and-forget: only the Gemini call is genuinely
  // async/slow, and it must not block this response.
  void evaluateAndMaybeFireInsight(session, record).catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[copilotService] evaluateAndMaybeFireInsight failed:', err);
  });

  return { is_correct: isCorrect, correct_answer: cachedQuestion.correct_answer, explanation: cachedQuestion.explanation };
}

function recordAnswer(session: CopilotSessionState, record: AnsweredRecord): void {
  session.answeredOrder.push(record);
  session.answeredQuestionIds.add(record.question.id);
  session.answeredById.set(record.question.id, record);
  session.answeredSinceLastCardAttempt += 1;

  let nodeState = session.nodeStates.get(record.question.node_id);
  if (!nodeState) {
    nodeState = { node_id: record.question.node_id, answered: [], cardFired: false, geminiAttempted: false };
    session.nodeStates.set(record.question.node_id, nodeState);
  }
  nodeState.answered.push(record);
}

// ---------------------------------------------------------------------------
// Heatmap (always emitted, never suppressed)
// ---------------------------------------------------------------------------

function weightsFor(record: AnsweredRecord): { w: number; c: number } {
  const H = COPILOT.HEATMAP;
  if (record.question.question_type === 'mcq') {
    if (record.is_correct) return { w: H.W_MCQ_CORRECT, c: H.C_MCQ_CORRECT };
    if (!record.considered) return { w: H.W_MCQ_WRONG_UNCONSIDERED, c: H.C_MCQ_WRONG_UNCONSIDERED };
    return { w: H.W_MCQ_WRONG, c: H.C_MCQ_WRONG };
  }
  // free_response
  if (record.is_correct) return { w: H.W_FR_CORRECT, c: H.C_FR_CORRECT };
  if (record.given_answer.trim().length === 0) return { w: H.W_FR_BLANK, c: H.C_FR_BLANK };
  if (isFreeResponseNearMiss(record.question, record.given_answer)) return { w: H.W_FR_NEAR_MISS, c: H.C_FR_NEAR_MISS };
  return { w: H.W_FR_WRONG, c: H.C_FR_WRONG };
}

function clampRound(n: number): number {
  return Math.round(Math.max(0, Math.min(100, n)));
}

/** confidence = 100 * (Σ c_j·rho^d_j + k·prior_p) / (Σ w_j·rho^d_j + k), d_j = answers on this node AFTER j. */
function confidenceOverList(list: AnsweredRecord[], priorP: number, k: number): number {
  if (list.length === 0) return clampRound(100 * priorP);
  let numerator = k * priorP;
  let denominator = k;
  const n = list.length;
  list.forEach((rec, idx) => {
    const d = n - 1 - idx; // questions on this node answered after this one
    const decay = COPILOT.HEATMAP.RHO ** d;
    const { w, c } = weightsFor(rec);
    numerator += c * decay;
    denominator += w * decay;
  });
  return clampRound((100 * numerator) / denominator);
}

function kFor(status: Status): number {
  if (status === 'green') return COPILOT.HEATMAP.K_GREEN;
  if (status === 'amber') return COPILOT.HEATMAP.K_AMBER;
  return COPILOT.HEATMAP.K_RED;
}

function buildHeatCell(node: { id: string; label: string; status: Status; mastery_score: number }, answered: AnsweredRecord[]): CopilotHeatCell {
  const priorP = node.mastery_score / 100;
  const k = kFor(node.status);

  const confidence = confidenceOverList(answered, priorP, k);
  const baseline = confidenceOverList(answered.slice(0, -1), priorP, k);
  const delta = confidence - baseline;

  let trend: CopilotHeatCell['trend'] = 'flat';
  if (delta <= COPILOT.HEATMAP.TREND_COLLAPSE_DELTA && confidence <= COPILOT.HEATMAP.TREND_COLLAPSE_CONF_MAX) {
    trend = 'collapsing';
  } else if (delta <= COPILOT.HEATMAP.TREND_FALL_DELTA) {
    trend = 'falling';
  } else if (delta >= COPILOT.HEATMAP.TREND_RISE_DELTA) {
    trend = 'rising';
  }

  return {
    node_id: node.id,
    label: node.label,
    answered: answered.length,
    correct: answered.filter((r) => r.is_correct).length,
    confidence,
    trend,
    status: node.status,
  };
}

function computeHeatmapCells(session: CopilotSessionState): CopilotHeatCell[] {
  return session.quizMeta.node_ids.map((nodeId) => {
    const node = nodesRepo.getById(nodeId);
    const answered = session.nodeStates.get(nodeId)?.answered ?? [];
    if (!node) {
      // Defensive only — node_ids come from real, already-validated nodes.
      return { node_id: nodeId, label: nodeId, answered: answered.length, correct: answered.filter((r) => r.is_correct).length, confidence: 0, trend: 'flat', status: 'red' };
    }
    return buildHeatCell(node, answered);
  });
}

// ---------------------------------------------------------------------------
// S3 — nodes with engaged_at===null or status==='red' are removed from the
// evidence set entirely (applied wherever session-wide evidence is gathered).
// ---------------------------------------------------------------------------

function isEvidenceEligibleNode(nodeId: string): boolean {
  const node = nodesRepo.getById(nodeId);
  return !!node && node.engaged_at !== null && node.status !== 'red';
}

function sessionEligibleWrongs(session: CopilotSessionState): AnsweredRecord[] {
  return session.answeredOrder.filter((r) => r.eligible && isEvidenceEligibleNode(r.question.node_id));
}

// ---------------------------------------------------------------------------
// Hard gates (G1-G6)
// ---------------------------------------------------------------------------

function passesHardGates(session: CopilotSessionState, record: AnsweredRecord): { pass: true } | { pass: false; reason: string } {
  if (session.answeredOrder.length < COPILOT.GATES.G1_MIN_ANSWERED) {
    return { pass: false, reason: 'G1_min_answered' };
  }

  const total = session.quizMeta.questions.length;
  if (record.session_index >= total - 1) {
    return { pass: false, reason: 'G2_no_questions_remaining' };
  }

  const node = nodesRepo.getById(record.question.node_id);
  if (!node || node.engaged_at === null || node.status === 'red') {
    return { pass: false, reason: 'G3_focal_node_not_ready' };
  }

  if (session.cardsShown >= COPILOT.GATES.G4_MAX_CARDS_PER_SESSION) {
    return { pass: false, reason: 'G4_session_budget' };
  }

  if (session.answeredSinceLastCardAttempt < COPILOT.GATES.G5_MIN_ANSWERED_SINCE_LAST_CARD) {
    return { pass: false, reason: 'G5_cooldown' };
  }

  const nodeState = session.nodeStates.get(record.question.node_id);
  if (nodeState?.cardFired || nodeState?.geminiAttempted) {
    return { pass: false, reason: 'G6_node_already_used' };
  }

  return { pass: true };
}

/** S8a-d: literal re-checks of G4/G5/G2/G6's card-half, per spec ("defense in depth"). */
function passesRedundantSuppressors(session: CopilotSessionState, record: AnsweredRecord): { pass: true } | { pass: false; reason: string } {
  if (session.cardsShown >= COPILOT.GATES.G4_MAX_CARDS_PER_SESSION) return { pass: false, reason: 'S8a_budget' };
  if (session.answeredSinceLastCardAttempt < COPILOT.GATES.G5_MIN_ANSWERED_SINCE_LAST_CARD) return { pass: false, reason: 'S8b_cooldown' };
  const nodeState = session.nodeStates.get(record.question.node_id);
  if (nodeState?.cardFired) return { pass: false, reason: 'S8c_one_per_node' };
  const total = session.quizMeta.questions.length;
  if (record.session_index >= total - 1) return { pass: false, reason: 'S8d_last_question' };
  return { pass: true };
}

// ---------------------------------------------------------------------------
// Global suppressors (S5a flip-flop, S5b scattered-no-edge)
// ---------------------------------------------------------------------------

function isFlipFlopSuppressed(session: CopilotSessionState): boolean {
  const n = session.answeredOrder.length;
  if (n < COPILOT.SUPPRESSORS.S5A_MIN_ANSWERED) return false;
  const windowSize = Math.min(COPILOT.SUPPRESSORS.S5A_WINDOW_MAX, n);
  const window = session.answeredOrder.slice(-windowSize);
  let flips = 0;
  for (let i = 1; i < window.length; i += 1) {
    const prev = window[i - 1];
    const cur = window[i];
    if (prev && cur && prev.is_correct !== cur.is_correct) flips += 1;
  }
  const flipRatio = window.length > 1 ? flips / (window.length - 1) : 0;
  const accuracy = window.filter((r) => r.is_correct).length / window.length;
  return (
    flipRatio >= COPILOT.SUPPRESSORS.S5A_FLIP_RATIO_MIN &&
    accuracy >= COPILOT.SUPPRESSORS.S5A_ACCURACY_LOW &&
    accuracy <= COPILOT.SUPPRESSORS.S5A_ACCURACY_HIGH
  );
}

function qualifyingEdgesAmong(nodeIds: string[]): { source_node_id: string; target_node_id: string; strength: number; discovered_by: string }[] {
  const found: { source_node_id: string; target_node_id: string; strength: number; discovered_by: string }[] = [];
  for (let i = 0; i < nodeIds.length; i += 1) {
    for (let j = i + 1; j < nodeIds.length; j += 1) {
      const a = nodeIds[i] as string;
      const b = nodeIds[j] as string;
      for (const type of ['correlated_error', 'prerequisite'] as const) {
        const edge = edgesRepo.findBetween(a, b, type);
        if (edge && edge.strength >= COPILOT.PATTERNS.P2_EDGE_STRENGTH_MIN) found.push(edge);
      }
    }
  }
  return found;
}

function isScatteredNoEdgeSuppressed(session: CopilotSessionState): boolean {
  const wrongs = session.answeredOrder.filter((r) => !r.is_correct && isEvidenceEligibleNode(r.question.node_id));
  if (wrongs.length < COPILOT.SUPPRESSORS.S5B_MIN_WRONGS) return false;
  const nodeIds = Array.from(new Set(wrongs.map((r) => r.question.node_id)));
  if (nodeIds.length < COPILOT.SUPPRESSORS.S5B_MIN_NODES) return false;
  return qualifyingEdgesAmong(nodeIds).length === 0;
}

// ---------------------------------------------------------------------------
// P1 corroborators (C1-C5) + S4
// ---------------------------------------------------------------------------

interface Corroborators {
  c1SharedTag: boolean;
  c2PriorRecord: boolean;
  c2bDistractorOverlap: boolean;
  c3GreenNode: boolean;
  c4Effort: boolean;
  c5ZeroCorrect: boolean;
  priorRecords: MistakeRecord[]; // predating session, concept_gap|prerequisite_gap
}

function priorMistakeRecords(nodeId: string, startedAt: string): MistakeRecord[] {
  const cutoff = new Date(startedAt).getTime();
  return mistakeRecordsRepo.getByNode(nodeId).filter((m) => new Date(m.created_at).getTime() < cutoff);
}

function computeCorroborators(session: CopilotSessionState, nodeId: string): Corroborators {
  const nodeState = session.nodeStates.get(nodeId);
  const node = nodesRepo.getById(nodeId);
  const answered = nodeState?.answered ?? [];
  const eligibleWrongs = answered.filter((r) => r.eligible);

  // C1: two MCQ wrongs share the same non-empty chosen_choice_tag.
  const tagCounts = new Map<string, number>();
  for (const r of eligibleWrongs) {
    if (r.question.question_type === 'mcq' && r.chosen_choice_tag) {
      tagCounts.set(r.chosen_choice_tag, (tagCounts.get(r.chosen_choice_tag) ?? 0) + 1);
    }
  }
  const c1SharedTag = Array.from(tagCounts.values()).some((count) => count >= 2);

  // C2: a prior MistakeRecord on the node predating the session, concept_gap|prerequisite_gap.
  const allPrior = priorMistakeRecords(nodeId, session.quizMeta.started_at);
  const priorRecords = allPrior.filter((m) => m.error_type === 'concept_gap' || m.error_type === 'prerequisite_gap');
  const c2PriorRecord = priorRecords.length > 0;

  // C2b: distractor<->record overlap >= 0.40 for at least one (eligible wrong, prior record) pair.
  let c2bDistractorOverlap = false;
  outer: for (const r of eligibleWrongs) {
    for (const mr of priorRecords) {
      const overlap = lexicalOverlap(`${r.given_answer} ${r.question.prompt}`, mr.raw_excerpt);
      if (overlap >= COPILOT.CONFIDENCE.P1_C2B_MIN_OVERLAP) {
        c2bDistractorOverlap = true;
        break outer;
      }
    }
  }

  // C3: node.status === 'green'.
  const c3GreenNode = node?.status === 'green';

  // C4 ("effort"): at least one eligible wrong was revised before being committed.
  const c4Effort = eligibleWrongs.some((r) => r.revision_count >= 1);

  // C5: >=3 answered on the node this session with 0 correct.
  const c5ZeroCorrect = answered.length >= 3 && answered.every((r) => !r.is_correct);

  return { c1SharedTag, c2PriorRecord, c2bDistractorOverlap, c3GreenNode, c4Effort, c5ZeroCorrect, priorRecords: allPrior };
}

/** S4: >=2 MCQ wrongs on the node with non-empty, UNEQUAL tags, and neither C2 nor C3 holds -> silent. */
function isS4Suppressed(session: CopilotSessionState, nodeId: string, corroborators: Corroborators): boolean {
  const answered = session.nodeStates.get(nodeId)?.answered ?? [];
  const taggedMcqWrongs = answered.filter((r) => r.question.question_type === 'mcq' && !r.is_correct && r.chosen_choice_tag);
  if (taggedMcqWrongs.length < 2) return false;
  const uniqueTags = new Set(taggedMcqWrongs.map((r) => r.chosen_choice_tag));
  if (uniqueTags.size < 2) return false; // all the same tag -> not conflicting, don't suppress
  if (corroborators.c2PriorRecord || corroborators.c3GreenNode) return false;
  return true;
}

// ---------------------------------------------------------------------------
// Pattern evaluation
// ---------------------------------------------------------------------------

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
}

interface PatternFire {
  pattern: DiagnosisPattern;
  confidence: number;
  correlatedNodeIds?: string[]; // P2
  p3PriorRecord?: MistakeRecord; // P3
}

function evaluateP1(session: CopilotSessionState, nodeId: string, corroborators: Corroborators): PatternFire | null {
  const node = nodesRepo.getById(nodeId);
  if (!node) return null;
  const answered = session.nodeStates.get(nodeId)?.answered ?? [];
  if (answered.length === 0) return null;

  const windowSize = Math.min(COPILOT.PATTERNS.P1_RECENT_WINDOW_CAP, answered.length);
  const window = answered.slice(-windowSize);
  const eligibleWrongsInWindow = window.filter((r) => r.eligible);
  if (eligibleWrongsInWindow.length < COPILOT.PATTERNS.P1_MIN_ELIGIBLE_WRONGS) return null;

  if (!(corroborators.c1SharedTag || corroborators.c2PriorRecord || corroborators.c3GreenNode || corroborators.c5ZeroCorrect)) {
    return null;
  }

  const allEligibleWrongs = answered.filter((r) => r.eligible);
  const C = COPILOT.CONFIDENCE;
  let confidence = C.P1_BASE;
  confidence += Math.min(Math.max(allEligibleWrongs.length - 1, 0) * C.P1_PER_EXTRA_WRONG, C.P1_PER_EXTRA_WRONG_CAP);
  if (corroborators.c1SharedTag) confidence += C.P1_C1_SHARED_TAG;
  if (corroborators.c2PriorRecord) confidence += C.P1_C2_PRIOR_RECORD;
  if (corroborators.c2bDistractorOverlap) confidence += C.P1_C2B_DISTRACTOR_OVERLAP;
  if (corroborators.c3GreenNode) confidence += C.P1_C3_GREEN_NODE;
  if (corroborators.c5ZeroCorrect) confidence += C.P1_C5_ZERO_CORRECT;
  if (corroborators.c4Effort) confidence += C.P1_C4_EFFORT;

  const allFR = allEligibleWrongs.every((r) => r.question.question_type === 'free_response');
  if (allFR) confidence += C.P1_PENALTY_ALL_FR;

  if (node.status === 'amber' && node.mastery_score <= C.P1_PENALTY_AMBER_MASTERY_MAX && corroborators.priorRecords.length === 0) {
    confidence += C.P1_PENALTY_AMBER_LOW_MASTERY;
  }

  const lastWrongIdx = (() => {
    for (let i = answered.length - 1; i >= 0; i -= 1) {
      if (!answered[i]!.is_correct) return i;
    }
    return -1;
  })();
  if (lastWrongIdx !== -1 && answered.slice(lastWrongIdx + 1).some((r) => r.is_correct)) {
    confidence += C.P1_PENALTY_RECOVERY;
  }

  if (window.some((r) => !r.considered)) {
    confidence += C.P1_PENALTY_CONTAMINATED;
  }

  return { pattern: 'repeated_failure_same_node', confidence: clamp01(confidence) };
}

function sharedPriorErrorTypeAcrossNodes(session: CopilotSessionState, nodeIds: string[]): boolean {
  const errorTypesByNode = nodeIds.map((id) => new Set(priorMistakeRecords(id, session.quizMeta.started_at).map((m) => m.error_type)));
  const allTypes: ErrorType[] = ['concept_gap', 'careless_slip', 'prerequisite_gap'];
  for (const type of allTypes) {
    const nodesWithType = errorTypesByNode.filter((set) => set.has(type)).length;
    if (nodesWithType >= 2) return true;
  }
  return false;
}

function evaluateP2(session: CopilotSessionState, focalNodeId: string): PatternFire | null {
  const eligible = sessionEligibleWrongs(session);
  if (eligible.length < COPILOT.PATTERNS.P2_MIN_SESSION_WRONGS) return null;

  const failingNodeIds = Array.from(new Set(eligible.map((r) => r.question.node_id)));
  if (failingNodeIds.length < COPILOT.PATTERNS.P2_MIN_NODES) return null;
  if (!failingNodeIds.includes(focalNodeId)) return null; // this event must be part of the pattern

  const edges = qualifyingEdgesAmong(failingNodeIds);
  if (edges.length === 0) return null;

  const C = COPILOT.CONFIDENCE;
  let confidence = C.P2_BASE;
  confidence += Math.min(edges.length * C.P2_PER_EDGE, C.P2_PER_EDGE_CAP);
  // An edge the Autopsy agent actually DISCOVERED from this student's mistakes
  // is far stronger evidence than a seeded one, so it earns a bonus.
  // autopsyService writes discovered_by: 'autopsy'; the spec was written against
  // 'autopsy_agent'. Match either, or this bonus silently never applies and P2
  // is weakest exactly where it should be strongest.
  if (edges.some((e) => e.discovered_by.startsWith('autopsy'))) confidence += C.P2_AUTOPSY_EDGE_BONUS;
  if (sharedPriorErrorTypeAcrossNodes(session, failingNodeIds)) confidence += C.P2_SHARED_ERROR_TYPE_BONUS;
  const anyAmberLowMastery = failingNodeIds.some((id) => {
    const n = nodesRepo.getById(id);
    return !!n && n.status === 'amber' && n.mastery_score <= C.P2_PENALTY_AMBER_MASTERY_MAX;
  });
  if (anyAmberLowMastery) confidence += C.P2_PENALTY_AMBER_LOW_MASTERY;

  return { pattern: 'correlated_cross_node', confidence: clamp01(confidence), correlatedNodeIds: failingNodeIds };
}

function evaluateP3(session: CopilotSessionState, record: AnsweredRecord): PatternFire | null {
  if (!COPILOT.PATTERNS.ALLOW_RECURRENCE_SINGLE_WRONG) return null;
  if (record.is_correct) return null;
  if (record.question.question_type !== 'mcq') return null;
  if (!record.considered) return null;

  const nodeId = record.question.node_id;
  const candidates = priorMistakeRecords(nodeId, session.quizMeta.started_at).filter(
    (m) => m.error_type === 'concept_gap' || m.error_type === 'prerequisite_gap',
  );
  if (candidates.length === 0) return null;

  const needle = `${record.given_answer} ${record.question.prompt}`;
  let best: { record: MistakeRecord; overlap: number } | null = null;
  for (const mr of candidates) {
    const overlap = lexicalOverlap(needle, mr.raw_excerpt);
    if (!best || overlap > best.overlap) best = { record: mr, overlap };
  }
  if (!best || best.overlap < COPILOT.PATTERNS.P3_OVERLAP_MIN) return null;

  const C = COPILOT.CONFIDENCE;
  // NOTE: because the gate above already REQUIRES a qualifying prior record
  // and overlap >= P3_OVERLAP_MIN, these two bonuses are always applied when
  // P3 fires at all — the spec lists them as additive bonuses on top of base,
  // so that's what's implemented, even though it collapses to a near-constant
  // total for this pattern. See report for discussion.
  let confidence = C.P3_BASE + C.P3_PRIOR_RECORD_BONUS + C.P3_OVERLAP_BONUS;
  if (best.record.source === 'uploaded_homework' || new Date(best.record.created_at) < new Date(session.quizMeta.started_at)) {
    confidence += C.P3_EARLIER_SESSION_BONUS;
  }

  return { pattern: 'documented_recurrence', confidence: clamp01(confidence), p3PriorRecord: best.record };
}

// ---------------------------------------------------------------------------
// The full evaluation pipeline for one answered question.
// ---------------------------------------------------------------------------

function computeDetection(session: CopilotSessionState, record: AnsweredRecord): { decision: DetectionDecision; fire: PatternFire | null } {
  const gates = passesHardGates(session, record);
  if (!gates.pass) return { decision: { fired: false, reason: gates.reason }, fire: null };

  if (isFlipFlopSuppressed(session)) return { decision: { fired: false, reason: 'S5a_flip_flop' }, fire: null };
  if (isScatteredNoEdgeSuppressed(session)) return { decision: { fired: false, reason: 'S5b_scattered_no_edge' }, fire: null };

  const nodeId = record.question.node_id;
  const corroborators = computeCorroborators(session, nodeId);

  if (isS4Suppressed(session, nodeId, corroborators)) return { decision: { fired: false, reason: 'S4_conflicting_tags' }, fire: null };

  const redundant = passesRedundantSuppressors(session, record);
  if (!redundant.pass) return { decision: { fired: false, reason: redundant.reason }, fire: null };

  const candidates: PatternFire[] = [];
  const p1 = evaluateP1(session, nodeId, corroborators);
  if (p1) candidates.push(p1);
  const p2 = evaluateP2(session, nodeId);
  if (p2) candidates.push(p2);
  const p3 = evaluateP3(session, record);
  if (p3) candidates.push(p3);

  if (candidates.length === 0) return { decision: { fired: false, reason: 'no_pattern_matched' }, fire: null };

  candidates.sort((a, b) => b.confidence - a.confidence);
  const best = candidates[0] as PatternFire;

  if (best.confidence < COPILOT.CONFIDENCE.THRESHOLD) {
    return { decision: { fired: false, reason: 'below_confidence_threshold', pattern: best.pattern, confidence: best.confidence }, fire: null };
  }

  return { decision: { fired: true, pattern: best.pattern, confidence: best.confidence, reason: 'attempting_diagnosis' }, fire: best };
}

/**
 * Direct-testing entry point: re-runs the (pure, read-only) detection
 * computation against CURRENT session state for an already-recorded
 * question — i.e. "what would the pipeline decide right now". NOTE this is
 * NOT necessarily the same answer the real pass gave AT THE TIME that
 * question was answered: if that event actually fired, the real pass already
 * consumed the cooldown/G6-attempt as a side effect, so re-running this
 * afterward will correctly (and differently) report "cooldown active" rather
 * than replaying history. To inspect what happened for the most recently
 * processed event specifically, use `getLastDetectionDecision` instead.
 */
export function evaluateDetection(sessionId: string, questionId: string): DetectionDecision | null {
  const session = copilotSessions.get(sessionId);
  if (!session) return null;
  const record = session.answeredById.get(questionId);
  if (!record) return null;
  return computeDetection(session, record).decision;
}

function buildDiagnosisInput(session: CopilotSessionState, nodeId: string, fire: PatternFire): DiagnosisInput {
  const node = nodesRepo.getById(nodeId)!;
  const nodeState = session.nodeStates.get(nodeId);
  const answered = nodeState?.answered ?? [];

  let evidenceRecords: AnsweredRecord[];
  if (fire.pattern === 'documented_recurrence') {
    evidenceRecords = answered.filter((r) => !r.is_correct).slice(-1);
  } else if (fire.pattern === 'correlated_cross_node') {
    evidenceRecords = sessionEligibleWrongs(session).filter((r) => fire.correlatedNodeIds?.includes(r.question.node_id));
  } else {
    evidenceRecords = answered.filter((r) => r.eligible);
  }
  evidenceRecords = evidenceRecords.slice(-COPILOT.DIAGNOSIS.MAX_EVIDENCE_QUESTIONS_SENT);

  const evidenceQuestions: DiagnosisEvidenceQuestion[] = evidenceRecords.map((r) => ({
    prompt: r.question.prompt,
    choices: r.question.choices,
    correct_answer: r.question.correct_answer,
    given_answer: r.given_answer,
    chosen_choice_tag: r.chosen_choice_tag ?? undefined,
    latency_ms: r.latency_ms ?? undefined,
    explanation: r.question.explanation,
  }));

  const answeredCorrectly: DiagnosisCorrectAnswer[] = answered
    .filter((r) => r.is_correct)
    .map((r) => ({ prompt: r.question.prompt, given_answer: r.given_answer }));

  const priorMistakes: DiagnosisPriorMistake[] = priorMistakeRecords(nodeId, session.quizMeta.started_at)
    .slice(-COPILOT.DIAGNOSIS.MAX_PRIOR_MISTAKES)
    .map((m) => ({ raw_excerpt: m.raw_excerpt, error_type: m.error_type, source: m.source, created_at: m.created_at }));

  let correlatedNodes: DiagnosisCorrelatedNode[] | undefined;
  if (fire.pattern === 'correlated_cross_node' && fire.correlatedNodeIds) {
    correlatedNodes = fire.correlatedNodeIds
      .filter((id) => id !== nodeId)
      .map((id) => nodesRepo.getById(id))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .map((n) => ({ id: n.id, label: n.label, status: n.status }));
  }

  return {
    node: { id: node.id, label: node.label, subject: node.subject, status: node.status, mastery_score: node.mastery_score, retest_count: node.retest_count },
    evidence_questions: evidenceQuestions,
    answered_correctly_on_this_node: answeredCorrectly,
    prior_mistakes: priorMistakes,
    correlated_nodes: correlatedNodes,
    trigger_confidence: fire.confidence,
    pattern: fire.pattern,
  };
}

function writeCarelessSlipMistakeRecord(record: AnsweredRecord): void {
  const questionWithAnswer: QuizQuestion = { ...record.question, given_answer: record.given_answer };
  const mistake: MistakeRecord = {
    id: `mistake_${nanoid(10)}`,
    student_id: getActiveStudentId(),
    node_id: record.question.node_id,
    source: 'quiz',
    raw_excerpt: buildMistakeExcerpt(questionWithAnswer),
    error_type: 'careless_slip',
    created_at: new Date().toISOString(),
  };
  mistakeRecordsRepo.insert(mistake);
}

async function evaluateAndMaybeFireInsight(session: CopilotSessionState, record: AnsweredRecord): Promise<void> {
  const { decision, fire } = computeDetection(session, record);
  session.lastDetectionDecision = decision;
  if (!decision.fired || !fire) return;

  const nodeId = record.question.node_id;
  const nodeState = session.nodeStates.get(nodeId);
  if (!nodeState) return;

  // Consume the cooldown + this node's one attempt NOW, synchronously, before
  // the (slow, network) diagnosis call — a second answer landing mid-flight
  // must see this attempt as already spent.
  nodeState.geminiAttempted = true;
  session.answeredSinceLastCardAttempt = 0;

  const outcome = await diagnoseAndValidate(buildDiagnosisInput(session, nodeId, fire), {
    timeoutMs: COPILOT.DIAGNOSIS.GEMINI_TIMEOUT_MS,
    minQuoteLen: COPILOT.VALIDATORS.MIN_QUOTE_LEN,
    minModelConfidence: COPILOT.VALIDATORS.MIN_MODEL_CONFIDENCE,
    minDiagnosisLen: COPILOT.VALIDATORS.MIN_DIAGNOSIS_LEN,
    maxHeadlineLen: COPILOT.VALIDATORS.MAX_HEADLINE_LEN,
    maxDiagnosisLen: COPILOT.VALIDATORS.MAX_DIAGNOSIS_LEN,
    maxEvidenceItems: COPILOT.VALIDATORS.MAX_EVIDENCE_ITEMS,
  });

  if (!outcome.ok) {
    // A dropped card does NOT consume the budget, but DOES consume the
    // cooldown and the node's one attempt (already done above).
    if (outcome.reason === 'v2_careless_slip') {
      writeCarelessSlipMistakeRecord(record);
    }
    return;
  }

  session.cardsShown += 1;
  nodeState.cardFired = true;

  const insight: CopilotInsight = {
    id: `copilot_${nanoid(10)}`,
    session_id: session.session_id,
    node_id: nodeId,
    headline: outcome.result.headline,
    diagnosis: outcome.result.diagnosis,
    evidence: outcome.result.evidence,
    error_type: outcome.result.error_type,
    confidence: outcome.result.confidence,
    pattern: fire.pattern,
    suggested_action: outcome.result.suggested_action,
    at: new Date().toISOString(),
  };
  emitCopilotInsight(insight);
}
