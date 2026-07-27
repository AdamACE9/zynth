/**
 * Office Hours Queue — a shared, triaged question queue that batches
 * overlapping student questions by topic/misconception and answers a whole
 * batch at once with one visual worked solution instead of per-question
 * chat replies.
 *
 * Pipeline:
 *   1. ask(question, askerName) — classifies the question onto the most
 *      likely graph node (by label, via Gemini) and persists it status:'open'.
 *   2. getQueue() — clusters every 'open' question by topic overlap (Gemini,
 *      falling back to a deterministic node_id + keyword-overlap pass),
 *      persists the resulting cluster_id onto each member row (so a later
 *      answer() call can resolve the exact same batch), and returns batches
 *      sorted biggest-first — the most blocking pattern leads the queue.
 *   3. answerBatchOrQuestion({ batch_id | question_id }) — generates ONE
 *      worked-solution answer (steps + key_insight + common_mistake) that
 *      resolves every question in the batch, persists it onto every member
 *      row, and flips them to status:'answered'.
 *
 * Every Gemini call degrades to a deterministic, clearly-labelled fallback in
 * STUB_MODE or on ANY failure (bad key, quota, malformed JSON) — Office
 * Hours must never hard-fail the demo. Reads Node data for classification and
 * display labels only; NEVER writes Node.status/mastery_score (see LOCKED
 * rule in the task briefing — statusService remains the sole writer).
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import type { Node } from '@zynth/shared';
import { config, STUB_MODE, DEMO_STUDENT_ID } from '../config';
import { db } from '../db/connection';
import { nodesRepo } from '../db/repositories';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

// ---------------------------------------------------------------------------
// table — schema.sql is frozen for this feature, so office_hours_questions is
// created here at module load, per the Day 4 Tier 2 briefing.
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS office_hours_questions (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    asker_name TEXT NOT NULL,
    question TEXT NOT NULL,
    node_id TEXT,
    cluster_id TEXT,
    status TEXT NOT NULL CHECK (status IN ('open', 'answered')),
    answer TEXT,
    created_at TEXT NOT NULL
  )
`);
db.exec('CREATE INDEX IF NOT EXISTS idx_office_hours_student ON office_hours_questions(student_id)');
db.exec('CREATE INDEX IF NOT EXISTS idx_office_hours_status ON office_hours_questions(status)');
db.exec('CREATE INDEX IF NOT EXISTS idx_office_hours_cluster ON office_hours_questions(cluster_id)');

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// public shapes
// ---------------------------------------------------------------------------

export interface WorkedSolutionStep {
  label: string;
  expression: string;
  note: string;
}

export interface WorkedSolution {
  steps: WorkedSolutionStep[];
  key_insight: string;
  common_mistake: string;
}

export interface OfficeHoursQuestion {
  id: string;
  student_id: string;
  asker_name: string;
  question: string;
  node_id: string | null;
  node_label: string | null;
  cluster_id: string | null;
  status: 'open' | 'answered';
  answer: WorkedSolution | null;
  created_at: string;
}

export interface OfficeHoursBatch {
  batch_id: string;
  label: string;
  node_id: string | null;
  node_label: string | null;
  questions: OfficeHoursQuestion[];
  answer: WorkedSolution | null;
}

export class OfficeHoursNotFoundError extends Error {}

// ---------------------------------------------------------------------------
// row <-> shape + raw statements
// ---------------------------------------------------------------------------

interface QuestionRow {
  id: string;
  student_id: string;
  asker_name: string;
  question: string;
  node_id: string | null;
  cluster_id: string | null;
  status: 'open' | 'answered';
  answer: string | null;
  created_at: string;
}

function nodeLabelById(nodeId: string | null): string | null {
  if (!nodeId) return null;
  return nodesRepo.getById(nodeId)?.label ?? null;
}

function rowToQuestion(row: QuestionRow): OfficeHoursQuestion {
  return {
    id: row.id,
    student_id: row.student_id,
    asker_name: row.asker_name,
    question: row.question,
    node_id: row.node_id,
    node_label: nodeLabelById(row.node_id),
    cluster_id: row.cluster_id,
    status: row.status,
    answer: row.answer ? (JSON.parse(row.answer) as WorkedSolution) : null,
    created_at: row.created_at,
  };
}

const insertStmt = db.prepare(
  `INSERT INTO office_hours_questions (id, student_id, asker_name, question, node_id, cluster_id, status, answer, created_at)
   VALUES (@id, @student_id, @asker_name, @question, @node_id, @cluster_id, @status, @answer, @created_at)`,
);

const updateClusterStmt = db.prepare('UPDATE office_hours_questions SET cluster_id = @cluster_id WHERE id = @id');

const markAnsweredStmt = db.prepare(
  "UPDATE office_hours_questions SET status = 'answered', answer = @answer WHERE id = @id",
);

function insertRow(row: QuestionRow): void {
  insertStmt.run(row);
}

function getOpenRows(): QuestionRow[] {
  return db
    .prepare("SELECT * FROM office_hours_questions WHERE student_id = ? AND status = 'open' ORDER BY created_at ASC")
    .all(DEMO_STUDENT_ID) as QuestionRow[];
}

function getRowById(id: string): QuestionRow | undefined {
  return db.prepare('SELECT * FROM office_hours_questions WHERE id = ?').get(id) as QuestionRow | undefined;
}

function getOpenRowsByCluster(clusterId: string): QuestionRow[] {
  return db
    .prepare("SELECT * FROM office_hours_questions WHERE cluster_id = ? AND status = 'open' ORDER BY created_at ASC")
    .all(clusterId) as QuestionRow[];
}

// ---------------------------------------------------------------------------
// seed — ~8 realistic questions across Calculus/Physics with a DELIBERATE
// overlap: three phrased differently but all really about forgetting the
// chain rule's inner derivative, plus a smaller two-question overlap on
// friction/FBD, so the batching visibly works the first time the queue opens.
// ---------------------------------------------------------------------------

interface SeedSpec {
  id: string;
  askerName: string;
  question: string;
  nodeLabel: string;
  daysAgo: number;
}

const SEED_SPECS: SeedSpec[] = [
  {
    id: 'ohq_seed_01',
    askerName: 'Maya',
    question:
      "I keep getting the sign wrong on d/dx[cos(3x)] — I get 3sin(3x) instead of -3sin(3x). Is the chain rule supposed to do that?",
    nodeLabel: 'Chain Rule',
    daysAgo: 2,
  },
  {
    id: 'ohq_seed_02',
    askerName: 'Diego',
    question:
      "For e^(-x^2) I keep forgetting to multiply by the derivative of the exponent — I wrote 2x*e^(-x^2) instead of -2x*e^(-x^2). What am I missing with the chain rule here?",
    nodeLabel: 'Chain Rule',
    daysAgo: 2,
  },
  {
    id: 'ohq_seed_03',
    askerName: 'Priya',
    question:
      "Why does d/dx[(2x+1)^3] need that extra factor of 2 at the end? I always forget to multiply by the derivative of what's inside the parentheses.",
    nodeLabel: 'Chain Rule',
    daysAgo: 1,
  },
  {
    id: 'ohq_seed_04',
    askerName: 'Sam',
    question:
      "On implicit differentiation of x^2 + y^2 = 25, I get dy/dx = x/y but the answer key says -x/y. Where does the negative come from?",
    nodeLabel: 'Implicit Differentiation',
    daysAgo: 3,
  },
  {
    id: 'ohq_seed_05',
    askerName: 'Jordan',
    question:
      "In the ladder-sliding-down-a-wall related rates problem, how do I know when dy/dt should be negative?",
    nodeLabel: 'Related Rates',
    daysAgo: 1,
  },
  {
    id: 'ohq_seed_06',
    askerName: 'Alex',
    question:
      "For free-body diagrams on an incline, I never know which direction to draw the friction force. Does it depend on the direction of motion?",
    nodeLabel: 'Forces & Free-Body Diagrams',
    daysAgo: 2,
  },
  {
    id: 'ohq_seed_07',
    askerName: 'Riley',
    question:
      "When do I use static friction versus kinetic friction in a force diagram? I mix them up every time.",
    nodeLabel: 'Forces & Free-Body Diagrams',
    daysAgo: 1,
  },
  {
    id: 'ohq_seed_08',
    askerName: 'Casey',
    question:
      "What's actually different between velocity and speed in kinematics word problems? I keep losing points for using the wrong one.",
    nodeLabel: 'Kinematics',
    daysAgo: 4,
  },
];

function daysAgoIso(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

function seedIfEmpty(): void {
  const row = db.prepare('SELECT COUNT(*) as count FROM office_hours_questions').get() as { count: number };
  if (row.count > 0) return;

  const allNodes = nodesRepo.getAll(DEMO_STUDENT_ID);
  const byLabel = new Map(allNodes.map((n) => [n.label.toLowerCase(), n.id]));

  for (const spec of SEED_SPECS) {
    insertRow({
      id: spec.id,
      student_id: DEMO_STUDENT_ID,
      asker_name: spec.askerName,
      question: spec.question,
      node_id: byLabel.get(spec.nodeLabel.toLowerCase()) ?? null,
      cluster_id: null,
      status: 'open',
      answer: null,
      created_at: daysAgoIso(spec.daysAgo),
    });
  }

  // eslint-disable-next-line no-console
  console.log(`[officeHoursService] Seeded ${SEED_SPECS.length} office hours questions.`);
}

seedIfEmpty();

// ---------------------------------------------------------------------------
// shared keyword helpers (deterministic fallbacks)
// ---------------------------------------------------------------------------

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
}

function deterministicClassify(question: string, nodes: Node[]): string | null {
  const qWords = new Set(significantWords(question));
  let best: { id: string; score: number } | null = null;
  for (const n of nodes) {
    const score = significantWords(n.label).filter((w) => qWords.has(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { id: n.id, score };
  }
  return best?.id ?? null;
}

// ---------------------------------------------------------------------------
// classification (ask)
// ---------------------------------------------------------------------------

const CLASSIFY_SCHEMA = {
  type: 'object',
  properties: {
    node_id: { type: 'string' },
  },
  required: ['node_id'],
} as const;

async function classifyQuestion(question: string): Promise<string | null> {
  const nodes = nodesRepo.getAll(DEMO_STUDENT_ID);
  if (nodes.length === 0) return null;

  if (STUB_MODE || !ai) {
    return deterministicClassify(question, nodes);
  }

  const known = nodes.map((n) => ({ id: n.id, label: n.label, subject: n.subject }));
  const prompt = `A student asked a question during office hours. Match it to the SINGLE most likely concept node from this list (by "id"), or "" if none plausibly apply.

KNOWN CONCEPT NODES:
${JSON.stringify(known)}

STUDENT QUESTION:
"""
${question}
"""

Return only the matching node's "id" (exact string, copied from the list above), or "" if no node is a good match.`;

  try {
    const res = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: CLASSIFY_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2048,
      },
    });
    const raw = res.text;
    if (!raw) throw new Error('Gemini returned an empty response for office hours classification');
    const parsed = JSON.parse(raw) as { node_id?: unknown };
    const candidate = typeof parsed.node_id === 'string' ? parsed.node_id : '';
    const validIds = new Set(nodes.map((n) => n.id));
    return validIds.has(candidate) ? candidate : deterministicClassify(question, nodes);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[officeHoursService] classifyQuestion failed, falling back to keyword match:', err);
    return deterministicClassify(question, nodes);
  }
}

export async function ask(question: string, askerName?: string): Promise<OfficeHoursQuestion> {
  const trimmed = question.trim();
  const nodeId = await classifyQuestion(trimmed);
  const row: QuestionRow = {
    id: `ohq_${nanoid(10)}`,
    student_id: DEMO_STUDENT_ID,
    asker_name: askerName?.trim() || 'Anonymous',
    question: trimmed,
    node_id: nodeId,
    cluster_id: null,
    status: 'open',
    answer: null,
    created_at: nowIso(),
  };
  insertRow(row);
  return rowToQuestion(row);
}

// ---------------------------------------------------------------------------
// clustering (getQueue) — the differentiator: batch by topic/misconception
// overlap, not just by node_id.
// ---------------------------------------------------------------------------

interface RawBatch {
  label: string;
  question_ids: string[];
}

/** Deterministic fallback: group strictly by node_id (unlinked questions each
 * become their own singleton batch). When >=2 questions share a node, tries
 * to name the shared complaint via the most frequent significant word across
 * their text so the fallback still reads as real signal, not just a node
 * rollup. */
