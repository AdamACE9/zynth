/**
 * Study-Plan Board + Ghost Path (Day 3).
 *
 * `createPlan(goal)` reads the WHOLE graph and builds an ordered
 * `node_sequence` toward the goal, respecting prerequisite edges by
 * construction (see `buildNodeSequence` / `topoSortByPriority` below — a real
 * Kahn's-algorithm topological sort over `relationship_type === 'prerequisite'`
 * edges; the LLM is only ever consulted for WHICH nodes matter and roughly
 * how much, never for the final order, so it is structurally impossible for
 * the route to violate a prerequisite).
 *
 * `getCurrentGhostPath()` turns the persisted PlanPath into the GPS-ETA
 * comparison the client renders (planned vs. actual position).
 *
 * -- THE KEY REQUIREMENT: silent, automatic re-planning ---------------------
 * The student never presses "replan". This module subscribes to
 * `statusService.onStatusChanged`, an explicit in-process listener registry
 * that fires from inside the only two functions permitted to change
 * Node.status. So the plan reroutes on exactly the real transitions
 * (engage / quiz_passed / quiz_failed) and never on a mastery_score or
 * last_quiz_result write that leaves status untouched.
 *
 * Replans are debounced (REPLAN_DEBOUNCE_MS) so a multi-node quiz flipping
 * several nodes at once produces ONE reroute, not five. `replanned_because`
 * records the concrete cause, e.g. "Chain Rule dropped to amber on a failed
 * retest", and `plan:updated` carries the recomputed GhostPath to the client.
 * ---------------------------------------------------------------------------
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import type {
  Edge,
  GhostPath,
  GhostVerdict,
  Node,
  PlanPath,
  PlanStep,
  Status,
  StatusChangeCause,
} from '@zynth/shared';
import { config, STUB_MODE, getActiveStudentId } from '../config';
import { db } from '../db/connection';
import { nodesRepo, edgesRepo, planPathsRepo } from '../db/repositories';
import { emitPlanUpdated } from '../socket';
import { onStatusChanged } from './statusService';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// small text helpers (deliberately duplicated from autopsyService rather than
// importing across feature boundaries — that file isn't ours to couple to)
// ---------------------------------------------------------------------------

function significantWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
}

// ---------------------------------------------------------------------------
// stage 1: which nodes matter for this goal, roughly how much (Gemini + fallback)
// ---------------------------------------------------------------------------

const PLAN_SCHEMA = {
  type: 'object',
  properties: {
    node_ids: { type: 'array', items: { type: 'string' } },
    reasoning: { type: 'string' },
  },
  required: ['node_ids', 'reasoning'],
} as const;

/** Deterministic ranking used in STUB_MODE and as a failure fallback: scores
 * each red/amber candidate by keyword overlap with the goal text, falling
 * back to "everything not yet mastered" when the goal shares no vocabulary
 * with any node (a generic goal like "catch up"). */
function deterministicRank(goal: string, candidates: Node[]): string[] {
  const goalWords = significantWords(goal);
  const scored = candidates.map((n) => {
    const words = significantWords(`${n.label} ${n.subject}`);
    const overlap = goalWords.length === 0 ? 0 : words.filter((w) => goalWords.includes(w)).length;
    return { node: n, score: overlap };
  });
  const anyMatch = scored.some((s) => s.score > 0);
  const pool = anyMatch ? scored.filter((s) => s.score > 0) : scored;
  pool.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (a.node.status !== b.node.status) return a.node.status === 'red' ? -1 : 1;
    return 0;
  });
  return pool.map((s) => s.node.id);
}

