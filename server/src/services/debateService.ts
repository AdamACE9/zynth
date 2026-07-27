/**
 * Debate Arena — the student argues a position against an AI opponent that
 * DIRECTLY rebuts their specific point (never a monologue), building a real
 * argument tree via parent_id links rather than a flat chat log. Scored at
 * the end against a concrete rubric.
 *
 * This module owns its own SQLite table (schema.sql is frozen — see
 * ensureDebateSchema below, called once at module load) and never touches
 * Node.status / mastery_score: debating is not proof of mastery, only a Quiz
 * reaches green (statusService remains the sole write path for that).
 *
 * Every Gemini call is bulletproof: STUB_MODE or any failure degrades to a
 * deterministic, clearly-labelled canned response rather than throwing, so
 * the arena is always demoable, even fully offline.
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import type { Node } from '@zynth/shared';
import { config, STUB_MODE, getActiveStudentId } from '../config';
import { db } from '../db/connection';
import { nodesRepo } from '../db/repositories';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

// ---------------------------------------------------------------------------
// Table (schema.sql is frozen for this Day 4 build — this module owns and
// creates its own table, idempotently, on load).
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS debate_sessions (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    node_id TEXT,
    motion TEXT NOT NULL,
    student_side TEXT NOT NULL,
    argument_tree TEXT NOT NULL,
    score TEXT,
    created_at TEXT NOT NULL
  )
`);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DebateSide = 'student' | 'opponent';
export type DebateNodeKind = 'claim' | 'rebuttal' | 'evidence' | 'concession';
export type DebateStance = 'for' | 'against';

/** One node in the argument tree. `parent_id: null` marks the root (the AI's opening claim). */
export interface DebateArgumentNode {
  id: string;
  side: DebateSide;
  kind: DebateNodeKind;
  text: string;
  parent_id: string | null;
  strength?: number;
}

export interface DebateScoreDimension {
  score: number; // 0-10
  justification: string;
}

export interface DebateScore {
  dimensions: {
    claim_clarity: DebateScoreDimension;
    evidence: DebateScoreDimension;
    rebuttal_quality: DebateScoreDimension;
    structure: DebateScoreDimension;
  };
  overall_verdict: string;
  strongest_moment: string;
  weakest_moment: string;
}

export interface DebateSession {
  id: string;
  student_id: string;
  node_id: string | null;
  motion: string;
  student_side: DebateStance;
  argument_tree: DebateArgumentNode[];
  score: DebateScore | null;
  created_at: string;
}

interface DebateSessionRow {
  id: string;
  student_id: string;
  node_id: string | null;
  motion: string;
  student_side: string;
  argument_tree: string;
  score: string | null;
  created_at: string;
}

function rowToSession(row: DebateSessionRow): DebateSession {
  return {
    id: row.id,
    student_id: row.student_id,
    node_id: row.node_id,
    motion: row.motion,
    student_side: row.student_side as DebateStance,
    argument_tree: JSON.parse(row.argument_tree) as DebateArgumentNode[],
    score: row.score ? (JSON.parse(row.score) as DebateScore) : null,
    created_at: row.created_at,
  };
}