function deterministicCluster(rows: QuestionRow[]): RawBatch[] {
  const byNode = new Map<string, QuestionRow[]>();
  const singles: QuestionRow[] = [];
  for (const r of rows) {
    if (r.node_id) {
      const bucket = byNode.get(r.node_id) ?? [];
      bucket.push(r);
      byNode.set(r.node_id, bucket);
    } else {
      singles.push(r);
    }
  }

  const batches: RawBatch[] = [];
  for (const [nodeId, group] of byNode) {
    const label = nodeLabelById(nodeId) ?? 'this concept';
    if (group.length > 1) {
      const wordCounts = new Map<string, number>();
      for (const g of group) {
        for (const w of new Set(significantWords(g.question))) {
          wordCounts.set(w, (wordCounts.get(w) ?? 0) + 1);
        }
      }
      const shared = Array.from(wordCounts.entries())
        .filter(([, count]) => count >= Math.min(2, group.length))
        .sort((a, b) => b[1] - a[1])[0]?.[0];
      batches.push({
        label: shared
          ? `${group.length} students stuck on ${label} — recurring "${shared}" confusion`
          : `${group.length} students asking about ${label}`,
        question_ids: group.map((g) => g.id),
      });
    } else {
      const only = group[0];
      if (only) batches.push({ label: `1 student asking about ${label}`, question_ids: [only.id] });
    }
  }
  for (const r of singles) {
    batches.push({ label: '1 student — unclassified question', question_ids: [r.id] });
  }
  return batches;
}

