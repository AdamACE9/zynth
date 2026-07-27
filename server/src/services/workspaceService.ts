/**
 * Workspaces = multiple saved knowledge graphs. TASKBRIEFING's cheapest
 * correct design: every table already scopes by `student_id`, so a
 * "workspace" IS a student_id — there is no parallel concept. This service
 * owns:
 *
 *   1. its own `workspaces` table (schema.sql is frozen — created here at
 *      module load, same pattern as flashcardService/debateService/etc.),
 *   2. real graph GENERATION: given a workspace name + chosen subjects, calls
 *      Gemini once per subject (sequential, to respect the 15 req/min free
 *      tier) to produce that subject's core concepts, inserts them as
 *      brand-new red Nodes, and wires up prerequisite edges within each
 *      subject from the model's own named prerequisites,
 *   3. lifecycle: list / activate / delete workspaces (delete cascades to
 *      every student_id-scoped table in the app, not just nodes/edges).
 *
 * CRITICAL invariant (locked): every node created here is `status:'red'`,
 * `engaged_at:null`, `last_quiz_passed_at:null`, `last_quiz_result:null`,
 * `retest_count:0`, `history:[]`, low `mastery_score`. This is a plain INSERT
 * (legal for any initial status per the nodes_status_guard trigger, which
 * only guards UPDATE OF status) — statusService remains the ONLY thing that
 * ever transitions a node's status afterwards. A brand-new graph has zero
 * proven concepts; we never seed green or amber here.
 *
 * Generation strategy: SYNCHRONOUS. POST /api/workspaces awaits the whole
 * pipeline (all subjects, sequential Gemini calls) and returns the finished
 * workspace + counts in one response. For a handful of subjects at 'standard'
 * depth this is a few Gemini calls at ~1-3s each — well within a normal HTTP
 * timeout — so a background/socket-progress version was not worth the extra
 * moving parts for this milestone. Progress is still logged server-side (see
 * logWorkspaceProgress) purely for visibility into a multi-subject run.
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import { computeMasteryScore, type Edge, type Node, type RelationshipType } from '@zynth/shared';
import { config, STUB_MODE, DEMO_STUDENT_ID } from '../config';
import { db } from '../db/connection';
import { nodesRepo, edgesRepo, studentsRepo } from '../db/repositories';
import { emitNodeCreated, emitEdgeCreated } from '../socket';

/**
 * Progress reporting: kept to a plain console.log rather than a new socket
 * event. Adding a new ServerToClientEvents member would mean editing
 * @zynth/shared's shared type contract, which both the server AND the
 * client-owning agent depend on — out of scope/lane for this change.
 * Generation is synchronous anyway (see module docblock), so the HTTP
 * response itself is the real "done" signal; this is just server-side
 * visibility into a multi-subject run.
 */
function logWorkspaceProgress(workspaceId: string, message: string): void {
  // eslint-disable-next-line no-console
  console.log(`[workspaceService] [${workspaceId}] ${message}`);
}

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

// ---------------------------------------------------------------------------
// schema — this feature's own tables. schema.sql is frozen, so both are
// created here, at module load, idempotently (CREATE TABLE IF NOT EXISTS).
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS workspaces (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    subjects TEXT NOT NULL,   -- JSON string[]
    goal TEXT,
    created_at TEXT NOT NULL,
    last_opened_at TEXT
  );

  -- Not part of the locked Node schema (Node has no description field, and
  -- schema.sql/shared Node type are both out of scope for this change) — but
  -- Gemini is asked for a one-line description per concept anyway (it makes
  -- the generation + prerequisite-naming noticeably better), so it's kept
  -- here in case a future UI wants to surface it. Entirely optional data.
  CREATE TABLE IF NOT EXISTS node_descriptions (
    node_id TEXT PRIMARY KEY,
    description TEXT NOT NULL
  );