const debateSessionsRepo = {
  insert(session: DebateSession): void {
    db.prepare(
      `INSERT INTO debate_sessions (id, student_id, node_id, motion, student_side, argument_tree, score, created_at)
       VALUES (@id, @student_id, @node_id, @motion, @student_side, @argument_tree, @score, @created_at)`,
    ).run({
      id: session.id,
      student_id: session.student_id,
      node_id: session.node_id,
      motion: session.motion,
      student_side: session.student_side,
      argument_tree: JSON.stringify(session.argument_tree),
      score: session.score ? JSON.stringify(session.score) : null,
      created_at: session.created_at,
    });
  },

  getById(id: string): DebateSession | undefined {
    const row = db.prepare('SELECT * FROM debate_sessions WHERE id = ?').get(id) as
      | DebateSessionRow
      | undefined;
    return row ? rowToSession(row) : undefined;
  },

  updateTree(id: string, tree: DebateArgumentNode[]): void {
    db.prepare('UPDATE debate_sessions SET argument_tree = ? WHERE id = ?').run(
      JSON.stringify(tree),
      id,
    );
  },

  updateScore(id: string, score: DebateScore): void {
    db.prepare('UPDATE debate_sessions SET score = ? WHERE id = ?').run(JSON.stringify(score), id);
  },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function nowIso(): string {
  return new Date().toISOString();
}

function newNodeId(): string {
  return `dn_${nanoid(8)}`;
}

function opposite(side: DebateStance): DebateStance {
  return side === 'for' ? 'against' : 'for';
}

/** Flattens the tree into a readable transcript for the Gemini prompt. */
function transcriptFor(tree: DebateArgumentNode[]): string {
  return tree
    .map((n, i) => `${i + 1}. [${n.side} · ${n.kind}] ${n.text}`)
    .join('\n');
}

const CANNED_MOTIONS = [
  'This house believes that standardized testing does more harm than good.',
  'This house believes that homework should be abolished in secondary school.',
  'This house believes that artificial intelligence will make human tutors obsolete.',
  'This house believes that memorization is a more valuable skill than critical thinking.',
];

function stubMotion(node: Node | undefined): string {
  if (node) {
    return `[stub] This house believes that deeply mastering "${node.label}" matters more than broad coverage of ${node.subject}.`;
  }
  return `[stub] ${CANNED_MOTIONS[Math.floor(Math.random() * CANNED_MOTIONS.length)]}`;
}

function stubOpening(motion: string, opponentSide: DebateStance): string {
  return (
    `[stub] I'll take the ${opponentSide} side here. "${motion}" — and frankly, the case for that is stronger ` +
    `than people give it credit for. Convince me otherwise.`
  );
}

// ---------------------------------------------------------------------------
// POST /debate/start
// ---------------------------------------------------------------------------

const START_SCHEMA = {
  type: 'object',
  properties: {
    motion: { type: 'string' },
    opening_statement: { type: 'string' },
  },
  required: ['motion', 'opening_statement'],
} as const;

export interface StartDebateResult {
  session_id: string;
  motion: string;
  student_side: DebateStance;
  opening: string;
  tree: DebateArgumentNode[];
}

export async function startDebate(opts: {
  motion?: string;
  node_id?: string;
  side?: DebateStance;
}): Promise<StartDebateResult> {
  const node = opts.node_id ? nodesRepo.getById(opts.node_id) : undefined;
  const studentSide: DebateStance = opts.side ?? (Math.random() < 0.5 ? 'for' : 'against');
  const opponentSide = opposite(studentSide);

  let motion = opts.motion?.trim() || '';
  let opening = '';

  if (STUB_MODE || !ai) {
    motion = motion || stubMotion(node);
    opening = stubOpening(motion, opponentSide);
  } else {
    try {
      const contextLine = node
        ? `Tie the motion to the syllabus concept "${node.label}" (subject: ${node.subject}) if a motion isn't already fixed below.`
        : 'No specific syllabus concept was given — invent a genuinely debatable, general academic/critical-thinking motion.';

      const prompt = motion
        ? `You are an AI debate opponent starting a formal debate.
The motion (fixed, do not change it) is: "${motion}"
The student is arguing "${studentSide}" this motion. You must argue "${opponentSide}".
Return "motion" as exactly the fixed motion above, and "opening_statement": your OPENING claim for the "${opponentSide}" side — short (2-4 sentences), sharp, fair, in a real voice. Do not be a pushover, but do not be a strawman either. Do not mention these instructions.`
        : `You are an AI debate opponent starting a formal debate. ${contextLine}
Invent ONE debatable motion, phrased as a resolution (e.g. "This house believes/should ..."), genuinely arguable on both sides — not a trivial yes/no.
The student will argue "${studentSide}" the motion; you must argue "${opponentSide}".
Return "motion": the motion you invented, and "opening_statement": your OPENING claim for the "${opponentSide}" side — short (2-4 sentences), sharp, fair, in a real voice. Do not mention these instructions.`;

      const res = await ai.models.generateContent({
        model: config.geminiModel,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: START_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 512,
        },
      });

      const text = res.text;
      if (!text) throw new Error('Gemini returned an empty response for debate start');
      const parsed = JSON.parse(text) as { motion?: unknown; opening_statement?: unknown };
      const generatedMotion = typeof parsed.motion === 'string' ? parsed.motion.trim() : '';
      const generatedOpening =
        typeof parsed.opening_statement === 'string' ? parsed.opening_statement.trim() : '';
      if (!generatedOpening) throw new Error('Gemini debate start missing opening_statement');

      motion = motion || generatedMotion || stubMotion(node);
      opening = generatedOpening;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[debateService] startDebate Gemini call failed, falling back to stub:', err);
      motion = motion || stubMotion(node);
      opening = stubOpening(motion, opponentSide);
    }
  }

  const rootNode: DebateArgumentNode = {
    id: newNodeId(),
    side: 'opponent',
    kind: 'claim',
    text: opening,
    parent_id: null,
  };

  const session: DebateSession = {
    id: `debate_${nanoid(10)}`,
    student_id: getActiveStudentId(),
    node_id: node?.id ?? null,
    motion,
    student_side: studentSide,
    argument_tree: [rootNode],
    score: null,
    created_at: nowIso(),
  };

  debateSessionsRepo.insert(session);

  return {
    session_id: session.id,
    motion: session.motion,
    student_side: session.student_side,
    opening,
    tree: session.argument_tree,
  };
}