async function rankRelevantNodes(goal: string, candidates: Node[]): Promise<{ ids: string[]; reasoning: string }> {
  if (candidates.length === 0) {
    return {
      ids: [],
      reasoning: 'No red or amber concepts remain for this student — every prerequisite is already mastered.',
    };
  }

  if (STUB_MODE || !ai) {
    return {
      ids: deterministicRank(goal, candidates),
      reasoning: '[stub:planner] Ranked candidates by keyword overlap between the goal and each concept.',
    };
  }

  const candidateList = candidates.map((n) => ({ id: n.id, label: n.label, subject: n.subject, status: n.status }));
  const prompt = `You are Zynth's Planner agent building a study route toward a student's stated goal.

GOAL: "${goal}"

CANDIDATE CONCEPTS (already filtered to red = not yet engaged, or amber = engaged but not yet proven; mastered/green concepts are excluded up front and never belong in the route):
${JSON.stringify(candidateList)}

Select and rank the concepts from CANDIDATE CONCEPTS that actually matter for reaching this goal, most important/blocking first. Leave out concepts from a clearly unrelated subject unless the goal is broad enough to need them. Never invent an id that is not listed above.

Return:
- "node_ids": the relevant candidate ids, ordered most important first. Omit irrelevant ones entirely.
- "reasoning": one or two sentences explaining the selection/order, for an internal log.`;

  try {
    const res = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: PLAN_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 1024,
      },
    });

    const raw = res.text;
    if (!raw) throw new Error('Gemini returned an empty response for plan ranking');

    const parsed = JSON.parse(raw) as { node_ids?: unknown; reasoning?: unknown };
    if (!Array.isArray(parsed.node_ids)) throw new Error('plan ranking response missing node_ids[]');

    const validIds = new Set(candidates.map((n) => n.id));
    const ids = Array.from(
      new Set(parsed.node_ids.filter((id): id is string => typeof id === 'string' && validIds.has(id))),
    );
    const reasoning =
      typeof parsed.reasoning === 'string' && parsed.reasoning.trim()
        ? parsed.reasoning.trim()
        : 'Gemini ranked candidates by relevance to the goal.';

    if (ids.length === 0) {
      // A well-formed-but-empty ranking would leave an unreachable route for
      // a feature whose whole point is producing one — fall back rather than
      // silently returning nothing.
      return {
        ids: deterministicRank(goal, candidates),
        reasoning: `${reasoning} (Gemini selected none — falling back to keyword ranking.)`,
      };
    }
    return { ids, reasoning };
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[planService] rankRelevantNodes failed, falling back to deterministic ranking:', err);
    return {
      ids: deterministicRank(goal, candidates),
      reasoning: '[stub:planner:error-fallback] Ranked candidates by keyword overlap between the goal and each concept.',
    };
  }
}

// ---------------------------------------------------------------------------
// stage 2: topological ordering — the LLM only ever prioritises WITHIN what
// is legal. We build the full prerequisite DAG ourselves and run Kahn's
// algorithm; the LLM's ranking is used SOLELY as the tie-break among nodes
// that are simultaneously "ready" (no outstanding prerequisite in the
// included set). This makes an illegal order structurally impossible — there
// is no post-hoc "validate and repair the LLM's order" step because the LLM
// never produces an order in the first place, only a relevance ranking.
// ---------------------------------------------------------------------------

/** Expands a relevant-node set with any not-yet-green prerequisite ancestors
 * (transitively) so the route is actually walkable — e.g. asking about
 * Related Rates always pulls in an unmastered Implicit Differentiation even
 * if the LLM didn't name it directly. Already-green ancestors are left out:
 * they're satisfied, so they'd just pad the route. */
function expandWithUnmetPrerequisites(
  seedIds: Set<string>,
  nodesById: Map<string, Node>,
  prereqEdges: Edge[],
): Set<string> {
  const ancestorsOf = new Map<string, string[]>();
  for (const e of prereqEdges) {
    const arr = ancestorsOf.get(e.target_node_id) ?? [];
    arr.push(e.source_node_id);
    ancestorsOf.set(e.target_node_id, arr);
  }

  const included = new Set(seedIds);
  const stack = Array.from(seedIds);
  while (stack.length > 0) {
    const id = stack.pop()!;
    for (const ancestorId of ancestorsOf.get(id) ?? []) {
      if (included.has(ancestorId)) continue;
      const ancestor = nodesById.get(ancestorId);
      if (ancestor && ancestor.status !== 'green') {
        included.add(ancestorId);
        stack.push(ancestorId);
      }
    }
  }
  return included;
}