const CLUSTER_SCHEMA = {
  type: 'object',
  properties: {
    batches: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          question_ids: { type: 'array', items: { type: 'string' } },
        },
        required: ['label', 'question_ids'],
      },
    },
  },
  required: ['batches'],
} as const;

async function clusterQuestions(rows: QuestionRow[]): Promise<RawBatch[]> {
  if (rows.length === 0) return [];
  if (STUB_MODE || !ai) return deterministicCluster(rows);

  const input = rows.map((r) => ({
    id: r.id,
    question: r.question,
    concept: r.node_id ? nodeLabelById(r.node_id) : null,
  }));

  const prompt = `You are triaging a shared office-hours question queue. Below is every currently OPEN question, each with the concept it's linked to (may be null).

QUESTIONS:
${JSON.stringify(input)}

Group these into batches where every question in a batch shares the SAME underlying concept or misconception — even if phrased completely differently (e.g. three different questions that are all really "forgetting the inner derivative in the chain rule" belong in ONE batch). Do not merge questions that are only superficially similar (same broad topic but a different specific misunderstanding).

Every question id must appear in EXACTLY ONE batch, including questions that don't overlap with anything else (their own batch of one).

For each batch return:
- "label": a short, specific, human sentence naming what's blocking these students, e.g. "3 students stuck on the chain rule's inner derivative". For a batch of one, phrase it as "1 student asking about X".
- "question_ids": the "id" values (copied exactly) in this batch.`;

  try {
    const res = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: CLUSTER_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2048,
      },
    });
    const raw = res.text;
    if (!raw) throw new Error('Gemini returned an empty response for office hours clustering');
    const parsed = JSON.parse(raw) as { batches?: unknown };
    if (!Array.isArray(parsed.batches)) throw new Error('office hours clustering response missing batches[]');

    const validIds = new Set(rows.map((r) => r.id));
    const seen = new Set<string>();
    const out: RawBatch[] = [];
    for (const item of parsed.batches) {
      const b = item as { label?: unknown; question_ids?: unknown };
      if (typeof b.label !== 'string' || !b.label.trim()) continue;
      if (!Array.isArray(b.question_ids)) continue;
      const ids = b.question_ids.filter(
        (id): id is string => typeof id === 'string' && validIds.has(id) && !seen.has(id),
      );
      if (ids.length === 0) continue;
      ids.forEach((id) => seen.add(id));
      out.push({ label: b.label.trim(), question_ids: ids });
    }

    // Anything the model dropped becomes its own singleton batch so no open
    // question ever silently disappears from the queue.
    for (const r of rows) {
      if (!seen.has(r.id)) {
        const label = r.node_id ? nodeLabelById(r.node_id) ?? 'this question' : 'this question';
        out.push({ label: `1 student asking about ${label}`, question_ids: [r.id] });
      }
    }

    if (out.length === 0) throw new Error('office hours clustering produced no batches');
    return out;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[officeHoursService] clusterQuestions failed, falling back to deterministic clustering:', err);
    return deterministicCluster(rows);
  }
}

