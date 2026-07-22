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
