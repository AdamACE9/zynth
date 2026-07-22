/**
 * Autopsy Board pipeline. `analyze(text)` is the single entry point (called by
 * routes/autopsy.ts): given raw pasted homework/test text, it
 *
 *   1. extracts individual mistakes and maps each onto a KNOWN concept node
 *      (by label) or proposes a brand-new one,
 *   2. inserts any brand-new nodes (status:'red', engaged_at:null — this is
 *      the ONLY status statusService does not own: a plain birth-state INSERT,
 *      never a transition) and persists a MistakeRecord per mistake,
 *   3. clusters ALL of the student's mistakes (this run + everything already
 *      on file) looking for a single root cause surfacing across multiple,
 *      otherwise-unrelated concepts,
 *   4. wires up pairwise `correlated_error` edges for every multi-node
 *      cluster, guarded by edgesRepo.findBetween so re-running Autopsy on the
 *      same text is a safe no-op the second time.
 *
 * Every Gemini call here degrades to a deterministic, clearly-labelled
 * heuristic in STUB_MODE or on ANY failure (bad key, quota, malformed JSON) —
 * Autopsy must never hard-fail the demo.
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import {
  computeMasteryScore,
  type Edge,
  type ErrorType,
  type MistakeRecord,
  type Node,
} from '@zynth/shared';
import { config, STUB_MODE, DEMO_STUDENT_ID } from '../config';
import { nodesRepo, edgesRepo, mistakeRecordsRepo } from '../db/repositories';
import { emitAutopsyProgress, emitEdgeCreated, emitNodeCreated } from '../socket';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

const ERROR_TYPES: readonly ErrorType[] = ['concept_gap', 'careless_slip', 'prerequisite_gap'];

function isErrorType(v: unknown): v is ErrorType {
  return typeof v === 'string' && (ERROR_TYPES as readonly string[]).includes(v);
}

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// public shapes
// ---------------------------------------------------------------------------

export interface AutopsyMistake {
  excerpt: string;
  concept_label: string;
  matched_node_id: string | null;
  error_type: ErrorType;
}

export interface AutopsyCluster {
  pattern_label: string;
  description: string;
  node_ids: string[];
  error_type: ErrorType;
  confidence: number;
  example_excerpts: string[];
}

export interface AutopsyResult {
  mistakes: MistakeRecord[];
  clusters: AutopsyCluster[];
  new_edges: Edge[];
  new_nodes: Node[];
}

interface ClusterMistakeInput {
  node_id: string;
  node_label: string;
  excerpt: string;
  error_type: ErrorType;
}

// ---------------------------------------------------------------------------
// slug / subject inference helpers
// ---------------------------------------------------------------------------

function slugify(label: string): string {
  const slug = label
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return slug || 'concept';
}

function significantWords(label: string): string[] {
  return label
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length > 3);
}

/** Reuses an existing subject when the new concept's label shares vocabulary
 * with an existing node; otherwise falls back to the first known subject. */
function inferSubject(label: string, existingNodes: Node[]): string {
  const words = significantWords(label);
  let best: { subject: string; score: number } | null = null;
  for (const n of existingNodes) {
    const overlap = significantWords(n.label).filter((w) => words.includes(w)).length;
    if (overlap > 0 && (!best || overlap > best.score)) {
      best = { subject: n.subject, score: overlap };
    }
  }
  return best?.subject ?? existingNodes[0]?.subject ?? 'General';
}

// ---------------------------------------------------------------------------
// stage 1: extraction (Gemini + deterministic fallback)
// ---------------------------------------------------------------------------

const EXTRACT_SCHEMA = {
  type: 'object',
  properties: {
    mistakes: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          excerpt: { type: 'string' },
          concept_label: { type: 'string' },
          matched_node_id: { type: 'string' },
          error_type: { type: 'string' },
        },
        required: ['excerpt', 'concept_label', 'error_type'],
      },
    },
  },
  required: ['mistakes'],
} as const;

const SIGN_ERROR_PATTERN =
  /\bsign\b|\bnegative\b|dropped.*(minus|negative)|forgot.*(minus|negative)|misse?d.*(minus|sign)/i;
const CARELESS_PATTERN = /careless|typo|arithmetic slip|misread|copy error|copied.*wrong/i;
const PREREQUISITE_PATTERN = /didn'?t (apply|use|remember)|forgot to (apply|use)|prerequisite|never (learned|covered)/i;