function buildBatch(raw: RawBatch, rowsById: Map<string, QuestionRow>): OfficeHoursBatch {
  const batchId = `batch_${nanoid(8)}`;
  const memberRows = raw.question_ids
    .map((id) => rowsById.get(id))
    .filter((r): r is QuestionRow => r !== undefined);

  for (const r of memberRows) {
    updateClusterStmt.run({ id: r.id, cluster_id: batchId });
  }

  const questions = memberRows.map((r) => rowToQuestion({ ...r, cluster_id: batchId }));
  const nodeIds = new Set(questions.map((q) => q.node_id).filter((id): id is string => id !== null));
  const singleNodeId = nodeIds.size === 1 ? (Array.from(nodeIds)[0] as string) : null;

  return {
    batch_id: batchId,
    label: raw.label,
    node_id: singleNodeId,
    node_label: singleNodeId ? nodeLabelById(singleNodeId) : null,
    questions,
    answer: null,
  };
}

/**
 * Returns every OPEN question grouped into topic-overlap batches, triaged
 * biggest-first (the most students blocked leads the queue). Persists the
 * fresh cluster_id assignment onto each row so a subsequent
 * answerBatchOrQuestion({ batch_id }) call resolves the exact same set.
 */
export async function getQueue(): Promise<OfficeHoursBatch[]> {
  const openRows = getOpenRows();
  const rawBatches = await clusterQuestions(openRows);
  const rowsById = new Map(openRows.map((r) => [r.id, r]));
  const batches = rawBatches.map((b) => buildBatch(b, rowsById));

  batches.sort((a, b) => {
    if (b.questions.length !== a.questions.length) return b.questions.length - a.questions.length;
    const aOldest = a.questions[0]?.created_at ?? '';
    const bOldest = b.questions[0]?.created_at ?? '';
    return aOldest.localeCompare(bOldest);
  });

  return batches;
}

