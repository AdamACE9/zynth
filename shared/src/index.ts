/**
 * @zynth/shared — the single source of truth for Zynth's data model.
 *
 * Both the Express/SQLite backend and the react-three-fiber frontend import
 * these types so the graph the user sees and the graph the DB stores can never
 * silently drift apart.
 *
 * The most load-bearing thing in this file is the Node.status state machine
 * (see `isLegalStatusTransition`). That rule is ALSO enforced by a SQLite
 * BEFORE UPDATE trigger at the data layer. If you change the rule here, you
 * MUST change the trigger too (server/src/db/schema.sql). They are deliberately
 * redundant — the TS layer gives good errors, the SQL trigger makes bypass
 * impossible even from a raw UPDATE.
 */

// ---------------------------------------------------------------------------
// Status state machine
// ---------------------------------------------------------------------------

/** Evidence-based mastery. NOT exposure. See TASKBRIEFING Section 2. */
export type Status = 'red' | 'amber' | 'green';

export const STATUS = {
  RED: 'red',
  AMBER: 'amber',
  GREEN: 'green',
} as const;

/** The one and only pass mark. Green is unreachable below this. */
export const QUIZ_PASS_THRESHOLD = 70;

/**
 * The cause of a proposed status change. There is no generic "set status to X".
 * Every legal transition is produced by exactly one of these intents:
 *   - 'engage'      → first War Room/Explain interaction sets engaged_at (red→amber)
 *   - 'quiz_passed' → a QuizSession with score >= threshold (amber→green)
 *   - 'quiz_failed' → a failed retest (green→amber)
 */
export type StatusChangeCause = 'engage' | 'quiz_passed' | 'quiz_failed';

export interface StatusTransition {
  from: Status;
  to: Status;
  cause: StatusChangeCause;
}

/**
 * The complete legal transition table. Anything not listed here is illegal —
 * including red→green (no skipping amber) and amber→red (engagement doesn't decay).
 * A no-op (from === to) is treated as legal so idempotent writes don't throw.
 */
export const LEGAL_TRANSITIONS: ReadonlyArray<StatusTransition> = [
  { from: 'red', to: 'amber', cause: 'engage' },
  { from: 'amber', to: 'green', cause: 'quiz_passed' },
  { from: 'green', to: 'amber', cause: 'quiz_failed' },
];

export function isLegalStatusTransition(
  from: Status,
  to: Status,
  cause: StatusChangeCause,
): boolean {
  if (from === to) return true; // idempotent no-op
  return LEGAL_TRANSITIONS.some(
    (t) => t.from === from && t.to === to && t.cause === cause,
  );
}

/** Human-readable reason a transition was rejected — used in errors + the verifier. */
export function explainTransition(
  from: Status,
  to: Status,
  cause: StatusChangeCause,
): string {
  if (isLegalStatusTransition(from, to, cause)) {
    return `OK: ${from}→${to} via ${cause}`;
  }
  return `ILLEGAL: ${from}→${to} via ${cause} is not in the legal transition table`;
}

// ---------------------------------------------------------------------------
// Core entities (Section 5)
// ---------------------------------------------------------------------------

export type ISOTimestamp = string;

export interface StatusHistoryEntry {
  timestamp: ISOTimestamp;
  status: Status;
  cause: StatusChangeCause | 'seed';
}

/** A single concept in the student's syllabus. */
export interface Node {
  id: string;
  student_id: string;
  label: string; // e.g. "Implicit Differentiation"
  subject: string; // e.g. "Calculus" — also the primary clustering key
  cluster: string; // clustering group key (defaults to subject; lets us sub-cluster later)
  status: Status;
  mastery_score: number; // 0-100, derived display value (status floor blended with last quiz score)
  engaged_at: ISOTimestamp | null; // first War Room/Explain interaction → red→amber trigger
  last_quiz_passed_at: ISOTimestamp | null; // timestamp of the quiz that earned green
  last_quiz_result: QuizResultSummary | null;
  retest_count: number; // how many times the student has redone this node
  history: StatusHistoryEntry[]; // status log for trend view / streak calc
  // Precomputed 3D layout position (constellation clustering). Nullable until laid out.
  x: number | null;
  y: number | null;
  z: number | null;
  created_at: ISOTimestamp;
  updated_at: ISOTimestamp;
}