/** Kahn's algorithm over the included subgraph, restricted to prerequisite
 * edges whose endpoints are both included. Ties among simultaneously-ready
 * nodes are broken by `scoreOf` (LLM relevance rank, then red-before-amber,
 * then stable graph order) — never by anything that could violate an edge. */
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

  // Only reachable with a malformed (cyclic) prerequisite graph — append
  // whatever's left in a stable order rather than silently dropping nodes.
  if (result.length < included.size) {
    const seen = new Set(result);
    const rest = Array.from(included)
      .filter((id) => !seen.has(id))
      .sort((a, b) => stableIndexOf(a) - stableIndexOf(b));
    result.push(...rest);
  }

  return result;
}

interface BuiltRoute {
  sequence: string[];
  reasoning: string;
}

/** Builds the full ordered route for a goal from the CURRENT graph state. */
export async function buildNodeSequence(goal: string): Promise<BuiltRoute> {
  const nodes = nodesRepo.getAll(getActiveStudentId());
  const edges = edgesRepo.getAll(getActiveStudentId());
  const prereqEdges = edges.filter((e) => e.relationship_type === 'prerequisite');
  const nodesById = new Map(nodes.map((n) => [n.id, n]));
  const stableIndexOf = new Map(nodes.map((n, i) => [n.id, i]));

  // Prioritise red/amber nodes that block the goal; never pad with green.
  const blocking = nodes.filter((n) => n.status !== 'green');
  const { ids: rankedIds, reasoning } = await rankRelevantNodes(goal, blocking);

  const included = expandWithUnmetPrerequisites(new Set(rankedIds), nodesById, prereqEdges);

  const rankIndex = new Map(rankedIds.map((id, i) => [id, i]));
  function scoreOf(id: string): number {
    const idx = rankIndex.get(id);
    // Nodes the LLM/heuristic explicitly ranked score highest, most-relevant
    // first; pure prerequisite-ancestors that weren't named directly still
    // get a modest baseline so they don't lose every tie against them.
    const rankScore = idx === undefined ? 0 : (rankedIds.length - idx) * 10;
    const node = nodesById.get(id);
    const statusBonus = node?.status === 'red' ? 1 : 0;
    return rankScore + statusBonus;
  }

  const sequence = topoSortByPriority(included, prereqEdges, scoreOf, (id) => stableIndexOf.get(id) ?? 0);

  return { sequence, reasoning };
}

// ---------------------------------------------------------------------------
// GhostPath derivation — the GPS-ETA comparison
// ---------------------------------------------------------------------------

/** Assumed study horizon from plan creation to the goal, spread evenly across
 * the route: a fixed-pace "even pace across the sequence" model, chosen over
 * per-node time estimates because we have no real signal for how long any
 * concept takes an individual student — an even split over a flat 14-day
 * horizon is the most honest thing we can claim without inventing data. */
const GOAL_HORIZON_DAYS = 14;

/** Actual progress: how many steps from the START of the route are green,
 * counted contiguously (a later green node reached out of order doesn't
 * count as "having arrived" if an earlier step on the route is still
 * unproven — same as a GPS not crediting you for a road you skipped). */
function computeActualPosition(sequence: string[]): number {
  let i = 0;
  while (i < sequence.length) {
    const node = nodesRepo.getById(sequence[i]!);
    if (!node || node.status !== 'green') break;
    i++;
  }
  return i;
}

function computePlannedPosition(plan: PlanPath, sequenceLength: number): number {
  if (sequenceLength === 0) return 0;
  const createdMs = Date.parse(plan.created_at);
  if (Number.isNaN(createdMs)) return 0;
  const elapsedDays = Math.max(0, (Date.now() - createdMs) / (1000 * 60 * 60 * 24));
  const fraction = Math.min(1, elapsedDays / GOAL_HORIZON_DAYS);
  return Math.min(sequenceLength, Math.floor(fraction * sequenceLength));
}