function classifyErrorTypeHeuristic(excerpt: string): ErrorType {
  if (SIGN_ERROR_PATTERN.test(excerpt)) return 'concept_gap';
  if (CARELESS_PATTERN.test(excerpt)) return 'careless_slip';
  if (PREREQUISITE_PATTERN.test(excerpt)) return 'prerequisite_gap';
  return 'concept_gap';
}

function findMatchingNode(excerpt: string, existingNodes: Node[]): Node | undefined {
  const lower = excerpt.toLowerCase();
  const exact = existingNodes.find((n) => lower.includes(n.label.toLowerCase()));
  if (exact) return exact;
  return existingNodes.find((n) => {
    const words = significantWords(n.label);
    return words.length > 0 && words.every((w) => lower.includes(w));
  });
}

function deriveNewConceptLabel(excerpt: string): string {
  if (SIGN_ERROR_PATTERN.test(excerpt)) return 'Sign Handling in Differentiation';
  const words = excerpt.trim().split(/\s+/).slice(0, 6).join(' ');
  return words.replace(/[.,;:]+$/, '') || 'Unclassified Concept';
}

/** Deterministic extraction used in STUB_MODE and as a failure fallback: splits
 * the pasted text into lines and classifies each with keyword heuristics. */
function deterministicExtract(text: string, existingNodes: Node[]): AutopsyMistake[] {
  const lines = text
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*[-*\d]+[.)]?\s*/, '').trim())
    .filter((l) => l.length >= 8)
    .slice(0, 25);

  return lines.map((excerpt) => {
    const matched = findMatchingNode(excerpt, existingNodes);
    return {
      excerpt,
      concept_label: matched?.label ?? deriveNewConceptLabel(excerpt),
      matched_node_id: matched?.id ?? null,
      error_type: classifyErrorTypeHeuristic(excerpt),
    };
  });
}

async function extractMistakes(text: string, existingNodes: Node[]): Promise<AutopsyMistake[]> {
  if (STUB_MODE || !ai) {
    return deterministicExtract(text, existingNodes);
  }

  const knownConcepts = existingNodes.map((n) => ({ id: n.id, label: n.label, subject: n.subject }));
  const prompt = `You are triaging a student's mistakes from pasted homework/test text.

KNOWN CONCEPT NODES (map a mistake onto one of these by label whenever the underlying concept matches):
${JSON.stringify(knownConcepts)}

STUDENT TEXT:
"""
${text}
"""

Extract every distinct mistake you can identify. For each mistake return:
- "excerpt": the exact (or lightly cleaned) snippet showing the mistake.
- "concept_label": the specific concept the mistake belongs to. If it matches a KNOWN CONCEPT NODE's label (or an obvious synonym), use that EXACT label. Otherwise propose a short, precise NEW concept label naming the specific sub-skill — never a vague catch-all like "math errors".
- "matched_node_id": the "id" of the KNOWN CONCEPT NODE above whose label you used, or "" if this is a new concept.
- "error_type": one of "concept_gap" (doesn't understand the rule), "careless_slip" (understands it but slipped, e.g. arithmetic), or "prerequisite_gap" (missing an earlier concept this depends on).

Do not merge multiple distinct mistakes into one entry. Do not invent mistakes that aren't in the text.`;

  try {
    const res = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: EXTRACT_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2048,
      },
    });

    const raw = res.text;
    if (!raw) throw new Error('Gemini returned an empty response for autopsy extraction');

    const parsed = JSON.parse(raw) as { mistakes?: unknown };
    if (!Array.isArray(parsed.mistakes)) throw new Error('autopsy extraction response missing mistakes[]');

    const validNodeIds = new Set(existingNodes.map((n) => n.id));
    const out: AutopsyMistake[] = [];
    for (const item of parsed.mistakes) {
      const m = item as {
        excerpt?: unknown;
        concept_label?: unknown;
        matched_node_id?: unknown;
        error_type?: unknown;
      };
      if (typeof m.excerpt !== 'string' || !m.excerpt.trim()) continue;
      if (typeof m.concept_label !== 'string' || !m.concept_label.trim()) continue;
      const errorType = isErrorType(m.error_type) ? m.error_type : classifyErrorTypeHeuristic(m.excerpt);
      const matchedId =
        typeof m.matched_node_id === 'string' && validNodeIds.has(m.matched_node_id) ? m.matched_node_id : null;
      out.push({
        excerpt: m.excerpt.trim(),
        concept_label: m.concept_label.trim(),
        matched_node_id: matchedId,
        error_type: errorType,
      });
    }

    if (out.length === 0) throw new Error('autopsy extraction produced no valid mistakes');
    return out;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[autopsyService] extractMistakes failed, falling back to deterministic extraction:', err);
    return deterministicExtract(text, existingNodes);
  }
}

