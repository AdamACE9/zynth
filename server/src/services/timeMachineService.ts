/**
 * Curriculum Time-Machine (Day 4, Tier 2).
 *
 * Sibling of the Study Plan (planService.ts) but on the TIME axis: the Plan
 * says "what order", this says "am I on schedule, and what changes if not".
 *
 * MODEL
 * -----
 * `createTimeMachineRun(goal, examDate)` builds ONE immutable baseline
 * schedule: every not-yet-green node, topologically ordered over
 * `prerequisite` edges (Kahn's algorithm, mirroring planService's
 * `topoSortByPriority` — deliberately re-implemented here rather than
 * imported, per the Day 4 agent split), then evenly paced across weekly
 * checkpoints from `created_at` to `exam_date`. That ordered id list
 * (`node_sequence`) is persisted and NEVER rewritten — it is the fixed
 * GPS-ETA baseline every future checkpoint is measured against, exactly the
 * way `plan_paths.node_sequence` anchors the Ghost Path.
 *
 * `getCurrentTimeMachine()` recomputes EVERYTHING ELSE live on every call:
 * actual position (contiguous green run from the front of the baseline
 * sequence — a later green out of order doesn't count as "arrived", same
 * GPS logic as the Ghost Path), planned position (elapsed fraction of the
 * exam horizon), verdict, and slip in days. Nothing about the verdict is
 * cached — "no stale cache" per the brief.
 *
 * THE REROUTE
 * -----------
 * Only computed when the verdict is 'behind'. The remaining not-green tail
 * of the baseline sequence is compressed into the weeks left before the
 * exam by raising the weekly load (bounded — "raise the load", not "study
 * 40 concepts a week"). If even the raised load can't fit everything,
 * lowest-priority nodes are dropped from the run-up — but ONLY nodes with
 * no dependent still in the remaining set (a node can never be scheduled
 * before an un-mastered prerequisite; dropping only safe "leaves" of the
 * remaining prerequisite DAG keeps that invariant intact even after a
 * reroute). Gemini is consulted, goal-aware, to choose WHICH safe nodes to
 * defer when there's a real choice to make; the day-slip count and the
 * "moved to week N" facts are always computed deterministically from the
 * schedule itself, never left to the model to invent. STUB_MODE (or any
 * Gemini failure) falls back to a deterministic lowest-priority-first
 * selection — this path never crashes and never blocks the feature.
 *
 * LOCKED: this module only ever READS Node.status via nodesRepo. It has no
 * write path to nodes/status at all.
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import type { Edge, Node, Status } from '@zynth/shared';
import { config, STUB_MODE, DEMO_STUDENT_ID } from '../config';
import { db } from '../db/connection';
import { nodesRepo, edgesRepo } from '../db/repositories';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

// ---------------------------------------------------------------------------
// persistence — schema.sql is frozen, so the table is created here at module
// load. Only the immutable baseline is stored; verdict/reroute are derived
// fresh on every read (see module header).
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS tm_runs (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    goal TEXT,
    exam_date TEXT NOT NULL,
    node_sequence TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_rerouted_at TEXT,
    reroute_because TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_tm_runs_student ON tm_runs(student_id, created_at);
`);

interface TmRunRow {
  id: string;
  student_id: string;
  goal: string | null;
  exam_date: string;
  node_sequence: string; // JSON string[]
  created_at: string;
  last_rerouted_at: string | null;
  reroute_because: string | null;
}

// ---------------------------------------------------------------------------
// time helpers
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_HORIZON_DAYS = 21;
const CHECKPOINT_SPAN_DAYS = 7;

function nowIso(): string {
  return new Date().toISOString();
}

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(iso) + days * DAY_MS).toISOString();
}

function daysBetween(fromIso: string, toIso: string): number {
  return (Date.parse(toIso) - Date.parse(fromIso)) / DAY_MS;
}

// ---------------------------------------------------------------------------
// small text helper (deliberately duplicated from planService — see module
// header) + a plain numeric priority score used both for the initial
// ordering tie-break and for ranking which nodes are least essential to
// drop during a reroute.
// ---------------------------------------------------------------------------

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
}

function priorityScore(goal: string | null, node: Node): number {
  const statusBonus = node.status === 'red' ? 1 : 0;
  if (!goal) return statusBonus;
  const goalWords = significantWords(goal);
  if (goalWords.length === 0) return statusBonus;
  const words = significantWords(`${node.label} ${node.subject}`);
  const overlap = words.filter((w) => goalWords.includes(w)).length;
  return overlap * 10 + statusBonus;
}

// ---------------------------------------------------------------------------
// Kahn's algorithm over prerequisite edges, mirroring
// planService.topoSortByPriority exactly (re-implemented, not imported —
// see module header). A node is structurally impossible to schedule before
// an included prerequisite.
// ---------------------------------------------------------------------------

function topoSortByPriority(
  included: Set<string>,
  prereqEdges: Edge[],
  scoreOf: (id: string) => number,
  stableIndexOf: (id: string) => number,
): string[] {
  const indegree = new Map<string, number>();
  const dependents = new Map<string, string[]>();
  for (const id of included) {
    indegree.set(id, 0);
    dependents.set(id, []);
  }
  for (const e of prereqEdges) {
    if (included.has(e.source_node_id) && included.has(e.target_node_id)) {
      dependents.get(e.source_node_id)!.push(e.target_node_id);
      indegree.set(e.target_node_id, (indegree.get(e.target_node_id) ?? 0) + 1);
    }
  }

  const ready = new Set<string>();
  for (const id of included) {
    if ((indegree.get(id) ?? 0) === 0) ready.add(id);
  }

  const result: string[] = [];
  while (ready.size > 0) {
    let best: string | null = null;
    for (const id of ready) {
      if (best === null) {
        best = id;
        continue;
      }
      const s = scoreOf(id);
      const sb = scoreOf(best);
      if (s > sb || (s === sb && stableIndexOf(id) < stableIndexOf(best))) {
        best = id;
      }
    }
    ready.delete(best!);
    result.push(best!);
    for (const dep of dependents.get(best!) ?? []) {
      const next = (indegree.get(dep) ?? 0) - 1;
      indegree.set(dep, next);
      if (next === 0) ready.add(dep);
    }
  }

  // Only reachable with a malformed (cyclic) prerequisite graph.
  if (result.length < included.size) {
    const seen = new Set(result);
    const rest = Array.from(included)
      .filter((id) => !seen.has(id))
      .sort((a, b) => stableIndexOf(a) - stableIndexOf(b));
    result.push(...rest);
  }

  return result;
}

/** The immutable baseline: every not-yet-green node, in legal prerequisite
 * order, tie-broken by goal relevance (if a goal was given) then red-before-
 * amber then stable graph order. */