export function computeGhostPath(plan: PlanPath): GhostPath {
  const steps: PlanStep[] = plan.node_sequence.map((nodeId, index) => {
    const node = nodesRepo.getById(nodeId);
    return {
      node_id: nodeId,
      label: node?.label ?? nodeId,
      index,
      status: node?.status ?? ('red' as Status),
      state: 'upcoming' as PlanStep['state'],
    };
  });

  const actualPosition = computeActualPosition(plan.node_sequence);
  steps.forEach((step, i) => {
    if (i < actualPosition) step.state = 'done';
    else if (i === actualPosition) step.state = 'current';
    else step.state = 'upcoming';
  });

  const plannedPosition = computePlannedPosition(plan, steps.length);
  const verdict: GhostVerdict =
    actualPosition > plannedPosition ? 'ahead' : actualPosition < plannedPosition ? 'behind' : 'on_track';
  const diff = Math.abs(actualPosition - plannedPosition);

  const summary =
    steps.length === 0
      ? 'Every concept on this route is already mastered — goal achieved.'
      : verdict === 'on_track'
        ? 'Right on pace with the plan.'
        : verdict === 'ahead'
          ? `${diff} concept${diff === 1 ? '' : 's'} ahead of schedule.`
          : `${diff} concept${diff === 1 ? '' : 's'} behind schedule.`;

  return {
    plan_id: plan.id,
    goal: plan.goal,
    steps,
    planned_position: plannedPosition,
    actual_position: actualPosition,
    verdict,
    summary,
    last_replanned_at: plan.last_replanned_at,
    replanned_because: plan.replanned_because,
  };
}

// ---------------------------------------------------------------------------
// persistence — planPathsRepo (frozen) only exposes insert/getById, no
// update. The schema clearly intends ONE plan row that gets amended in place
// on replan (that's what last_replanned_at/replanned_because mean), so we
// issue a raw UPDATE against the already-open `db` handle for that — this
// touches only the plan_paths table, never repositories.ts itself, and never
// nodes/status (planning only ever READS Node.status).
// ---------------------------------------------------------------------------

function updatePlanRow(plan: PlanPath): void {
  db.prepare(
    `UPDATE plan_paths SET
      node_sequence = @node_sequence,
      current_position = @current_position,
      last_replanned_at = @last_replanned_at,
      replanned_because = @replanned_because
    WHERE id = @id`,
  ).run({
    id: plan.id,
    node_sequence: JSON.stringify(plan.node_sequence),
    current_position: plan.current_position,
    last_replanned_at: plan.last_replanned_at,
    replanned_because: plan.replanned_because,
  });
}

function findLatestPlanId(studentId: string): string | null {
  const row = db
    .prepare('SELECT id FROM plan_paths WHERE student_id = ? ORDER BY created_at DESC LIMIT 1')
    .get(studentId) as { id: string } | undefined;
  return row?.id ?? null;
}

// Keyed by student_id (= workspace) rather than a single scalar — otherwise
// switching the active workspace would keep serving/replanning whichever
// workspace's plan happened to be cached first.
const currentPlanIdByStudent = new Map<string, string>();

function getActivePlan(): PlanPath | undefined {
  const studentId = getActiveStudentId();
  let planId = currentPlanIdByStudent.get(studentId);
  if (!planId) {
    const found = findLatestPlanId(studentId);
    if (!found) return undefined;
    planId = found;
    currentPlanIdByStudent.set(studentId, planId);
  }
  return planPathsRepo.getById(planId);
}

// ---------------------------------------------------------------------------
// public API
// ---------------------------------------------------------------------------