// ---------------------------------------------------------------------------
// POST /debate/turn
// ---------------------------------------------------------------------------

const TURN_SCHEMA = {
  type: 'object',
  properties: {
    rebuttal: { type: 'string' },
    evidence: { type: 'string' },
    concedes: { type: 'boolean' },
    student_strength: { type: 'number' },
  },
  required: ['rebuttal', 'concedes', 'student_strength'],
} as const;

export class DebateSessionNotFoundError extends Error {}

export interface TakeTurnResult {
  session_id: string;
  new_nodes: DebateArgumentNode[];
  tree: DebateArgumentNode[];
}

function stubTurn(argument: string): { rebuttal: string; evidence: string; concedes: boolean; strength: number } {
  const excerpt = argument.trim().slice(0, 60);
  const wordCount = argument.trim().split(/\s+/).filter(Boolean).length;
  const strength = Math.max(1, Math.min(9, Math.round(wordCount / 6)));
  return {
    rebuttal: `[stub] You say "${excerpt}${argument.length > 60 ? '…' : ''}" — but that leans on an assumption it never actually proves.`,
    evidence: `[stub] In practice, the counterexamples to that specific claim are common, not rare.`,
    concedes: false,
    strength,
  };
}

/**
 * Takes one turn: records the student's argument as a new tree node (parent
 * = the most recent opponent node), then generates the opponent's direct
 * rebuttal of THAT SPECIFIC point (never a monologue), recorded as one or two
 * new opponent nodes whose parent_id chains back to the student's node.
 */