export interface QuizResultSummary {
  passed: boolean;
  score: number; // 0-100
  at: ISOTimestamp;
}

export type RelationshipType =
  | 'prerequisite'
  | 'correlated_error'
  | 'related_topic';

/** A relationship between two concepts. */
export interface Edge {
  id: string;
  student_id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: RelationshipType;
  strength: number; // 0-1 confidence
  discovered_by: string; // agent name, e.g. "autopsy_agent" | "seed"
  created_at: ISOTimestamp;
}

export type MistakeSource = 'uploaded_homework' | 'quiz' | 'exam_sim';
export type ErrorType = 'concept_gap' | 'careless_slip' | 'prerequisite_gap';

export interface MistakeRecord {
  id: string;
  student_id: string;
  node_id: string;
  source: MistakeSource;
  raw_excerpt: string;
  error_type: ErrorType;
  created_at: ISOTimestamp;
}

export interface QuizQuestion {
  id: string;
  node_id: string; // which concept this question tests
  prompt: string;
  choices?: string[]; // omitted for free-response
  correct_answer: string;
  given_answer?: string;
  is_correct?: boolean;
  question_type?: 'mcq' | 'free_response';
  explanation?: string; // shown after grading — why the correct answer is correct
  /**
   * Parallel to `choices`: a snake_case tag naming the specific misconception a
   * student must hold to pick that option ("" for the correct one). The Live
   * Co-Pilot uses matching tags across questions as its strongest evidence that
   * two wrong answers share ONE root cause rather than being two unrelated
   * slips. Optional — every detection rule degrades gracefully without it.
   */
  choice_tags?: string[];
}

export interface QuizSession {
  id: string;
  student_id: string;
  node_ids: string[]; // concepts under test (multi-node)
  questions: QuizQuestion[];
  score: number; // 0-100
  passed: boolean; // the ONLY trigger for amber→green (score >= QUIZ_PASS_THRESHOLD)
  created_at: ISOTimestamp;
}

export type WarRoomPersona =
  | 'analogist'
  | 'purist'
  | 'real_world'
  | 'skeptic'
  | 'synthesis';

export interface WarRoomMessage {
  agent_persona: WarRoomPersona;
  message: string;
  at: ISOTimestamp;
}

export type WarRoomOutcome = 'understood' | 'still_confused';

export interface WarRoomSession {
  id: string;
  student_id: string;
  node_id: string;
  transcript: WarRoomMessage[]; // replayable debate log
  outcome: WarRoomOutcome | null;
  created_at: ISOTimestamp;
}

export interface ExplainMessage {
  role: 'student' | 'tutor';
  content: string;
  at: ISOTimestamp;
}

export interface ExplainSession {
  id: string;
  student_id: string;
  node_id: string;
  messages: ExplainMessage[];
  created_at: ISOTimestamp;
}

export interface ExamReasoningEntry {
  question_id: string;
  reasoning: string; // the agent's shown reasoning, for the demo
}

export interface ExamNodeResult {
  node_id: string;
  score: number; // 0-100 per concept
}

export interface ExamSimSession {
  id: string;
  student_id: string;
  source_paper: string;
  questions: QuizQuestion[];
  live_reasoning_log: ExamReasoningEntry[];
  node_results: ExamNodeResult[];
  created_at: ISOTimestamp;
}

