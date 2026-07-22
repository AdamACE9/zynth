/**
 * Typed CRUD over the raw SQLite rows, (de)serializing JSON columns into the
 * @zynth/shared types. This is the ONLY place that knows about SQL column
 * shapes — everything above this layer talks in shared types.
 *
 * IMPORTANT: `nodesRepo.updateStatusFields` is a low-level write used ONLY by
 * server/src/services/statusService.ts. Nothing else may call it. There is no
 * generic "update node status" export anywhere in this repo.
 */
import { db } from './connection';
import type {
  AgentConfig,
  AgentName,
  Edge,
  ExamSimSession,
  ExplainSession,
  MistakeRecord,
  Node,
  PlanPath,
  QuizSession,
  RelationshipType,
  Status,
  StatusHistoryEntry,
  WarRoomSession,
} from '@zynth/shared';

// ---------------------------------------------------------------------------
// row shapes (raw SQLite representation, JSON columns still as strings)
// ---------------------------------------------------------------------------

interface NodeRow {
  id: string;
  student_id: string;
  label: string;
  subject: string;
  cluster: string;
  status: Status;
  mastery_score: number;
  engaged_at: string | null;
  last_quiz_passed_at: string | null;
  last_quiz_result: string | null;
  retest_count: number;
  history: string;
  x: number | null;
  y: number | null;
  z: number | null;
  created_at: string;
  updated_at: string;
}