// ---------------------------------------------------------------------------
// stage 2: clustering (Gemini + deterministic fallback)
// ---------------------------------------------------------------------------

const CLUSTER_SCHEMA = {
  type: 'object',
  properties: {
    clusters: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          pattern_label: { type: 'string' },
          description: { type: 'string' },
          node_ids: { type: 'array', items: { type: 'string' } },
          error_type: { type: 'string' },
          confidence: { type: 'number' },
          example_excerpts: { type: 'array', items: { type: 'string' } },
        },
        required: ['pattern_label', 'description', 'node_ids', 'error_type', 'confidence'],
      },
    },
  },
  required: ['clusters'],
} as const;

const KEYWORD_PATTERNS: { label: string; description: string; regex: RegExp }[] = [
  {
    label: 'Sign-Flip / Dropped-Negative Errors',
    description:
      'A negative sign keeps getting dropped or mishandled across several derivative-chaining concepts — the gap is in tracking signs through multi-step differentiation, not any single rule.',
    regex: SIGN_ERROR_PATTERN,
  },
  {
    label: 'Chain Rule Misapplication',
    description: 'Several mistakes trace back to misapplying the chain rule itself, independent of the outer concept.',
    regex: /chain rule/i,
  },
];

function errorTypeLabel(t: ErrorType): string {
  switch (t) {
    case 'concept_gap':
      return 'Concept Gap';
    case 'careless_slip':
      return 'Careless Slip';
    case 'prerequisite_gap':
      return 'Prerequisite Gap';
  }
}

function sameNodeSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sa = new Set(a);
  return b.every((x) => sa.has(x));
}

function dominantErrorType(items: ClusterMistakeInput[]): ErrorType {
  const counts = new Map<ErrorType, number>();
  for (const i of items) counts.set(i.error_type, (counts.get(i.error_type) ?? 0) + 1);
  let best: ErrorType = 'concept_gap';
  let bestCount = -1;
  for (const [type, count] of counts) {
    if (count > bestCount) {
      best = type;
      bestCount = count;
    }
  }
  return best;
}

/** Deterministic clustering used in STUB_MODE and as a failure fallback: a
 * keyword pass looking for the same failure signature across >=2 distinct
 * nodes, then a fallback pass grouping by shared error_type. */
function deterministicCluster(mistakes: ClusterMistakeInput[]): AutopsyCluster[] {
  const clusters: AutopsyCluster[] = [];
  const covered = new Set<string>();

  for (const pattern of KEYWORD_PATTERNS) {
    const matches = mistakes.filter((m) => pattern.regex.test(m.excerpt));
    const nodeIds = Array.from(new Set(matches.map((m) => m.node_id)));
    if (nodeIds.length >= 2) {
      clusters.push({
        pattern_label: pattern.label,
        description: pattern.description,
        node_ids: nodeIds,
        error_type: dominantErrorType(matches),
        confidence: Math.min(0.95, 0.55 + 0.1 * nodeIds.length),
        example_excerpts: matches.slice(0, 3).map((m) => m.excerpt),
      });
      nodeIds.forEach((id) => covered.add(id));
    }
  }

  const byErrorType = new Map<ErrorType, ClusterMistakeInput[]>();
  for (const m of mistakes) {
    const bucket = byErrorType.get(m.error_type) ?? [];
    bucket.push(m);
    byErrorType.set(m.error_type, bucket);
  }
  for (const [errorType, group] of byErrorType) {
    const nodeIds = Array.from(new Set(group.map((m) => m.node_id)));
    if (nodeIds.length < 2) continue;
    if (clusters.some((c) => sameNodeSet(c.node_ids, nodeIds))) continue;
    clusters.push({
      pattern_label: `Recurring ${errorTypeLabel(errorType)} Pattern`,
      description: `${group.length} mistakes across ${nodeIds.length} concepts share the same underlying failure mode (${errorTypeLabel(
        errorType,
      ).toLowerCase()}), suggesting a common root cause rather than isolated slips.`,
      node_ids: nodeIds,
      error_type: errorType,
      confidence: 0.6,
      example_excerpts: group.slice(0, 3).map((m) => m.excerpt),
    });
  }

  return clusters;
}