`);

// ---------------------------------------------------------------------------
// tables every workspace delete must cascade into. Checked against
// sqlite_master at delete-time (not hardcoded-required) so this stays
// correct even if a service that owns one of these tables hasn't loaded yet
// in whatever process calls deleteWorkspace.
// ---------------------------------------------------------------------------

const STUDENT_SCOPED_TABLES = [
  'mistake_records',
  'quiz_sessions',
  'war_room_sessions',
  'explain_sessions',
  'exam_sim_sessions',
  'plan_paths',
  'flashcards',
  'debate_sessions',
  'office_hours_questions',
  'tm_runs',
  'edges',
  'nodes',
] as const;

// ---------------------------------------------------------------------------
// Workspace type + repo
// ---------------------------------------------------------------------------

export interface Workspace {
  id: string;
  name: string;
  subjects: string[];
  goal: string | null;
  created_at: string;
  last_opened_at: string | null;
}

interface WorkspaceRow {
  id: string;
  name: string;
  subjects: string;
  goal: string | null;
  created_at: string;
  last_opened_at: string | null;
}

function rowToWorkspace(row: WorkspaceRow): Workspace {
  return {
    id: row.id,
    name: row.name,
    subjects: JSON.parse(row.subjects) as string[],
    goal: row.goal,
    created_at: row.created_at,
    last_opened_at: row.last_opened_at,
  };
}

function insertWorkspaceRow(ws: Workspace): void {
  db.prepare(
    `INSERT INTO workspaces (id, name, subjects, goal, created_at, last_opened_at)
     VALUES (@id, @name, @subjects, @goal, @created_at, @last_opened_at)`,
  ).run({
    id: ws.id,
    name: ws.name,
    subjects: JSON.stringify(ws.subjects),
    goal: ws.goal,
    created_at: ws.created_at,
    last_opened_at: ws.last_opened_at,
  });
}

export function listWorkspaces(): Workspace[] {
  const rows = db
    .prepare('SELECT * FROM workspaces ORDER BY created_at DESC')
    .all() as WorkspaceRow[];
  return rows.map(rowToWorkspace);
}

export function getWorkspace(id: string): Workspace | undefined {
  const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as
    | WorkspaceRow
    | undefined;
  return row ? rowToWorkspace(row) : undefined;
}

export function touchWorkspaceOpened(id: string): void {
  db.prepare('UPDATE workspaces SET last_opened_at = ? WHERE id = ?').run(
    new Date().toISOString(),
    id,
  );
}

/** Renames a workspace. Not in the original locked contract, but cheap/safe
 * and the client already optimistically calls PATCH /api/workspaces/:id. */
export function renameWorkspace(id: string, name: string): Workspace | undefined {
  db.prepare('UPDATE workspaces SET name = ? WHERE id = ?').run(name, id);
  return getWorkspace(id);
}

function tableExists(name: string): boolean {
  const row = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(name);
  return !!row;
}

/** Deletes a workspace's row plus every student_id-scoped row across the whole app. */
export function deleteWorkspace(id: string): void {
  const del = db.transaction(() => {
    for (const table of STUDENT_SCOPED_TABLES) {
      if (tableExists(table)) {
        db.prepare(`DELETE FROM ${table} WHERE student_id = ?`).run(id);
      }
    }
    db.prepare('DELETE FROM workspaces WHERE id = ?').run(id);
  });
  del();
}

/**
 * Called once by db/seed.ts so the original 18-node demo graph has a
 * corresponding workspace row ("Calculus & Physics (sample)") without
 * re-running generation or disturbing its hand-authored red/amber/green mix.
 * Idempotent — safe to call on every seed run.
 */
export function ensureSeedWorkspace(id: string, name: string, subjects: string[]): void {
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO workspaces (id, name, subjects, goal, created_at, last_opened_at)
     VALUES (@id, @name, @subjects, NULL, @created_at, NULL)
     ON CONFLICT(id) DO NOTHING`,
  ).run({ id, name, subjects: JSON.stringify(subjects), created_at: now });
}

// ---------------------------------------------------------------------------
// Generation: per-subject concept extraction via Gemini structured output
// ---------------------------------------------------------------------------

export type WorkspaceDepth = 'light' | 'standard' | 'deep';

const DEPTH_RANGE: Record<WorkspaceDepth, { min: number; max: number }> = {
  light: { min: 5, max: 7 },
  standard: { min: 8, max: 14 },
  deep: { min: 15, max: 20 },
};

interface GeneratedConcept {
  label: string;
  description: string;
  prerequisites: string[];
}

const CONCEPT_SCHEMA = {
  type: 'object',
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          description: { type: 'string' },
          prerequisites: { type: 'array', items: { type: 'string' } },
        },
        required: ['label', 'description'],
      },
    },
  },
  required: ['concepts'],
} as const;