/** POST /api/plan — builds a brand-new route and makes it the active plan. */
export async function createPlan(goal: string): Promise<GhostPath> {
  const studentId = getActiveStudentId();
  const trimmedGoal = goal.trim();
  const { sequence } = await buildNodeSequence(trimmedGoal);
  const now = nowIso();

  const plan: PlanPath = {
    id: `plan_${nanoid(10)}`,
    student_id: studentId,
    goal: trimmedGoal,
    node_sequence: sequence,
    current_position: computeActualPosition(sequence),
    last_replanned_at: null,
    replanned_because: null,
    created_at: now,
  };
  planPathsRepo.insert(plan);
  currentPlanIdByStudent.set(studentId, plan.id);

  return computeGhostPath(plan);
}

/** GET /api/plan — the current plan as a computed GhostPath, or null if none exists. */
export function getCurrentGhostPath(): GhostPath | null {
  const plan = getActivePlan();
  if (!plan) return null;
  return computeGhostPath(plan);
}

// ---------------------------------------------------------------------------
// automatic silent re-planning
// ---------------------------------------------------------------------------

const REPLAN_DEBOUNCE_MS = 900;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pendingReasons: string[] = [];

function describeStatusChange(node: Node, cause: StatusChangeCause, previousStatus: Status): string {
  switch (cause) {
    case 'engage':
      return `${node.label} moved from red to amber (first engagement).`;
    case 'quiz_passed':
      return `${node.label} reached green after a passing quiz.`;
    case 'quiz_failed':
      return `${node.label} dropped to amber on a failed retest.`;
    default:
      return `${node.label} changed from ${previousStatus} to ${node.status}.`;
  }
}

function summarizeReasons(reasons: string[]): string {
  const unique = Array.from(new Set(reasons));
  if (unique.length <= 1) return unique[0] ?? 'Mastery changed.';
  if (unique.length <= 3) return unique.join(' ');
  return `${unique.slice(0, 2).join(' ')} (+${unique.length - 2} more mastery changes.)`;
}

async function runReplan(reasons: string[]): Promise<void> {
  try {
    const plan = getActivePlan();
    if (!plan) return; // no active plan to reroute — nothing to do, stays silent

    const { sequence } = await buildNodeSequence(plan.goal);
    const because = summarizeReasons(reasons);
    const updated: PlanPath = {
      ...plan,
      node_sequence: sequence,
      current_position: computeActualPosition(sequence),
      last_replanned_at: nowIso(),
      replanned_because: because,
    };
    updatePlanRow(updated);

    const ghost = computeGhostPath(updated);
    emitPlanUpdated({ ghost, because });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[planService] automatic replan failed:', err);
  }
}

function queueReplan(reason: string): void {
  pendingReasons.push(reason);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    const reasons = pendingReasons;
    pendingReasons = [];
    debounceTimer = null;
    void runReplan(reasons);
  }, REPLAN_DEBOUNCE_MS);
}

interface StatusChangedPayload {
  node: Node;
  cause: StatusChangeCause;
  previous_status: Status;
}

let hookInstalled = false;

/**
 * Subscribes to committed mastery transitions so the plan reroutes ITSELF.
 *
 * This is the whole point of the module: the student never presses "replan".
 * `statusService.onStatusChanged` fires from inside the two intent functions
 * that are the only legal way to change Node.status, so we hear about every
 * real transition — engage, quiz_passed, quiz_failed — and nothing else.
 *
 * (An earlier version proxied socket.io's Server.prototype.emit to sniff the
 * broadcast instead. That worked, but hooking a library's prototype to learn
 * about our own domain events is far too clever to leave in — the listener
 * registry is explicit and cannot be broken by a socket.io upgrade.)
 *
 * Idempotent: safe to call more than once.
 */
function installStatusChangeHook(): void {
  if (hookInstalled) return;
  hookInstalled = true;

  onStatusChanged(({ node, cause, previous_status }) => {
    queueReplan(describeStatusChange(node, cause, previous_status));
  });

  // eslint-disable-next-line no-console
  console.log('[planService] automatic replan listener subscribed to statusService');
}

installStatusChangeHook();