async function clusterMistakes(mistakes: ClusterMistakeInput[]): Promise<AutopsyCluster[]> {
  if (mistakes.length === 0) return [];
  if (STUB_MODE || !ai) {
    return deterministicCluster(mistakes);
  }

  const prompt = `You are Zynth's Autopsy agent. Below is EVERY recorded mistake for this student so far, each tagged with the concept node it belongs to.

MISTAKES:
${JSON.stringify(mistakes)}

Find REAL recurring patterns that span TWO OR MORE DIFFERENT concept nodes (node_id) — e.g. the same kind of error (a sign flip, a dropped term, a misapplied rule) showing up across otherwise-unrelated-looking concepts. Do not report a "pattern" backed by only one concept. Only report patterns you are genuinely confident share the same underlying root cause, not superficial topical similarity.

For each pattern found, return:
- "pattern_label": a short, specific name for the pattern.
- "description": one or two plain-language sentences a student would understand, naming the actual root cause.
- "node_ids": the node_id values (copied exactly from MISTAKES above) involved — at least 2 distinct ids.
- "error_type": the dominant error_type for this pattern.
- "confidence": your confidence this is a real recurring pattern, 0 to 1.
- "example_excerpts": 2-3 excerpts from MISTAKES above that best illustrate it.

If there is no real cross-concept pattern, return an empty clusters array.`;

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
    if (!raw) throw new Error('Gemini returned an empty response for autopsy clustering');

    const parsed = JSON.parse(raw) as { clusters?: unknown };
    if (!Array.isArray(parsed.clusters)) throw new Error('autopsy clustering response missing clusters[]');

    const validNodeIds = new Set(mistakes.map((m) => m.node_id));
    const out: AutopsyCluster[] = [];
    for (const item of parsed.clusters) {
      const c = item as {
        pattern_label?: unknown;
        description?: unknown;
        node_ids?: unknown;
        error_type?: unknown;
        confidence?: unknown;
        example_excerpts?: unknown;
      };
      if (typeof c.pattern_label !== 'string' || !c.pattern_label.trim()) continue;
      if (typeof c.description !== 'string' || !c.description.trim()) continue;
      if (!Array.isArray(c.node_ids)) continue;
      const nodeIds = Array.from(
        new Set(c.node_ids.filter((id): id is string => typeof id === 'string' && validNodeIds.has(id))),
      );
      if (nodeIds.length < 2) continue;
      const errorType = isErrorType(c.error_type) ? c.error_type : 'concept_gap';
      const confidence =
        typeof c.confidence === 'number' && Number.isFinite(c.confidence) ? Math.max(0, Math.min(1, c.confidence)) : 0.6;
      const exampleExcerpts = Array.isArray(c.example_excerpts)
        ? c.example_excerpts.filter((s): s is string => typeof s === 'string').slice(0, 3)
        : [];
      out.push({
        pattern_label: c.pattern_label.trim(),
        description: c.description.trim(),
        node_ids: nodeIds,
        error_type: errorType,
        confidence,
        example_excerpts: exampleExcerpts,
      });
    }

    // A well-formed-but-empty response is a legitimate "no pattern found" —
    // only fall back to the deterministic pass if parsing genuinely failed
    // (handled by the catch block below), not just because it's empty.
    return out;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[autopsyService] clusterMistakes failed, falling back to deterministic clustering:', err);
    return deterministicCluster(mistakes);
  }
}

// ---------------------------------------------------------------------------
// orchestration
// ---------------------------------------------------------------------------