function buildBaselineSequence(goal: string | null): string[] {
  const nodes = nodesRepo.getAll(DEMO_STUDENT_ID);
  const prereqEdges = edgesRepo.getAll(DEMO_STUDENT_ID).filter((e) => e.relationship_type === 'prerequisite');
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const stableIndexOf = new Map(nodes.map((n, i) => [n.id, i]));
  const included = new Set(nodes.filter((n) => n.status !== 'green').map((n) => n.id));

  const scoreOf = (id: string): number => {
    const node = nodesById.get(id);
    return node ? priorityScore(goal, node) : 0;
  };

  return topoSortByPriority(included, prereqEdges, scoreOf, (id) => stableIndexOf.get(id) ?? 0);
}

// ---------------------------------------------------------------------------
// public result shape
// ---------------------------------------------------------------------------

export type TimeMachineVerdict = 'ahead' | 'on_track' | 'behind';

export interface TimeMachineNode {
  node_id: string;
  label: string;
  subject: string;
  status: Status;
  /** 1-based absolute week (from schedule creation) this node is due, per the baseline pace. */
  week: number;
  state: 'done' | 'current' | 'upcoming';
}

export interface TimeMachineCheckpoint {
  week: number;
  date: string;
  /** Cumulative count that SHOULD be green by this date, per the baseline pace. */
  should_be_green: number;
  /** Cumulative count of those that ARE actually green right now (live). */
  actually_green: number;
  /** Labels newly due in this specific week (not cumulative) — what's on deck. */
  node_labels: string[];
  is_past: boolean;
}