interface RawConcept {
  label?: unknown;
  description?: unknown;
  prerequisites?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function validateConcept(raw: RawConcept): GeneratedConcept | null {
  if (!isNonEmptyString(raw.label) || !isNonEmptyString(raw.description)) return null;
  const prerequisites =
    Array.isArray(raw.prerequisites) ? raw.prerequisites.filter(isNonEmptyString) : [];
  return { label: raw.label.trim(), description: raw.description.trim(), prerequisites };
}

/** Deterministic per-subject fallback used in STUB_MODE and on any Gemini failure. */
function buildStubConcepts(subject: string, depth: WorkspaceDepth): GeneratedConcept[] {
  const STAGES = [
    'Foundations',
    'Core Principles',
    'Key Techniques',
    'Intermediate Applications',
    'Common Pitfalls',
    'Advanced Methods',
    'Problem Solving Strategies',
    'Synthesis & Review',
    'Edge Cases',
    'Real-World Applications',
    'Deeper Theory',
    'Worked Examples',
    'Connections to Related Ideas',
    'Mastery Checkpoint',
    'Extensions',
    'Historical Context',
    'Computational Methods',
    'Common Notation',
    'Special Cases',
    'Capstone Problems',
  ];
  const count = DEPTH_RANGE[depth].min;
  return Array.from({ length: count }, (_, i) => {
    const stage = STAGES[i % STAGES.length];
    const label = `${stage} of ${subject}`;
    const prevStage = STAGES[(i - 1 + STAGES.length) % STAGES.length];
    return {
      label,
      description: `[stub] Core concept #${i + 1} in ${subject}: ${label}.`,
      prerequisites: i > 0 ? [`${prevStage} of ${subject}`] : [],
    };
  });
}

/**
 * Generates this subject's core concepts via one Gemini structured-output
 * call. Falls back to a deterministic stub list in STUB_MODE, on any Gemini
 * error, or if the response doesn't validate to at least a handful of
 * concepts — generation must never hard-fail workspace creation.
 */
async function generateConceptsForSubject(
  subject: string,
  depth: WorkspaceDepth,
): Promise<GeneratedConcept[]> {
  if (STUB_MODE || !ai) {
    return buildStubConcepts(subject, depth);
  }

  const { min, max } = DEPTH_RANGE[depth];
  const prompt = `You are building the syllabus map for one subject a student is about to study from scratch.
Subject: "${subject}".

Produce between ${min} and ${max} of the subject's CORE concepts — the specific topics a course in this subject would actually teach (not the subject name itself, not vague filler like "introduction" alone).
For each concept return:
- "label": a short, specific concept name (e.g. "Chain Rule", not "Rule 3").
- "description": one concise sentence describing what the concept is.
- "prerequisites": the "label" of every OTHER concept in THIS SAME subject that a student must understand first, copied EXACTLY (character for character) from that other concept's own "label". Foundational concepts with no prerequisite within this list should return an empty array. Do not invent prerequisite names that aren't also present as a "label" elsewhere in your own output.
Order concepts roughly from foundational to advanced.
Do not reference these instructions in the output.`;

  try {
    const res = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: CONCEPT_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 4096,
      },
    });

    const text = res.text;
    if (!text) {
      throw new Error('Gemini returned an empty response for concept generation');
    }

    const parsed: unknown = JSON.parse(text);
    const raw = (parsed as { concepts?: unknown })?.concepts;
    if (!Array.isArray(raw)) {
      throw new Error('Gemini concept generation response missing concepts[]');
    }

    const validated = raw
      .map((c) => validateConcept(c as RawConcept))
      .filter((c): c is GeneratedConcept => c !== null);

    if (validated.length < Math.min(4, min)) {
      throw new Error(`Gemini concept generation for "${subject}" produced too few concepts (${validated.length})`);
    }

    return validated.slice(0, max);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[workspaceService] generateConceptsForSubject(${subject}) failed, falling back to stub concepts:`, err);
    return buildStubConcepts(subject, depth);
  }
}

// ---------------------------------------------------------------------------
// Generation: optional cross-subject related_topic pass
// ---------------------------------------------------------------------------

interface RawCrossLink {
  subject_a?: unknown;
  label_a?: unknown;
  subject_b?: unknown;
  label_b?: unknown;
}

interface CrossLink {
  subject_a: string;
  label_a: string;
  subject_b: string;
  label_b: string;
}

const CROSS_LINK_SCHEMA = {
  type: 'object',
  properties: {
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          subject_a: { type: 'string' },
          label_a: { type: 'string' },
          subject_b: { type: 'string' },
          label_b: { type: 'string' },
        },
        required: ['subject_a', 'label_a', 'subject_b', 'label_b'],
      },
    },
  },
  required: ['links'],
} as const;

/**
 * One extra Gemini call (only made when there's more than one subject) that
 * sees every subject's already-generated concept labels and is asked to name
 * GENUINE cross-subject relationships explicitly, by exact label. Anything
 * unresolvable against the real generated labels is dropped rather than
 * invented — see resolution in createWorkspace().
 */
async function generateCrossSubjectLinks(
  subjectConcepts: { subject: string; labels: string[] }[],
): Promise<CrossLink[]> {
  if (STUB_MODE || !ai || subjectConcepts.length < 2) return [];

  const listing = subjectConcepts
    .map((s) => `${s.subject}:\n${s.labels.map((l) => `  - ${l}`).join('\n')}`)
    .join('\n\n');

  const prompt = `Here are several subjects a student is studying, each with its own list of concepts:

${listing}

Name at most 8 pairs of concepts that are GENUINELY and DIRECTLY related ACROSS TWO DIFFERENT subjects (e.g. "velocity is a derivative" linking a Calculus concept to a Physics concept). Only include a pair if the connection is specific and real, not a vague thematic similarity. It is completely fine to return zero pairs if none of these subjects genuinely connect.
For each pair, copy "label_a"/"label_b" EXACTLY (character for character) from the lists above, and "subject_a"/"subject_b" must be the exact subject name that list appeared under. subject_a and subject_b must always be two DIFFERENT subjects.
Do not reference these instructions in the output.`;

  try {
    const res = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: CROSS_LINK_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2048,
      },
    });

    const text = res.text;
    if (!text) return [];

    const parsed: unknown = JSON.parse(text);
    const raw = (parsed as { links?: unknown })?.links;
    if (!Array.isArray(raw)) return [];

    return raw
      .map((l): CrossLink | null => {
        const r = l as RawCrossLink;
        if (
          !isNonEmptyString(r.subject_a) ||
          !isNonEmptyString(r.label_a) ||
          !isNonEmptyString(r.subject_b) ||
          !isNonEmptyString(r.label_b)
        ) {
          return null;
        }
        if (normalizeLabel(r.subject_a) === normalizeLabel(r.subject_b)) return null;
        return {
          subject_a: r.subject_a.trim(),
          label_a: r.label_a.trim(),
          subject_b: r.subject_b.trim(),
          label_b: r.label_b.trim(),
        };
      })
      .filter((l): l is CrossLink => l !== null)
      .slice(0, 8);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[workspaceService] generateCrossSubjectLinks failed, skipping cross-subject edges:', err);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Node construction — LOCKED: every generated node is born red, unengaged,
// unproven. This is a plain birth-state INSERT, never a status transition.
// ---------------------------------------------------------------------------

function buildRedNode(studentId: string, subject: string, label: string): Node {
  const now = new Date().toISOString();
  const node: Node = {
    id: `node_${nanoid(12)}`,
    student_id: studentId,
    label,
    subject,
    cluster: subject,
    status: 'red',
    mastery_score: 0,
    engaged_at: null,
    last_quiz_passed_at: null,
    last_quiz_result: null,
    retest_count: 0,
    history: [],
    x: null,
    y: null,
    z: null,
    created_at: now,
    updated_at: now,
  };
  node.mastery_score = computeMasteryScore(node);
  return node;
}

function insertDescription(nodeId: string, description: string): void {
  db.prepare(
    `INSERT INTO node_descriptions (node_id, description) VALUES (@node_id, @description)
     ON CONFLICT(node_id) DO UPDATE SET description = excluded.description`,
  ).run({ node_id: nodeId, description });
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export interface CreateWorkspaceInput {
  name: string;
  subjects: string[];
  goal?: string | null;
  depth?: WorkspaceDepth;
}

export interface CreateWorkspaceResult {
  workspace: Workspace;
  node_count: number;
  edge_count: number;
  nodes_per_subject: Record<string, number>;
}

/**
 * POST /api/workspaces entry point. See module docblock for the overall
 * strategy (synchronous, sequential per-subject Gemini calls).
 */
export async function createWorkspace(input: CreateWorkspaceInput): Promise<CreateWorkspaceResult> {
  const subjects = Array.from(
    new Set(input.subjects.map((s) => s.trim()).filter((s) => s.length > 0)),
  );
  if (subjects.length === 0) {
    throw new Error('createWorkspace requires at least one non-empty subject');
  }
  const depth: WorkspaceDepth = input.depth ?? 'standard';
  const name = input.name?.trim() || subjects.join(' & ');

  const workspaceId = `student_ws_${nanoid(12)}`;
  const now = new Date().toISOString();

  // A workspace's student_id must exist in `students` (FK from nodes/edges).
  studentsRepo.upsert(workspaceId, name);

  const workspace: Workspace = {
    id: workspaceId,
    name,
    subjects,
    goal: input.goal?.trim() || null,
    created_at: now,
    last_opened_at: null,
  };
  insertWorkspaceRow(workspace);

  const nodesPerSubject: Record<string, number> = {};
  const perSubject: { subject: string; nodes: Node[]; labelToId: Map<string, string> }[] = [];
  let edgeCount = 0;

  // Sequential across subjects — deliberately not Promise.all — to respect
  // Gemini's 15 req/min free-tier rate limit.
  for (const subject of subjects) {
    logWorkspaceProgress(workspaceId, `Generating concepts for ${subject}...`);

    const concepts = await generateConceptsForSubject(subject, depth);

    const subjectNodes: Node[] = [];
    const labelToId = new Map<string, string>();
    for (const concept of concepts) {
      const node = buildRedNode(workspaceId, subject, concept.label);
      subjectNodes.push(node);
      labelToId.set(normalizeLabel(concept.label), node.id);
    }

    for (const node of subjectNodes) {
      nodesRepo.insert(node);
      emitNodeCreated(node);
    }
    for (const concept of concepts) {
      const nodeId = labelToId.get(normalizeLabel(concept.label));
      if (nodeId) insertDescription(nodeId, concept.description);
    }

    // prerequisite edges — strictly within this subject.
    for (let i = 0; i < concepts.length; i++) {
      const concept = concepts[i];
      const node = subjectNodes[i];
      if (!concept || !node) continue;
      for (const prereqLabel of concept.prerequisites) {
        const prereqId = labelToId.get(normalizeLabel(prereqLabel));
        if (!prereqId || prereqId === node.id) continue; // unresolvable / self-reference -> drop, never invent
        const edge: Edge = {
          id: `edge_${nanoid(12)}`,
          student_id: workspaceId,
          source_node_id: prereqId,
          target_node_id: node.id,
          relationship_type: 'prerequisite' as RelationshipType,
          strength: 0.8,
          discovered_by: 'workspace_generation',
          created_at: now,
        };
        edgesRepo.insert(edge);
        emitEdgeCreated(edge);
        edgeCount += 1;
      }
    }

    nodesPerSubject[subject] = subjectNodes.length;
    perSubject.push({ subject, nodes: subjectNodes, labelToId });
  }

  // Optional cross-subject related_topic edges — only ones Gemini explicitly named.
  if (subjects.length > 1) {
    logWorkspaceProgress(workspaceId, 'Looking for cross-subject connections...');
    const crossLinks = await generateCrossSubjectLinks(
      perSubject.map((s) => ({ subject: s.subject, labels: s.nodes.map((n) => n.label) })),
    );
    for (const link of crossLinks) {
      const a = perSubject.find((s) => s.subject === link.subject_a);
      const b = perSubject.find((s) => s.subject === link.subject_b);
      const aId = a?.labelToId.get(normalizeLabel(link.label_a));
      const bId = b?.labelToId.get(normalizeLabel(link.label_b));
      if (!aId || !bId || aId === bId) continue; // unresolvable -> drop, never invent
      const edge: Edge = {
        id: `edge_${nanoid(12)}`,
        student_id: workspaceId,
        source_node_id: aId,
        target_node_id: bId,
        relationship_type: 'related_topic' as RelationshipType,
        strength: 0.6,
        discovered_by: 'workspace_generation_cross',
        created_at: now,
      };
      edgesRepo.insert(edge);
      emitEdgeCreated(edge);
      edgeCount += 1;
    }
  }

  const nodeCount = perSubject.reduce((sum, s) => sum + s.nodes.length, 0);

  return { workspace, node_count: nodeCount, edge_count: edgeCount, nodes_per_subject: nodesPerSubject };
}

// Re-exported so routes/workspaces.ts doesn't need to know DEMO_STUDENT_ID lives in config.
export { DEMO_STUDENT_ID };