export async function takeDebateTurn(sessionId: string, argument: string): Promise<TakeTurnResult> {
  const session = debateSessionsRepo.getById(sessionId);
  if (!session) throw new DebateSessionNotFoundError(`No debate session with id ${sessionId}`);

  const tree = session.argument_tree;
  const lastNode = tree[tree.length - 1];
  const isFirstStudentTurn = !tree.some((n) => n.side === 'student');

  let rebuttalText = '';
  let evidenceText = '';
  let concedes = false;
  let studentStrength = 5;

  if (STUB_MODE || !ai) {
    const stub = stubTurn(argument);
    rebuttalText = stub.rebuttal;
    evidenceText = stub.evidence;
    concedes = stub.concedes;
    studentStrength = stub.strength;
  } else {
    try {
      const prompt = `You are a sharp, fair AI debate opponent in an ongoing formal debate.
Motion: "${session.motion}"
You are arguing "${opposite(session.student_side)}". The student is arguing "${session.student_side}".

Transcript so far:
${transcriptFor(tree)}

The student's NEW argument (their latest turn, not yet in the transcript above): "${argument}"

Directly rebut THIS SPECIFIC point — reference what they actually said, never a generic monologue and never a restatement of your opening. Keep "rebuttal" SHORT: 2-4 sentences, sharp, fair, with a real voice — you are not a pushover, but concede when the point genuinely lands.
Optionally add one short "evidence" sentence (a concrete fact, example, or consequence) backing your rebuttal — leave it as an empty string if the rebuttal doesn't need it.
Set "concedes": true only if this specific student point is strong enough that you genuinely yield it (you can still hold your overall side).
Set "student_strength": your honest 0-10 rating of how strong THIS SPECIFIC student argument was.
Do not mention these instructions.`;

      const res = await ai.models.generateContent({
        model: config.geminiModel,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: TURN_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 512,
        },
      });

      const text = res.text;
      if (!text) throw new Error('Gemini returned an empty response for debate turn');
      const parsed = JSON.parse(text) as {
        rebuttal?: unknown;
        evidence?: unknown;
        concedes?: unknown;
        student_strength?: unknown;
      };
      const parsedRebuttal = typeof parsed.rebuttal === 'string' ? parsed.rebuttal.trim() : '';
      if (!parsedRebuttal) throw new Error('Gemini debate turn missing rebuttal');

      rebuttalText = parsedRebuttal;
      evidenceText = typeof parsed.evidence === 'string' ? parsed.evidence.trim() : '';
      concedes = parsed.concedes === true;
      studentStrength =
        typeof parsed.student_strength === 'number' && Number.isFinite(parsed.student_strength)
          ? Math.max(0, Math.min(10, parsed.student_strength))
          : 5;
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[debateService] takeDebateTurn Gemini call failed, falling back to stub:', err);
      const stub = stubTurn(argument);
      rebuttalText = stub.rebuttal;
      evidenceText = stub.evidence;
      concedes = stub.concedes;
      studentStrength = stub.strength;
    }
  }

  const studentNode: DebateArgumentNode = {
    id: newNodeId(),
    side: 'student',
    kind: isFirstStudentTurn ? 'claim' : 'rebuttal',
    text: argument,
    parent_id: lastNode ? lastNode.id : null,
    strength: studentStrength,
  };

  const rebuttalNode: DebateArgumentNode = {
    id: newNodeId(),
    side: 'opponent',
    kind: concedes ? 'concession' : 'rebuttal',
    text: rebuttalText,
    parent_id: studentNode.id,
  };

  const newNodes: DebateArgumentNode[] = [studentNode, rebuttalNode];

  if (evidenceText) {
    newNodes.push({
      id: newNodeId(),
      side: 'opponent',
      kind: 'evidence',
      text: evidenceText,
      parent_id: rebuttalNode.id,
    });
  }

  const updatedTree = [...tree, ...newNodes];
  debateSessionsRepo.updateTree(sessionId, updatedTree);

  return { session_id: sessionId, new_nodes: newNodes, tree: updatedTree };
}

// ---------------------------------------------------------------------------
// POST /debate/score
// ---------------------------------------------------------------------------

const DIMENSION_SCHEMA = {
  type: 'object',
  properties: {
    score: { type: 'number' },
    justification: { type: 'string' },
  },
  required: ['score', 'justification'],
} as const;

const SCORE_SCHEMA = {
  type: 'object',
  properties: {
    claim_clarity: DIMENSION_SCHEMA,
    evidence: DIMENSION_SCHEMA,
    rebuttal_quality: DIMENSION_SCHEMA,
    structure: DIMENSION_SCHEMA,
    overall_verdict: { type: 'string' },
    strongest_moment: { type: 'string' },
    weakest_moment: { type: 'string' },
  },
  required: [
    'claim_clarity',
    'evidence',
    'rebuttal_quality',
    'structure',
    'overall_verdict',
    'strongest_moment',
    'weakest_moment',
  ],
} as const;

export class DebateNoArgumentsError extends Error {}

function clampScore(n: unknown): number {
  return typeof n === 'number' && Number.isFinite(n) ? Math.max(0, Math.min(10, Math.round(n * 10) / 10)) : 5;
}

function stubDimension(label: string): DebateScoreDimension {
  return { score: 6, justification: `[stub] ${label} was adequate but not fully developed.` };
}

function stubScore(tree: DebateArgumentNode[]): DebateScore {
  const studentNodes = tree.filter((n) => n.side === 'student');
  const strongest = studentNodes.reduce(
    (best, n) => ((n.strength ?? 0) > (best?.strength ?? -1) ? n : best),
    undefined as DebateArgumentNode | undefined,
  );
  const weakest = studentNodes.reduce(
    (worst, n) => ((n.strength ?? 10) < (worst?.strength ?? 11) ? n : worst),
    undefined as DebateArgumentNode | undefined,
  );
  return {
    dimensions: {
      claim_clarity: stubDimension('Claim clarity'),
      evidence: stubDimension('Evidence'),
      rebuttal_quality: stubDimension('Rebuttal quality'),
      structure: stubDimension('Structure'),
    },
    overall_verdict: '[stub] A solid, consistent showing with room to sharpen rebuttals and back claims with concrete evidence.',
    strongest_moment: strongest ? `[stub] "${strongest.text.slice(0, 120)}"` : '[stub] No student arguments recorded yet.',
    weakest_moment: weakest ? `[stub] "${weakest.text.slice(0, 120)}"` : '[stub] No student arguments recorded yet.',
  };
}