export interface TimeMachineReroute {
  moved: { node_id: string; label: string; from_week: number; to_week: number }[];
  dropped: { node_id: string; label: string }[];
  reasoning: string;
  new_weekly_load: number;
  baseline_weekly_load: number;
  used_gemini: boolean;
}

export interface TimeMachineResult {
  id: string;
  goal: string | null;
  exam_date: string;
  created_at: string;
  nodes: TimeMachineNode[];
  checkpoints: TimeMachineCheckpoint[];
  verdict: TimeMachineVerdict;
  slip_days: number;
  summary: string;
  reroute: TimeMachineReroute | null;
  last_rerouted_at: string | null;
}

// ---------------------------------------------------------------------------
// reroute — Gemini chooses WHICH safe-to-drop nodes to defer; every number
// (slip days, weeks, which nodes moved where) is computed by us, never by
// the model.
// ---------------------------------------------------------------------------

const DEFER_SCHEMA = {
  type: 'object',
  properties: {
    defer_node_ids: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
  },
  required: ['defer_node_ids', 'reasoning'],
} as const;

/** Lowest-priority-first — used as both the STUB_MODE path and the failure fallback. */
function deterministicDeferral(goal: string | null, droppable: Node[], numToDrop: number): string[] {
  return droppable
    .slice()
    .sort((a, b) => priorityScore(goal, a) - priorityScore(goal, b))
    .slice(0, numToDrop)
    .map((n) => n.id);
}

async function chooseDeferrals(
  goal: string | null,
  droppable: Node[],
  numToDrop: number,
): Promise<{ ids: string[]; usedGemini: boolean }> {
  if (numToDrop <= 0 || droppable.length === 0) return { ids: [], usedGemini: false };

  if (STUB_MODE || !ai || !goal) {
    return { ids: deterministicDeferral(goal, droppable, numToDrop), usedGemini: false };
  }

  try {
    const candidateList = droppable.map((n) => ({ id: n.id, label: n.label, subject: n.subject }));
    const prompt = `You are Zynth's Time-Machine agent. The student has fallen behind their study schedule for the goal "${goal}" and the remaining run-up to the exam must be compressed.

These concepts are SAFE to defer past the exam date (nothing else still pending depends on them as a prerequisite):
${JSON.stringify(candidateList)}

Choose exactly ${numToDrop} of them to defer — pick the ones LEAST essential to "${goal}", keeping anything clearly central to the goal in the active run-up instead. Never invent an id that is not listed above.

Return "defer_node_ids" (exactly ${numToDrop} ids from the list) and a one-sentence "reasoning" for an internal log.`;

    const res = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: DEFER_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 512,
      },
    });

    const raw = res.text;
    if (!raw) throw new Error('Gemini returned an empty response for deferral choice');

    const parsed = JSON.parse(raw) as { defer_node_ids?: unknown };
    if (!Array.isArray(parsed.defer_node_ids)) throw new Error('deferral response missing defer_node_ids[]');

    const validIds = new Set(droppable.map((n) => n.id));
    const chosen = Array.from(
      new Set(parsed.defer_node_ids.filter((id): id is string => typeof id === 'string' && validIds.has(id))),
    );

    if (chosen.length === 0) {
      return { ids: deterministicDeferral(goal, droppable, numToDrop), usedGemini: false };
    }
    if (chosen.length < numToDrop) {
      const fallbackOrder = deterministicDeferral(goal, droppable, droppable.length).filter(
        (id) => !chosen.includes(id),
      );
      chosen.push(...fallbackOrder.slice(0, numToDrop - chosen.length));
    }
    return { ids: chosen.slice(0, numToDrop), usedGemini: true };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[timeMachineService] chooseDeferrals failed, falling back to deterministic ranking:', err);
    return { ids: deterministicDeferral(goal, droppable, numToDrop), usedGemini: false };
  }
}