// ---------------------------------------------------------------------------
// answering — ONE worked solution resolves the whole batch.
// ---------------------------------------------------------------------------

const ANSWER_SCHEMA = {
  type: 'object',
  properties: {
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          expression: { type: 'string' },
          note: { type: 'string' },
        },
        required: ['label', 'expression', 'note'],
      },
    },
    key_insight: { type: 'string' },
    common_mistake: { type: 'string' },
  },
  required: ['steps', 'key_insight', 'common_mistake'],
} as const;

function deterministicAnswer(questions: QuestionRow[], nodeLbl: string | null): WorkedSolution {
  const topic = nodeLbl ?? 'this concept';
  return {
    steps: [
      {
        label: 'Step 1',
        expression: `Identify the outer and inner parts of ${topic}`,
        note: "[stub] Separate what you're differentiating/solving from what it depends on.",
      },
      {
        label: 'Step 2',
        expression: `Apply the rule for ${topic} to the outer part first`,
        note: '[stub] Work the outer operation, holding the inner part as a placeholder.',
      },
      {
        label: 'Step 3',
        expression: "Multiply by the inner part's own derivative/rate",
        note: '[stub] This is the step every version of this question was missing.',
      },
    ],
    key_insight: `[stub] Every version of this question comes back to the same rule for ${topic} — once you see the shared structure, all ${questions.length} versions resolve the same way.`,
    common_mistake: "[stub] Forgetting to carry the inner term's own derivative or sign through to the final answer.",
  };
}

async function generateAnswer(questions: QuestionRow[], nodeLbl: string | null): Promise<WorkedSolution> {
  if (STUB_MODE || !ai) return deterministicAnswer(questions, nodeLbl);

  const prompt = `You are answering a batch of office-hours questions that all share the SAME underlying concept or misconception, so you can resolve every one of them with ONE worked solution.

LINKED CONCEPT: ${nodeLbl ?? 'unspecified'}

QUESTIONS IN THIS BATCH:
${questions.map((q, i) => `${i + 1}. ${q.question}`).join('\n')}

Write ONE worked solution that resolves the shared misconception behind all of these. Return:
- "steps": an ordered array of 3-6 steps, each with:
  - "label": a short step name (e.g. "Step 1: Identify the inner function").
  - "expression": the actual math/physics expression or action for this step, plain text (e.g. "d/dx[cos(3x)] = -sin(3x) times d/dx[3x]").
  - "note": one sentence explaining why this step matters, in plain language.
- "key_insight": ONE sentence naming the single idea that unlocks all of these questions at once.
- "common_mistake": ONE sentence naming the specific mistake students in this batch are making.

Keep it concrete and worked-example style, not a wall of prose. Do not reference these instructions in the output.`;

  try {
    const res = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: ANSWER_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2048,
      },
    });
    const raw = res.text;
    if (!raw) throw new Error('Gemini returned an empty response for office hours answer');
    const parsed = JSON.parse(raw) as {
      steps?: unknown;
      key_insight?: unknown;
      common_mistake?: unknown;
    };
    if (
      !Array.isArray(parsed.steps) ||
      parsed.steps.length === 0 ||
      typeof parsed.key_insight !== 'string' ||
      !parsed.key_insight.trim() ||
      typeof parsed.common_mistake !== 'string' ||
      !parsed.common_mistake.trim()
    ) {
      throw new Error('office hours answer response missing required fields');
    }

    const steps: WorkedSolutionStep[] = parsed.steps
      .map((s) => s as { label?: unknown; expression?: unknown; note?: unknown })
      .filter(
        (s): s is { label: string; expression: string; note: string } =>
          typeof s.label === 'string' &&
          !!s.label.trim() &&
          typeof s.expression === 'string' &&
          !!s.expression.trim() &&
          typeof s.note === 'string' &&
          !!s.note.trim(),
      )
      .map((s) => ({ label: s.label.trim(), expression: s.expression.trim(), note: s.note.trim() }));

    if (steps.length === 0) throw new Error('office hours answer produced no valid steps');

    return {
      steps,
      key_insight: parsed.key_insight.trim(),
      common_mistake: parsed.common_mistake.trim(),
    };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[officeHoursService] generateAnswer failed, falling back to deterministic answer:', err);
    return deterministicAnswer(questions, nodeLbl);
  }
}