export interface PlanPath {
  id: string;
  student_id: string;
  goal: string;
  node_sequence: string[]; // ordered node ids toward the goal
  current_position: number; // index into node_sequence
  last_replanned_at: ISOTimestamp | null;
  replanned_because: string | null; // what mastery change triggered a reroute
  created_at: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Live Co-Pilot (Day 3) — watches a quiz in progress
// ---------------------------------------------------------------------------

/**
 * One cell of the live mastery heatmap, recomputed after every answered
 * question. Always updates — unlike insight cards, this is never suppressed.
 */
export interface CopilotHeatCell {
  node_id: string;
  label: string;
  answered: number;
  correct: number;
  /**
   * 0-100 live confidence for this node within the session. Display-only and
   * session-scoped — it NEVER writes Node.status or Node.mastery_score.
   * Smoothed against the node's existing mastery as a prior so it stays
   * meaningful at 2-4 questions per node.
   */
  confidence: number;
  trend: 'rising' | 'flat' | 'falling' | 'collapsing';
  /** The graph's real status, passed through unchanged for display. */
  status: Status;
}

/**
 * An UNPROMPTED diagnosis pushed mid-quiz when a concept is visibly
 * collapsing. Must explain *why*, not just report a wrong answer — and must
 * clear the suppression rules before it is allowed to interrupt.
 */
export interface CopilotInsight {
  id: string;
  session_id: string;
  node_id: string;
  /** One line, e.g. "This isn't an arithmetic slip." */
  headline: string;
  /** The actual diagnosis of the misconception. */
  diagnosis: string;
  /** What the system saw — the student's own answers, quoted. */
  evidence: string[];
  error_type: ErrorType;
  /** 0-1. Below the firing threshold we stay silent. */
  confidence: number;
  /** Which detection pattern fired, for debugging and the results recap. */
  pattern?: 'repeated_failure_same_node' | 'correlated_cross_node' | 'documented_recurrence';
  /** Routes the card straight into the fix — the diagnose→replan loop. */
  suggested_action?: 'war_room' | 'explain' | 'none';
  at: ISOTimestamp;
}

// ---------------------------------------------------------------------------
// Study Plan / Ghost Path (Day 3)
// ---------------------------------------------------------------------------

export type GhostVerdict = 'ahead' | 'on_track' | 'behind';

export interface PlanStep {
  node_id: string;
  label: string;
  /** Position in the planned route. */
  index: number;
  status: Status;
  /** Where the student actually is relative to the plan. */
  state: 'done' | 'current' | 'upcoming';
}

/** Planned route vs. real mastery — the GPS-ETA comparison the Ghost Path draws. */
export interface GhostPath {
  plan_id: string;
  goal: string;
  steps: PlanStep[];
  /** Index the plan expects the student to have reached by now. */
  planned_position: number;
  /** Index actually reached, derived from Node.status along the sequence. */
  actual_position: number;
  verdict: GhostVerdict;
  /** Human-readable, e.g. "2 concepts behind schedule". */
  summary: string;
  last_replanned_at: ISOTimestamp | null;
  replanned_because: string | null;
}

// ---------------------------------------------------------------------------
// Mastery Streak (Day 3) — derived, no new schema
// ---------------------------------------------------------------------------

/**
 * A node earns a flame when it has been RE-tested and stayed green throughout.
 * Derived purely from status + retest_count + history: count trailing
 * consecutive `quiz_passed` entries, stopping at any `quiz_failed`.
 * Returns 0 when there is no streak (never retested, or it has dropped back).
 */
export function masteryStreak(node: Pick<Node, 'status' | 'retest_count' | 'history'>): number {
  if (node.status !== 'green' || node.retest_count < 1) return 0;
  let streak = 0;
  for (let i = node.history.length - 1; i >= 0; i--) {
    const entry = node.history[i];
    if (!entry) break;
    if (entry.cause === 'quiz_passed') streak++;
    else if (entry.cause === 'quiz_failed') break;
  }
  // A single pass is just "proven" — a streak means it survived a retest.
  return streak >= 2 ? streak : 0;
}

/** Persona definitions — configuration, not per-student data. */
export type AgentName =
  | 'diagnosis'
  | 'war_room_analogist'
  | 'war_room_skeptic'
  | 'war_room_purist'
  | 'war_room_real_world'
  | 'war_room_synthesis'
  | 'autopsy'
  | 'planner'
  | 'exam_grader'
  | 'explain_tutor';

export interface AgentConfig {
  name: AgentName;
  system_prompt: string;
  model: string; // resolved from GEMINI_MODEL env, e.g. "gemini-2.5-flash"
  temperature?: number;
}

// ---------------------------------------------------------------------------
// Socket.io event contract
// ---------------------------------------------------------------------------

/** Events the server pushes to clients. Keep names in sync with server/src/socket.ts. */
export interface ServerToClientEvents {
  'node:updated': (node: Node) => void;
  'node:status_changed': (payload: {
    node: Node;
    cause: StatusChangeCause;
    previous_status: Status;
  }) => void;
  'node:created': (node: Node) => void;
  'edge:created': (edge: Edge) => void;
  'graph:snapshot': (payload: { nodes: Node[]; edges: Edge[] }) => void;
  'agent:thinking': (payload: { agent: AgentName; node_id: string; message: string }) => void;
  /** Live Co-Pilot: the heatmap refreshes after every answered question. */
  'copilot:heatmap': (payload: { session_id: string; cells: CopilotHeatCell[] }) => void;
  /** Live Co-Pilot: an unprompted diagnosis. Fires rarely, by design. */
  'copilot:insight': (payload: CopilotInsight) => void;
  /** Study Plan re-planned itself because mastery changed (never manual). */
  'plan:updated': (payload: { ghost: GhostPath; because: string }) => void;
  /** Exam Simulator streaming its own reasoning, per question. */
  'exam:reasoning': (payload: {
    session_id: string;
    question_id: string;
    index: number;
    total: number;
    phase: 'thinking' | 'token' | 'graded';
    text: string;
    is_correct?: boolean;
  }) => void;
  'warroom:turn': (payload: {
    session_id: string;
    node_id: string;
    persona: WarRoomPersona;
    phase: 'start' | 'token' | 'done';
    text: string;
  }) => void;
  'warroom:resolved': (payload: {
    session_id: string;
    node_id: string;
    outcome: WarRoomOutcome;
    node: Node;
  }) => void;
  'autopsy:progress': (payload: { message: string }) => void;
}

export interface ClientToServerEvents {
  'graph:request_snapshot': () => void;
}

// ---------------------------------------------------------------------------
// Intuition — the visual, interactive understanding step (red → amber)
// ---------------------------------------------------------------------------

/**
 * Why this exists, and why it is a *constrained grammar* rather than free-form
 * generated markup.
 *
 * The module it replaced (War Room) asked five AI personas to explain a concept
 * in prose. Five uncapped paragraphs, streamed in sequence, to move one node
 * red→amber — the exact same outcome as one click of Explain. A student can
 * read the textbook faster, and a judge reasonably asks why they wouldn't.
 *
 * Intuition inverts that: at most ~40 words of reading, one thing to drag, and
 * one prediction the student has to commit to before the answer is revealed.
 * Prediction-before-reveal is the highest-yield intervention that is also
 * inherently interactive, and a wrong prediction is a real misconception datum
 * rather than a lost turn.
 *
 * The grammar is deliberately tiny — two visual kinds and one parameter. A
 * model asked to emit arbitrary SVG or component code will eventually emit
 * something unrenderable, and a blank screen mid-demo is far worse than a
 * plainer visual. Everything here is validated and clamped on arrival
 * (see the server's intuitionService), and there is always a deterministic
 * fallback spec, so this screen cannot fail to render.
 */

/**
 * `curves`  — plot one or more functions of `x`, reshaped live by the slider `t`.
 *             Covers most of calculus, kinematics, growth/decay, waves, optics.
 * `stages`  — an ordered process, one stage highlighted as the slider advances.
 *             Covers the many concepts that are a sequence rather than a function
 *             (a reaction, mitosis, a proof's steps).
 */
export type IntuitionVisualKind = 'curves' | 'stages';

/**
 * A single plotted function. `expr` is evaluated by the client's own small
 * expression evaluator — NOT eval() — in terms of two free variables:
 *   x  the horizontal domain
 *   t  the slider's current value
 */
export interface IntuitionCurve {
  id: string;
  label: string;
  expr: string;
  /** `primary` is the curve the concept is about; `secondary` is context. */
  role: 'primary' | 'secondary';
}

/** The one thing the student can drag. Exactly one — never a control panel. */
export interface IntuitionParam {
  label: string;
  min: number;
  max: number;
  step: number;
  unit?: string;
}

/** One step of a `stages` visual. `detail` is a phrase, not a sentence. */
export interface IntuitionStage {
  id: string;
  label: string;
  detail: string;
}

/**
 * A candidate answer to the prediction. For `curves` it carries its own `expr`
 * so a wrong guess can be drawn *next to* the truth — seeing your own predicted
 * shape fail is the moment the misconception dies.
 */
export interface IntuitionPredictOption {
  id: string;
  label: string;
  expr?: string;
  stage_id?: string;
}

export interface IntuitionPredict {
  question: string;
  options: IntuitionPredictOption[];
  correct_id: string;
  /** The one-line reason, revealed only after the student has committed. */
  why: string;
}

export interface IntuitionSpec {
  node_id: string;
  kind: IntuitionVisualKind;
  title: string;
  /**
   * What the student should be able to do after this screen, in one line.
   *
   * This is the contract between Intuition and the Quiz. Both used to be
   * independent model calls given only a node label, and they diverged badly —
   * a visual about a parabola's derivative followed by questions on PCA
   * eigenvectors. Since a passed quiz is the ONLY route to green, testing a
   * different facet than the one just taught makes green measure luck instead
   * of understanding. Quiz generation reads this and anchors its questions to it
   * (see server/src/services/conceptFocus.ts).
   */
  objective: string;
  caption: string;
  param: IntuitionParam;
  domain: [number, number];
  range: [number, number];
  curves: IntuitionCurve[];
  stages: IntuitionStage[];
  predict: IntuitionPredict;
  /** false when this is the deterministic fallback rather than model output. */
  generated: boolean;
}

/**
 * Hard caps, enforced server-side on arrival rather than merely requested in
 * the prompt. The entire premise is that this screen is short; a model that
 * ignores "keep it brief" must not be able to reintroduce the wall of text
 * this module exists to delete.
 */
export const INTUITION_LIMITS = {
  objectiveWords: 18,
  captionWords: 12,
  questionWords: 16,
  optionWords: 8,
  whyWords: 24,
  titleWords: 8,
  maxCurves: 3,
  maxStages: 5,
  minOptions: 2,
  maxOptions: 3,
} as const;

/** Words, counted the way the caps above mean it. */
export function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

// ---------------------------------------------------------------------------
// Status color palette (shared so backend logs + frontend render agree)
// ---------------------------------------------------------------------------

export const STATUS_COLORS: Record<Status, string> = {
  red: '#ff3b5c',
  amber: '#ffb020',
  green: '#28e0a0',
};

/** Mastery score computation: status floor blended with last quiz score. */
export function computeMasteryScore(node: Pick<Node, 'status' | 'last_quiz_result' | 'engaged_at'>): number {
  switch (node.status) {
    case 'green':
      // Green means they passed — reflect the actual score (>= threshold).
      return node.last_quiz_result ? Math.max(QUIZ_PASS_THRESHOLD, Math.round(node.last_quiz_result.score)) : 90;
    case 'amber':
      // Engaged but unproven — or dropped from green on a failed retest.
      if (node.last_quiz_result && !node.last_quiz_result.passed) {
        // failed retest: reflect the failing score, floored so it still reads "amber"
        return Math.min(69, Math.max(35, Math.round(node.last_quiz_result.score)));
      }
      return 50;
    case 'red':
    default:
      return node.last_quiz_result ? Math.min(30, Math.round(node.last_quiz_result.score)) : 12;
  }
}

export * from './mathExpr.js';