function describeChanges(
  moved: TimeMachineReroute['moved'],
  dropped: TimeMachineReroute['dropped'],
  newPace: number,
  baselinePace: number,
): string {
  const parts: string[] = [];
  moved.slice(0, 2).forEach((m) => parts.push(`${m.label} moved to week ${m.to_week}`));
  if (moved.length > 2) parts.push(`+${moved.length - 2} more moved later`);
  dropped.slice(0, 2).forEach((d) => parts.push(`${d.label} dropped from the run-up`));
  if (dropped.length > 2) parts.push(`+${dropped.length - 2} more dropped`);

  if (parts.length === 0) {
    return newPace > baselinePace
      ? `weekly load raised from ${baselinePace} to ${newPace} concept${newPace === 1 ? '' : 's'} to still land on the exam date`
      : `still on pace to land on the exam date`;
  }
  if (newPace > baselinePace) parts.push(`pace raised from ${baselinePace}/week to ${newPace}/week`);
  return `${parts.join(', ')}.`;
}

interface RerouteContext {
  row: TmRunRow;
  sequence: string[];
  liveNodes: Map<string, Node | undefined>;
  actualPosition: number;
  totalWeeks: number;
  baselineWeeklyLoad: number;
  weekOf: (index: number) => number;
  prereqEdges: Edge[];
  now: string;
  slipDays: number;
}

async function buildReroute(ctx: RerouteContext): Promise<TimeMachineReroute> {
  const { row, sequence, liveNodes, actualPosition, totalWeeks, baselineWeeklyLoad, weekOf, prereqEdges, now, slipDays } =
    ctx;

  // Only genuinely not-green nodes count against remaining capacity — a
  // later node already green out of order is done, not a burden.
  const remainingTodo = sequence.slice(actualPosition).filter((id) => liveNodes.get(id)?.status !== 'green');

  const daysRemaining = Math.max(0, daysBetween(now, row.exam_date));
  const weeksRemaining = Math.max(1, Math.ceil(daysRemaining / CHECKPOINT_SPAN_DAYS));
  const currentAbsoluteWeek = Math.max(1, totalWeeks - weeksRemaining + 1);

  const neededPace = remainingTodo.length === 0 ? 0 : Math.ceil(remainingTodo.length / weeksRemaining);
  // "Raise the load" is bounded — realistically at most double the original
  // pace (or +2 for very light baselines), never below the baseline pace.
  const maxPace = Math.max(baselineWeeklyLoad * 2, baselineWeeklyLoad + 2, 1);
  const newPace = Math.min(Math.max(neededPace, baselineWeeklyLoad, 1), maxPace);
  const capacity = newPace * weeksRemaining;
  const numToDrop = Math.max(0, remainingTodo.length - capacity);

  // A node is safe to drop only if nothing else still pending depends on it
  // as a prerequisite — dropping a "leaf" of the remaining DAG can never
  // orphan another node's prerequisite requirement.
  const remainingSet = new Set(remainingTodo);
  const hasDependentWithin = new Set<string>();
  for (const e of prereqEdges) {
    if (remainingSet.has(e.source_node_id) && remainingSet.has(e.target_node_id)) {
      hasDependentWithin.add(e.source_node_id);
    }
  }
  const droppableIds = remainingTodo.filter((id) => !hasDependentWithin.has(id));
  const droppableNodes = droppableIds
    .map((id) => liveNodes.get(id))
    .filter((n): n is Node => n !== undefined);

  let droppedIds: string[] = [];
  let usedGemini = false;
  if (numToDrop > 0) {
    if (droppableNodes.length >= numToDrop) {
      const choice = await chooseDeferrals(row.goal, droppableNodes, numToDrop);
      droppedIds = choice.ids;
      usedGemini = choice.usedGemini;
    } else {
      // Not enough safe leaves to hit the target drop count — fall back to
      // the guaranteed-safe plain suffix cut (a prefix of a topologically
      // valid order is itself always prerequisite-safe).
      droppedIds = remainingTodo.slice(capacity);
    }
  }

  const droppedSet = new Set(droppedIds);
  const keep = remainingTodo.filter((id) => !droppedSet.has(id));

  const indexInSequence = new Map(sequence.map((id, i) => [id, i]));
  const moved = keep
    .map((id, p) => {
      const fromWeek = weekOf(indexInSequence.get(id) ?? 0);
      const toWeek = Math.min(totalWeeks, currentAbsoluteWeek + Math.floor(p / newPace));
      return { node_id: id, label: liveNodes.get(id)?.label ?? id, from_week: fromWeek, to_week: toWeek };
    })
    .filter((m) => m.to_week !== m.from_week);

  const dropped = droppedIds.map((id) => ({ node_id: id, label: liveNodes.get(id)?.label ?? id }));

  const s = slipDays === 1 ? '' : 's';
  const reasoning = `${slipDays} day${s} behind; ${describeChanges(moved, dropped, newPace, baselineWeeklyLoad)}`;

  return {
    moved,
    dropped,
    reasoning,
    new_weekly_load: newPace,
    baseline_weekly_load: baselineWeeklyLoad,
    used_gemini: usedGemini,
  };
}