function labelForResolvedBatch(questions: OfficeHoursQuestion[], nodeLbl: string | null): string {
  const topic = nodeLbl ?? 'a shared question';
  return questions.length > 1
    ? `${questions.length} students — ${topic} (answered)`
    : `1 student — ${topic} (answered)`;
}

/**
 * Resolves `batch_id` (preferred — matches the cluster_id getQueue() just
 * persisted) or `question_id` (resolves to that question's current batch, or
 * a batch of one if it isn't clustered / was answered standalone) into the
 * full row set, generates ONE worked solution for it, persists the answer +
 * status:'answered' onto every member row, and returns the resolved batch.
 */
export async function answerBatchOrQuestion(input: {
  batch_id?: string;
  question_id?: string;
}): Promise<OfficeHoursBatch> {
  let rows: QuestionRow[];
  let batchId: string;

  if (input.batch_id) {
    rows = getOpenRowsByCluster(input.batch_id);
    if (rows.length === 0) {
      throw new OfficeHoursNotFoundError(`No open questions found for batch_id "${input.batch_id}"`);
    }
    batchId = input.batch_id;
  } else if (input.question_id) {
    const row = getRowById(input.question_id);
    if (!row) throw new OfficeHoursNotFoundError(`No question found with id "${input.question_id}"`);
    if (row.status === 'answered') {
      // Idempotent: re-requesting an already-answered question returns its
      // existing resolved batch rather than erroring or re-generating.
      const question = rowToQuestion(row);
      return {
        batch_id: row.cluster_id ?? `batch_${row.id}`,
        label: labelForResolvedBatch([question], question.node_label),
        node_id: question.node_id,
        node_label: question.node_label,
        questions: [question],
        answer: question.answer,
      };
    }
    rows = row.cluster_id ? getOpenRowsByCluster(row.cluster_id) : [row];
    if (rows.length === 0) rows = [row];
    batchId = row.cluster_id ?? `batch_${nanoid(8)}`;
  } else {
    throw new OfficeHoursNotFoundError('Either batch_id or question_id is required');
  }

  const nodeIds = new Set(rows.map((r) => r.node_id).filter((id): id is string => id !== null));
  const nodeLbl = nodeIds.size === 1 ? nodeLabelById(Array.from(nodeIds)[0] as string) : null;

  const answer = await generateAnswer(rows, nodeLbl);
  const answerJson = JSON.stringify(answer);

  for (const r of rows) {
    updateClusterStmt.run({ id: r.id, cluster_id: batchId });
    markAnsweredStmt.run({ id: r.id, answer: answerJson });
  }

  const questions = rows.map((r) =>
    rowToQuestion({ ...r, cluster_id: batchId, status: 'answered', answer: answerJson }),
  );
  const singleNodeId = nodeIds.size === 1 ? (Array.from(nodeIds)[0] as string) : null;

  return {
    batch_id: batchId,
    label: labelForResolvedBatch(questions, nodeLbl),
    node_id: singleNodeId,
    node_label: nodeLbl,
    questions,
    answer,
  };
}