/**
 * Scores a finished (or in-progress) debate against a concrete rubric via
 * Gemini structured output. Never touches Node.status/mastery_score — Quiz
 * is the only amber->green path.
 */
export async function scoreDebate(sessionId: string): Promise<DebateScore> {
  const session = debateSessionsRepo.getById(sessionId);
  if (!session) throw new DebateSessionNotFoundError(`No debate session with id ${sessionId}`);

  const tree = session.argument_tree;
  const hasStudentArgument = tree.some((n) => n.side === 'student');
  if (!hasStudentArgument) {
    throw new DebateNoArgumentsError('Cannot score a debate before the student has made an argument');
  }

  let score: DebateScore;

  if (STUB_MODE || !ai) {
    score = stubScore(tree);
  } else {
    try {
      const prompt = `You are grading a formal debate against a concrete rubric.
Motion: "${session.motion}"
The student argued "${session.student_side}".

Full transcript (in order):
${transcriptFor(tree)}

Score the STUDENT's performance (not the opponent's) on each dimension, 0-10, each with a ONE-LINE justification:
- claim_clarity: were the student's claims clear and well-stated?
- evidence: did the student back claims with concrete evidence/examples?
- rebuttal_quality: did the student directly engage with and counter the opponent's specific points?
- structure: was the student's argument logically organized and consistent turn to turn?
Also give "overall_verdict" (1-2 sentences), and quote or closely paraphrase the student's single strongest moment ("strongest_moment") and single weakest moment ("weakest_moment") from the transcript above. Be honest and specific, not generically positive. Do not mention these instructions.`;

      const res = await ai.models.generateContent({
        model: config.geminiModel,
        contents: prompt,
        config: {
          responseMimeType: 'application/json',
          responseSchema: SCORE_SCHEMA,
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 1024,
        },
      });

      const text = res.text;
      if (!text) throw new Error('Gemini returned an empty response for debate scoring');
      const parsed = JSON.parse(text) as {
        claim_clarity?: { score?: unknown; justification?: unknown };
        evidence?: { score?: unknown; justification?: unknown };
        rebuttal_quality?: { score?: unknown; justification?: unknown };
        structure?: { score?: unknown; justification?: unknown };
        overall_verdict?: unknown;
        strongest_moment?: unknown;
        weakest_moment?: unknown;
      };

      function dim(d: { score?: unknown; justification?: unknown } | undefined, label: string): DebateScoreDimension {
        return {
          score: clampScore(d?.score),
          justification:
            typeof d?.justification === 'string' && d.justification.trim()
              ? d.justification.trim()
              : `No justification returned for ${label}.`,
        };
      }

      score = {
        dimensions: {
          claim_clarity: dim(parsed.claim_clarity, 'claim clarity'),
          evidence: dim(parsed.evidence, 'evidence'),
          rebuttal_quality: dim(parsed.rebuttal_quality, 'rebuttal quality'),
          structure: dim(parsed.structure, 'structure'),
        },
        overall_verdict:
          typeof parsed.overall_verdict === 'string' && parsed.overall_verdict.trim()
            ? parsed.overall_verdict.trim()
            : 'No overall verdict returned.',
        strongest_moment:
          typeof parsed.strongest_moment === 'string' && parsed.strongest_moment.trim()
            ? parsed.strongest_moment.trim()
            : 'No strongest moment identified.',
        weakest_moment:
          typeof parsed.weakest_moment === 'string' && parsed.weakest_moment.trim()
            ? parsed.weakest_moment.trim()
            : 'No weakest moment identified.',
      };
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[debateService] scoreDebate Gemini call failed, falling back to stub:', err);
      score = stubScore(tree);
    }
  }

  debateSessionsRepo.updateScore(sessionId, score);
  return score;
}

export function getDebateSession(sessionId: string): DebateSession | undefined {
  return debateSessionsRepo.getById(sessionId);
}