// ---------------------------------------------------------------------------
// live computation — the only thing ever cached is the immutable baseline
// sequence + exam_date + goal. Everything else (verdict, checkpoints,
// reroute) is derived fresh from current Node.status on every call.
// ---------------------------------------------------------------------------

async function computeResult(row: TmRunRow): Promise<TimeMachineResult> {
  const sequence: string[] = JSON.parse(row.node_sequence);
  const prereqEdges = edgesRepo.getAll(DEMO_STUDENT_ID).filter((e) => e.relationship_type === 'prerequisite');

  const totalDays = Math.max(1, daysBetween(row.created_at, row.exam_date));
  const totalWeeks = Math.max(1, Math.ceil(totalDays / CHECKPOINT_SPAN_DAYS));
  const baselineWeeklyLoad = sequence.length === 0 ? 0 : Math.max(1, Math.ceil(sequence.length / totalWeeks));

  const liveNodes = new Map<string, Node | undefined>();
  for (const id of sequence) liveNodes.set(id, nodesRepo.getById(id));

  function weekOf(index: number): number {
    if (baselineWeeklyLoad === 0) return 1;
    return Math.min(totalWeeks, Math.floor(index / baselineWeeklyLoad) + 1);
  }

  // GPS logic: contiguous green run from the front of the baseline sequence.
  let actualPosition = 0;
  while (actualPosition < sequence.length) {
    const n = liveNodes.get(sequence[actualPosition]!);
    if (!n || n.status !== 'green') break;
    actualPosition++;
  }

  const now = nowIso();
  const elapsedDays = Math.min(totalDays, Math.max(0, daysBetween(row.created_at, now)));
  const plannedPosition =
    sequence.length === 0 ? 0 : Math.min(sequence.length, Math.floor((elapsedDays / totalDays) * sequence.length));

  const daysPerNode = sequence.length === 0 ? 0 : totalDays / sequence.length;
  const diffNodes = actualPosition - plannedPosition;
  const verdict: TimeMachineVerdict = diffNodes > 0 ? 'ahead' : diffNodes < 0 ? 'behind' : 'on_track';
  const slipDays = Math.round(Math.abs(diffNodes) * daysPerNode);

  const nodesOut: TimeMachineNode[] = sequence.map((id, idx) => {
    const n = liveNodes.get(id);
    return {
      node_id: id,
      label: n?.label ?? id,
      subject: n?.subject ?? '',
      status: n?.status ?? 'red',
      week: weekOf(idx),
      state: idx < actualPosition ? 'done' : idx === actualPosition ? 'current' : 'upcoming',
    };
  });

  const checkpoints: TimeMachineCheckpoint[] = [];
  for (let w = 1; w <= totalWeeks; w++) {
    const prevCum = Math.min(sequence.length, (w - 1) * baselineWeeklyLoad);
    const cumCount = Math.min(sequence.length, w * baselineWeeklyLoad);
    const dateIso = w === totalWeeks ? row.exam_date : addDays(row.created_at, w * CHECKPOINT_SPAN_DAYS);
    const cumulativeIds = sequence.slice(0, cumCount);
    const actuallyGreen = cumulativeIds.filter((id) => liveNodes.get(id)?.status === 'green').length;
    checkpoints.push({
      week: w,
      date: dateIso,
      should_be_green: cumCount,
      actually_green: actuallyGreen,
      node_labels: sequence.slice(prevCum, cumCount).map((id) => liveNodes.get(id)?.label ?? id),
      is_past: Date.parse(dateIso) < Date.parse(now),
    });
  }

  const summary =
    sequence.length === 0
      ? 'Every concept is already mastered — nothing left to schedule.'
      : verdict === 'on_track'
        ? 'On pace for the exam date.'
        : verdict === 'ahead'
          ? `${Math.abs(diffNodes)} concept${Math.abs(diffNodes) === 1 ? '' : 's'} ahead of pace.`
          : `${slipDays} day${slipDays === 1 ? '' : 's'} behind pace — rerouted below.`;

  let reroute: TimeMachineReroute | null = null;
  let lastRerouted = row.last_rerouted_at;
  if (verdict === 'behind' && sequence.length > 0) {
    reroute = await buildReroute({
      row,
      sequence,
      liveNodes,
      actualPosition,
      totalWeeks,
      baselineWeeklyLoad,
      weekOf,
      prereqEdges,
      now,
      slipDays,
    });
    lastRerouted = reroute.reasoning !== row.reroute_because ? now : row.last_rerouted_at;
  } else {
    reroute = null;
    lastRerouted = null;
  }

  // Persist only the reroute METADATA (never the baseline sequence) so the
  // "last rerouted" moment is stable across repeated GETs rather than
  // ticking forward on every poll.
  if (reroute?.reasoning !== row.reroute_because || (!reroute && row.reroute_because !== null)) {
    updateRerouteMeta(row.id, lastRerouted, reroute?.reasoning ?? null);
  }

  return {
    id: row.id,
    goal: row.goal,
    exam_date: row.exam_date,
    created_at: row.created_at,
    nodes: nodesOut,
    checkpoints,
    verdict,
    slip_days: slipDays,
    summary,
    reroute,
    last_rerouted_at: lastRerouted,
  };
}

