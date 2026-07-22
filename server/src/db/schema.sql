-- Zynth SQLite schema.
-- Idempotent: every statement is CREATE ... IF NOT EXISTS so runMigrations()
-- can be called on every boot safely.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- students
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- ---------------------------------------------------------------------------
-- agent_configs — persona configuration, not per-student data, but stored so
-- it's introspectable / editable without a redeploy.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS agent_configs (
  name TEXT PRIMARY KEY,
  system_prompt TEXT NOT NULL,
  model TEXT NOT NULL,
  temperature REAL
);

-- ---------------------------------------------------------------------------
-- nodes — the core knowledge-graph concept table.
-- status ONLY ever changes via server/src/services/statusService.ts, which is
-- itself backstopped by the nodes_status_guard trigger below. There is no
-- generic "set status" path anywhere in this schema or the app.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  label TEXT NOT NULL,
  subject TEXT NOT NULL,
  cluster TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('red', 'amber', 'green')),
  mastery_score INTEGER NOT NULL DEFAULT 0,
  engaged_at TEXT,                 -- NULL until first War Room/Explain interaction
  last_quiz_passed_at TEXT,        -- NULL until a passing quiz is recorded
  last_quiz_result TEXT,           -- JSON QuizResultSummary | NULL
  retest_count INTEGER NOT NULL DEFAULT 0,
  history TEXT NOT NULL DEFAULT '[]', -- JSON StatusHistoryEntry[]
  x REAL,
  y REAL,
  z REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_nodes_student ON nodes(student_id);

-- NOTE on INSERT: this trigger only guards UPDATE OF status. INSERTs may set
-- any initial status freely (this is required for seeding — a seeded node can
-- be born green with engaged_at/last_quiz_passed_at already set, since it
-- represents a concept the student mastered before the app existed). Once a
-- row exists, all further status changes must go through the legal table.
CREATE TRIGGER IF NOT EXISTS nodes_status_guard
BEFORE UPDATE OF status ON nodes
FOR EACH ROW
WHEN NEW.status <> OLD.status AND NOT (
  -- red -> amber: engaged_at must transition from NULL to set
  (OLD.status='red'   AND NEW.status='amber' AND OLD.engaged_at IS NULL AND NEW.engaged_at IS NOT NULL) OR
  -- amber -> green: a NEW passing quiz must have been recorded
  (OLD.status='amber' AND NEW.status='green' AND NEW.last_quiz_passed_at IS NOT NULL
     AND (OLD.last_quiz_passed_at IS NULL OR NEW.last_quiz_passed_at <> OLD.last_quiz_passed_at)) OR
  -- green -> amber: only on a failed retest (retest_count incremented)
  (OLD.status='green' AND NEW.status='amber' AND NEW.retest_count > OLD.retest_count)
)
BEGIN
  SELECT RAISE(ABORT, 'Illegal Node.status transition: ' || OLD.status || '->' || NEW.status);
END;

-- ---------------------------------------------------------------------------
-- edges — relationships between concepts.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS edges (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  source_node_id TEXT NOT NULL REFERENCES nodes(id),
  target_node_id TEXT NOT NULL REFERENCES nodes(id),
  relationship_type TEXT NOT NULL CHECK (relationship_type IN ('prerequisite', 'correlated_error', 'related_topic')),
  strength REAL NOT NULL DEFAULT 1,
  discovered_by TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_edges_student ON edges(student_id);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source_node_id);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target_node_id);

-- ---------------------------------------------------------------------------
-- mistake_records
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS mistake_records (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  node_id TEXT NOT NULL REFERENCES nodes(id),
  source TEXT NOT NULL CHECK (source IN ('uploaded_homework', 'quiz', 'exam_sim')),
  raw_excerpt TEXT NOT NULL,
  error_type TEXT NOT NULL CHECK (error_type IN ('concept_gap', 'careless_slip', 'prerequisite_gap')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_mistakes_student ON mistake_records(student_id);
CREATE INDEX IF NOT EXISTS idx_mistakes_node ON mistake_records(node_id);

-- ---------------------------------------------------------------------------
-- quiz_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS quiz_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  node_ids TEXT NOT NULL,     -- JSON string[]
  questions TEXT NOT NULL,    -- JSON QuizQuestion[]
  score INTEGER NOT NULL,
  passed INTEGER NOT NULL,    -- 0/1
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_quiz_sessions_student ON quiz_sessions(student_id);

-- ---------------------------------------------------------------------------
-- war_room_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS war_room_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  node_id TEXT NOT NULL REFERENCES nodes(id),
  transcript TEXT NOT NULL DEFAULT '[]', -- JSON WarRoomMessage[]
  outcome TEXT,                          -- 'understood' | 'still_confused' | NULL
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_war_room_student ON war_room_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_war_room_node ON war_room_sessions(node_id);

-- ---------------------------------------------------------------------------
-- explain_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS explain_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  node_id TEXT NOT NULL REFERENCES nodes(id),
  messages TEXT NOT NULL DEFAULT '[]', -- JSON ExplainMessage[]
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_explain_student ON explain_sessions(student_id);
CREATE INDEX IF NOT EXISTS idx_explain_node ON explain_sessions(node_id);

-- ---------------------------------------------------------------------------
-- exam_sim_sessions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS exam_sim_sessions (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  source_paper TEXT NOT NULL,
  questions TEXT NOT NULL DEFAULT '[]',          -- JSON QuizQuestion[]
  live_reasoning_log TEXT NOT NULL DEFAULT '[]', -- JSON ExamReasoningEntry[]
  node_results TEXT NOT NULL DEFAULT '[]',       -- JSON ExamNodeResult[]
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_exam_sim_student ON exam_sim_sessions(student_id);

-- ---------------------------------------------------------------------------
-- plan_paths
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS plan_paths (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  goal TEXT NOT NULL,
  node_sequence TEXT NOT NULL DEFAULT '[]', -- JSON string[]
  current_position INTEGER NOT NULL DEFAULT 0,
  last_replanned_at TEXT,
  replanned_because TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE INDEX IF NOT EXISTS idx_plan_paths_student ON plan_paths(student_id);