export async function analyze(text: string): Promise<AutopsyResult> {
  emitAutopsyProgress({ message: 'Extracting mistakes…' });

  const existingNodes = nodesRepo.getAll(DEMO_STUDENT_ID);
  const nodesById = new Map(existingNodes.map((n) => [n.id, n]));
  const nodesByLabelLower = new Map(existingNodes.map((n) => [n.label.toLowerCase(), n]));

  const extracted = await extractMistakes(text, existingNodes);

  const newNodes: Node[] = [];
  const mistakeRecords: MistakeRecord[] = [];

  for (const m of extracted) {
    let nodeId = m.matched_node_id && nodesById.has(m.matched_node_id) ? m.matched_node_id : null;

    if (!nodeId) {
      const byLabel = nodesByLabelLower.get(m.concept_label.trim().toLowerCase());
      if (byLabel) nodeId = byLabel.id;
    }

    if (!nodeId) {
      // Brand-new concept: born status:'red', engaged_at:null — a plain
      // insert, never a transition. statusService remains untouched.
      const label = m.concept_label.trim() || 'Unclassified Concept';
      let id = `node_${slugify(label)}`;
      let suffix = 2;
      while (nodesById.has(id)) {
        id = `node_${slugify(label)}_${suffix}`;
        suffix += 1;
      }
      const subject = inferSubject(label, existingNodes);
      const ts = nowIso();
      const node: Node = {
        id,
        student_id: DEMO_STUDENT_ID,
        label,
        subject,
        cluster: subject,
        status: 'red',
        mastery_score: computeMasteryScore({ status: 'red', last_quiz_result: null, engaged_at: null }),
        engaged_at: null,
        last_quiz_passed_at: null,
        last_quiz_result: null,
        retest_count: 0,
        history: [],
        x: null,
        y: null,
        z: null,
        created_at: ts,
        updated_at: ts,
      };
      nodesRepo.insert(node);
      emitNodeCreated(node);
      newNodes.push(node);
      nodesById.set(id, node);
      nodesByLabelLower.set(label.toLowerCase(), node);
      nodeId = id;
    }

    const record: MistakeRecord = {
      id: `mistake_${nanoid(10)}`,
      student_id: DEMO_STUDENT_ID,
      node_id: nodeId,
      source: 'uploaded_homework',
      raw_excerpt: m.excerpt,
      error_type: m.error_type,
      created_at: nowIso(),
    };
    mistakeRecordsRepo.insert(record);
    mistakeRecords.push(record);
  }

  emitAutopsyProgress({
    message: `Extracted ${extracted.length} mistake${extracted.length === 1 ? '' : 's'} — clustering patterns…`,
  });

  // Cluster across EVERY mistake on file for this student, not just this run.
  const allMistakes = mistakeRecordsRepo.getByStudent(DEMO_STUDENT_ID);
  const clusterInput: ClusterMistakeInput[] = allMistakes.map((mr) => {
    const node = nodesById.get(mr.node_id) ?? nodesRepo.getById(mr.node_id);
    return {
      node_id: mr.node_id,
      node_label: node?.label ?? mr.node_id,
      excerpt: mr.raw_excerpt,
      error_type: mr.error_type,
    };
  });

  const clusters = await clusterMistakes(clusterInput);

  emitAutopsyProgress({ message: `Found ${clusters.length} pattern${clusters.length === 1 ? '' : 's'}.` });

  const newEdges: Edge[] = [];
  for (const cluster of clusters) {
    const uniqueNodeIds = Array.from(new Set(cluster.node_ids.filter((id) => nodesById.has(id))));
    if (uniqueNodeIds.length < 2) continue;

    for (let i = 0; i < uniqueNodeIds.length; i += 1) {
      for (let j = i + 1; j < uniqueNodeIds.length; j += 1) {
        const a = uniqueNodeIds[i] as string;
        const b = uniqueNodeIds[j] as string;
        if (edgesRepo.findBetween(a, b, 'correlated_error')) continue; // idempotent

        const edge: Edge = {
          id: `edge_autopsy_${nanoid(10)}`,
          student_id: DEMO_STUDENT_ID,
          source_node_id: a,
          target_node_id: b,
          relationship_type: 'correlated_error',
          strength: cluster.confidence,
          discovered_by: 'autopsy',
          created_at: nowIso(),
        };
        edgesRepo.insert(edge);
        emitEdgeCreated(edge);
        newEdges.push(edge);

        const labelA = nodesById.get(a)?.label ?? a;
        const labelB = nodesById.get(b)?.label ?? b;
        emitAutopsyProgress({ message: `Connected ${labelA} ↔ ${labelB}` });
      }
    }
  }

  return { mistakes: mistakeRecords, clusters, new_edges: newEdges, new_nodes: newNodes };
}