// ---------------------------------------------------------------------------
// persistence helpers
// ---------------------------------------------------------------------------

function insertRun(row: TmRunRow): void {
  db.prepare(
    `INSERT INTO tm_runs (id, student_id, goal, exam_date, node_sequence, created_at, last_rerouted_at, reroute_because)
     VALUES (@id, @student_id, @goal, @exam_date, @node_sequence, @created_at, @last_rerouted_at, @reroute_because)`,
  ).run(row);
}

function updateRerouteMeta(id: string, lastRerouted: string | null, reroutedBecause: string | null): void {
  db.prepare('UPDATE tm_runs SET last_rerouted_at = @last_rerouted_at, reroute_because = @reroute_because WHERE id = @id').run(
    { id, last_rerouted_at: lastRerouted, reroute_because: reroutedBecause },
  );
}

function findLatestRunRow(studentId: string): TmRunRow | null {
  const row = db
    .prepare('SELECT * FROM tm_runs WHERE student_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(studentId) as TmRunRow | undefined;
  return row ?? null;
}

let currentRunId: string | null = null;

function getActiveRunRow(): TmRunRow | null {
  if (currentRunId) {
    const row = db.prepare('SELECT * FROM tm_runs WHERE id = ?').get(currentRunId) as TmRunRow | undefined;
    if (row) return row;
  }
  const latest = findLatestRunRow(DEMO_STUDENT_ID);
  currentRunId = latest?.id ?? null;
  return latest;
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/** POST /api/timemachine — builds a brand-new baseline schedule. */
export async function createTimeMachineRun(goal: string | null, examDate: string | null): Promise<TimeMachineResult> {
  const created = nowIso();
  const trimmedGoal = goal && goal.trim().length > 0 ? goal.trim() : null;
  const parsedExamDate = examDate ? new Date(examDate) : null;
  const examDateIso =
    parsedExamDate && !Number.isNaN(parsedExamDate.getTime()) ? parsedExamDate.toISOString() : addDays(created, DEFAULT_HORIZON_DAYS);

  const sequence = buildBaselineSequence(trimmedGoal);

  const row: TmRunRow = {
    id: `tm_${nanoid(10)}`,
    student_id: DEMO_STUDENT_ID,
    goal: trimmedGoal,
    exam_date: examDateIso,
    node_sequence: JSON.stringify(sequence),
    created_at: created,
    last_rerouted_at: null,
    reroute_because: null,
  };
  insertRun(row);
  currentRunId = row.id;

  return computeResult(row);
}

/** GET /api/timemachine — current schedule + verdict, recomputed live. */
export async function getCurrentTimeMachine(): Promise<TimeMachineResult | null> {
  const row = getActiveRunRow();
  if (!row) return null;
  return computeResult(row);
}