function rowToNode(row: NodeRow): Node {
  return {
    id: row.id,
    student_id: row.student_id,
    label: row.label,
    subject: row.subject,
    cluster: row.cluster,
    status: row.status,
    mastery_score: row.mastery_score,
    engaged_at: row.engaged_at,
    last_quiz_passed_at: row.last_quiz_passed_at,
    last_quiz_result: row.last_quiz_result ? JSON.parse(row.last_quiz_result) : null,
    retest_count: row.retest_count,
    history: JSON.parse(row.history) as StatusHistoryEntry[],
    x: row.x,
    y: row.y,
    z: row.z,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

export const nodesRepo = {
  getAll(studentId: string): Node[] {
    const rows = db
      .prepare('SELECT * FROM nodes WHERE student_id = ? ORDER BY subject, label')
      .all(studentId) as NodeRow[];
    return rows.map(rowToNode);
  },

  getById(id: string): Node | undefined {
    const row = db.prepare('SELECT * FROM nodes WHERE id = ?').get(id) as NodeRow | undefined;
    return row ? rowToNode(row) : undefined;
  },

  /** Full insert — used by seeding. Any initial status is legal on INSERT. */
  insert(node: Node): void {
    db.prepare(
      `INSERT INTO nodes (
        id, student_id, label, subject, cluster, status, mastery_score,
        engaged_at, last_quiz_passed_at, last_quiz_result, retest_count,
        history, x, y, z, created_at, updated_at
      ) VALUES (
        @id, @student_id, @label, @subject, @cluster, @status, @mastery_score,
        @engaged_at, @last_quiz_passed_at, @last_quiz_result, @retest_count,
        @history, @x, @y, @z, @created_at, @updated_at
      )`,
    ).run({
      id: node.id,
      student_id: node.student_id,
      label: node.label,
      subject: node.subject,
      cluster: node.cluster,
      status: node.status,
      mastery_score: node.mastery_score,
      engaged_at: node.engaged_at,
      last_quiz_passed_at: node.last_quiz_passed_at,
      last_quiz_result: node.last_quiz_result ? JSON.stringify(node.last_quiz_result) : null,
      retest_count: node.retest_count,
      history: JSON.stringify(node.history),
      x: node.x,
      y: node.y,
      z: node.z,
      created_at: node.created_at,
      updated_at: node.updated_at,
    });
  },

  deleteAllForStudent(studentId: string): void {
    db.prepare('DELETE FROM nodes WHERE student_id = ?').run(studentId);
  },

  /**
   * LOW-LEVEL write. ONLY statusService may call this — it is the single
   * point where Node.status is ever assigned a new value, and the write is
   * still validated by the nodes_status_guard SQLite trigger even here.
   */
  updateStatusFields(
    id: string,
    fields: {
      status: Status;
      mastery_score: number;
      engaged_at: string | null;
      last_quiz_passed_at: string | null;
      last_quiz_result: string | null; // pre-serialized JSON or null
      retest_count: number;
      history: string; // pre-serialized JSON
      updated_at: string;
    },
  ): void {
    db.prepare(
      `UPDATE nodes SET
        status = @status,
        mastery_score = @mastery_score,
        engaged_at = @engaged_at,
        last_quiz_passed_at = @last_quiz_passed_at,
        last_quiz_result = @last_quiz_result,
        retest_count = @retest_count,
        history = @history,
        updated_at = @updated_at
      WHERE id = @id`,
    ).run({ id, ...fields });
  },
};

// ---------------------------------------------------------------------------
// edges
// ---------------------------------------------------------------------------

interface EdgeRow {
  id: string;
  student_id: string;
  source_node_id: string;
  target_node_id: string;
  relationship_type: RelationshipType;
  strength: number;
  discovered_by: string;
  created_at: string;
}

function rowToEdge(row: EdgeRow): Edge {
  return { ...row };
}

export const edgesRepo = {
  getAll(studentId: string): Edge[] {
    const rows = db
      .prepare('SELECT * FROM edges WHERE student_id = ?')
      .all(studentId) as EdgeRow[];
    return rows.map(rowToEdge);
  },

  insert(edge: Edge): void {
    db.prepare(
      `INSERT INTO edges (
        id, student_id, source_node_id, target_node_id, relationship_type, strength, discovered_by, created_at
      ) VALUES (
        @id, @student_id, @source_node_id, @target_node_id, @relationship_type, @strength, @discovered_by, @created_at
      )`,
    ).run(edge);
  },

  deleteAllForStudent(studentId: string): void {
    db.prepare('DELETE FROM edges WHERE student_id = ?').run(studentId);
  },

  /**
   * Looks for an existing edge of `relationshipType` connecting these two
   * nodes in EITHER direction (source/target swapped counts as the same
   * edge for idempotency purposes). Used by Autopsy to avoid inserting
   * duplicate correlated_error edges on repeated runs.
   */
  findBetween(sourceId: string, targetId: string, relationshipType: RelationshipType): Edge | null {
    const row = db
      .prepare(
        `SELECT * FROM edges
         WHERE relationship_type = ?
           AND (
             (source_node_id = ? AND target_node_id = ?) OR
             (source_node_id = ? AND target_node_id = ?)
           )
         LIMIT 1`,
      )
      .get(relationshipType, sourceId, targetId, targetId, sourceId) as EdgeRow | undefined;
    return row ? rowToEdge(row) : null;
  },
};

// ---------------------------------------------------------------------------
// students
// ---------------------------------------------------------------------------

export const studentsRepo = {
  upsert(id: string, name: string): void {
    db.prepare(
      `INSERT INTO students (id, name) VALUES (?, ?)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name`,
    ).run(id, name);
  },

  exists(id: string): boolean {
    const row = db.prepare('SELECT 1 FROM students WHERE id = ?').get(id);
    return !!row;
  },
};

// ---------------------------------------------------------------------------
// agent_configs
// ---------------------------------------------------------------------------

interface AgentConfigRow {
  name: AgentName;
  system_prompt: string;
  model: string;
  temperature: number | null;
}

export const agentConfigsRepo = {
  upsert(cfg: AgentConfig): void {
    db.prepare(
      `INSERT INTO agent_configs (name, system_prompt, model, temperature) VALUES (@name, @system_prompt, @model, @temperature)
       ON CONFLICT(name) DO UPDATE SET system_prompt = excluded.system_prompt, model = excluded.model, temperature = excluded.temperature`,
    ).run({ ...cfg, temperature: cfg.temperature ?? null });
  },

  getAll(): AgentConfig[] {
    const rows = db.prepare('SELECT * FROM agent_configs').all() as AgentConfigRow[];
    return rows.map((r) => ({
      name: r.name,
      system_prompt: r.system_prompt,
      model: r.model,
      temperature: r.temperature ?? undefined,
    }));
  },

  getByName(name: AgentName): AgentConfig | undefined {
    const row = db.prepare('SELECT * FROM agent_configs WHERE name = ?').get(name) as
      | AgentConfigRow
      | undefined;
    if (!row) return undefined;
    return {
      name: row.name,
      system_prompt: row.system_prompt,
      model: row.model,
      temperature: row.temperature ?? undefined,
    };
  },
};

// ---------------------------------------------------------------------------
// mistake_records
// ---------------------------------------------------------------------------

export const mistakeRecordsRepo = {
  insert(record: MistakeRecord): void {
    db.prepare(
      `INSERT INTO mistake_records (id, student_id, node_id, source, raw_excerpt, error_type, created_at)
       VALUES (@id, @student_id, @node_id, @source, @raw_excerpt, @error_type, @created_at)`,
    ).run(record);
  },

  getByNode(nodeId: string): MistakeRecord[] {
    return db.prepare('SELECT * FROM mistake_records WHERE node_id = ?').all(nodeId) as MistakeRecord[];
  },

  getByStudent(studentId: string): MistakeRecord[] {
    return db
      .prepare('SELECT * FROM mistake_records WHERE student_id = ? ORDER BY created_at')
      .all(studentId) as MistakeRecord[];
  },
};

// ---------------------------------------------------------------------------
// quiz_sessions
// ---------------------------------------------------------------------------

interface QuizSessionRow {
  id: string;
  student_id: string;
  node_ids: string;
  questions: string;
  score: number;
  passed: number;
  created_at: string;
}

function rowToQuizSession(row: QuizSessionRow): QuizSession {
  return {
    id: row.id,
    student_id: row.student_id,
    node_ids: JSON.parse(row.node_ids),
    questions: JSON.parse(row.questions),
    score: row.score,
    passed: !!row.passed,
    created_at: row.created_at,
  };
}

export const quizSessionsRepo = {
  insert(session: QuizSession): void {
    db.prepare(
      `INSERT INTO quiz_sessions (id, student_id, node_ids, questions, score, passed, created_at)
       VALUES (@id, @student_id, @node_ids, @questions, @score, @passed, @created_at)`,
    ).run({
      id: session.id,
      student_id: session.student_id,
      node_ids: JSON.stringify(session.node_ids),
      questions: JSON.stringify(session.questions),
      score: session.score,
      passed: session.passed ? 1 : 0,
      created_at: session.created_at,
    });
  },

  getById(id: string): QuizSession | undefined {
    const row = db.prepare('SELECT * FROM quiz_sessions WHERE id = ?').get(id) as
      | QuizSessionRow
      | undefined;
    return row ? rowToQuizSession(row) : undefined;
  },
};

// ---------------------------------------------------------------------------
// war_room_sessions
// ---------------------------------------------------------------------------

interface WarRoomSessionRow {
  id: string;
  student_id: string;
  node_id: string;
  transcript: string;
  outcome: string | null;
  created_at: string;
}

function rowToWarRoomSession(row: WarRoomSessionRow): WarRoomSession {
  return {
    id: row.id,
    student_id: row.student_id,
    node_id: row.node_id,
    transcript: JSON.parse(row.transcript),
    outcome: (row.outcome as WarRoomSession['outcome']) ?? null,
    created_at: row.created_at,
  };
}

export const warRoomSessionsRepo = {
  insert(session: WarRoomSession): void {
    db.prepare(
      `INSERT INTO war_room_sessions (id, student_id, node_id, transcript, outcome, created_at)
       VALUES (@id, @student_id, @node_id, @transcript, @outcome, @created_at)`,
    ).run({
      id: session.id,
      student_id: session.student_id,
      node_id: session.node_id,
      transcript: JSON.stringify(session.transcript),
      outcome: session.outcome,
      created_at: session.created_at,
    });
  },

  getById(id: string): WarRoomSession | undefined {
    const row = db.prepare('SELECT * FROM war_room_sessions WHERE id = ?').get(id) as
      | WarRoomSessionRow
      | undefined;
    return row ? rowToWarRoomSession(row) : undefined;
  },
};

// ---------------------------------------------------------------------------
// explain_sessions
// ---------------------------------------------------------------------------

interface ExplainSessionRow {
  id: string;
  student_id: string;
  node_id: string;
  messages: string;
  created_at: string;
}

function rowToExplainSession(row: ExplainSessionRow): ExplainSession {
  return {
    id: row.id,
    student_id: row.student_id,
    node_id: row.node_id,
    messages: JSON.parse(row.messages),
    created_at: row.created_at,
  };
}

export const explainSessionsRepo = {
  insert(session: ExplainSession): void {
    db.prepare(
      `INSERT INTO explain_sessions (id, student_id, node_id, messages, created_at)
       VALUES (@id, @student_id, @node_id, @messages, @created_at)`,
    ).run({
      id: session.id,
      student_id: session.student_id,
      node_id: session.node_id,
      messages: JSON.stringify(session.messages),
      created_at: session.created_at,
    });
  },

  getById(id: string): ExplainSession | undefined {
    const row = db.prepare('SELECT * FROM explain_sessions WHERE id = ?').get(id) as
      | ExplainSessionRow
      | undefined;
    return row ? rowToExplainSession(row) : undefined;
  },

  /** Most recent ExplainSession for this student+node, or null if none exists yet. */
  getByNode(studentId: string, nodeId: string): ExplainSession | null {
    const row = db
      .prepare(
        `SELECT * FROM explain_sessions
         WHERE student_id = ? AND node_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
      )
      .get(studentId, nodeId) as ExplainSessionRow | undefined;
    return row ? rowToExplainSession(row) : null;
  },

  update(id: string, patch: { messages: ExplainSession['messages'] }): void {
    db.prepare('UPDATE explain_sessions SET messages = @messages WHERE id = @id').run({
      id,
      messages: JSON.stringify(patch.messages),
    });
  },
};

// ---------------------------------------------------------------------------
// exam_sim_sessions
// ---------------------------------------------------------------------------

interface ExamSimSessionRow {
  id: string;
  student_id: string;
  source_paper: string;
  questions: string;
  live_reasoning_log: string;
  node_results: string;
  created_at: string;
}

function rowToExamSimSession(row: ExamSimSessionRow): ExamSimSession {
  return {
    id: row.id,
    student_id: row.student_id,
    source_paper: row.source_paper,
    questions: JSON.parse(row.questions),
    live_reasoning_log: JSON.parse(row.live_reasoning_log),
    node_results: JSON.parse(row.node_results),
    created_at: row.created_at,
  };
}

export const examSimSessionsRepo = {
  insert(session: ExamSimSession): void {
    db.prepare(
      `INSERT INTO exam_sim_sessions (id, student_id, source_paper, questions, live_reasoning_log, node_results, created_at)
       VALUES (@id, @student_id, @source_paper, @questions, @live_reasoning_log, @node_results, @created_at)`,
    ).run({
      id: session.id,
      student_id: session.student_id,
      source_paper: session.source_paper,
      questions: JSON.stringify(session.questions),
      live_reasoning_log: JSON.stringify(session.live_reasoning_log),
      node_results: JSON.stringify(session.node_results),
      created_at: session.created_at,
    });
  },

  getById(id: string): ExamSimSession | undefined {
    const row = db.prepare('SELECT * FROM exam_sim_sessions WHERE id = ?').get(id) as
      | ExamSimSessionRow
      | undefined;
    return row ? rowToExamSimSession(row) : undefined;
  },
};

// ---------------------------------------------------------------------------
// plan_paths
// ---------------------------------------------------------------------------

interface PlanPathRow {
  id: string;
  student_id: string;
  goal: string;
  node_sequence: string;
  current_position: number;
  last_replanned_at: string | null;
  replanned_because: string | null;
  created_at: string;
}

function rowToPlanPath(row: PlanPathRow): PlanPath {
  return {
    id: row.id,
    student_id: row.student_id,
    goal: row.goal,
    node_sequence: JSON.parse(row.node_sequence),
    current_position: row.current_position,
    last_replanned_at: row.last_replanned_at,
    replanned_because: row.replanned_because,
    created_at: row.created_at,
  };
}

export const planPathsRepo = {
  insert(plan: PlanPath): void {
    db.prepare(
      `INSERT INTO plan_paths (id, student_id, goal, node_sequence, current_position, last_replanned_at, replanned_because, created_at)
       VALUES (@id, @student_id, @goal, @node_sequence, @current_position, @last_replanned_at, @replanned_because, @created_at)`,
    ).run({
      id: plan.id,
      student_id: plan.student_id,
      goal: plan.goal,
      node_sequence: JSON.stringify(plan.node_sequence),
      current_position: plan.current_position,
      last_replanned_at: plan.last_replanned_at,
      replanned_because: plan.replanned_because,
      created_at: plan.created_at,
    });
  },

  getById(id: string): PlanPath | undefined {
    const row = db.prepare('SELECT * FROM plan_paths WHERE id = ?').get(id) as
      | PlanPathRow
      | undefined;
    return row ? rowToPlanPath(row) : undefined;
  },
};
