/**
 * Flashcard Forge (Day 4 Tier 2). `forge(text)` is the entry point (called by
 * routes/flashcards.ts): given raw pasted textbook/lecture text, it
 *
 *   1. extracts distinct concepts via Gemini structured output, matching each
 *      onto a KNOWN graph Node by label whenever possible (mirrors the
 *      autopsyService pattern) or proposing a brand-new one,
 *   2. inserts any brand-new concept as a Node — status:'red', engaged_at:
 *      null, low mastery_score, x/y/z:null. This is a plain birth-state
 *      INSERT (nodesRepo.insert), never a status transition — statusService
 *      remains the only owner of Node.status changes. Emits `node:created`
 *      so the graph updates live.
 *   3. generates 1-3 spaced-repetition flashcards per concept, tagged to that
 *      node's id, and persists them into this feature's own `flashcards`
 *      table (schema.sql is frozen — the table is created here at module
 *      load, matching TASKBRIEFING's instruction for this feature).
 *
 * Review scheduling (`gradeReview`) implements a real SM-2-style update over
 * (ease, interval_days, due_at, reps, lapses) — see the block comment above
 * that function for the exact algorithm.
 *
 * Every Gemini call here degrades to a deterministic, clearly-labelled
 * heuristic in STUB_MODE or on ANY failure (bad key, quota, malformed JSON) —
 * Flashcard Forge must never hard-fail the demo.
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import { computeMasteryScore, type Node } from '@zynth/shared';
import { config, STUB_MODE, getActiveStudentId } from '../config';
import { db } from '../db/connection';
import { nodesRepo } from '../db/repositories';
import { emitNodeCreated } from '../socket';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

// ---------------------------------------------------------------------------
// schema — this feature's own table. schema.sql is frozen, so it is created
// here, at module load, idempotently (CREATE TABLE IF NOT EXISTS).
// ---------------------------------------------------------------------------

db.exec(`
  CREATE TABLE IF NOT EXISTS flashcards (
    id TEXT PRIMARY KEY,
    student_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    front TEXT NOT NULL,
    back TEXT NOT NULL,
    ease REAL NOT NULL DEFAULT 2.5,
    interval_days REAL NOT NULL DEFAULT 0,
    due_at TEXT NOT NULL,
    reps INTEGER NOT NULL DEFAULT 0,
    lapses INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_flashcards_student ON flashcards(student_id);
  CREATE INDEX IF NOT EXISTS idx_flashcards_due ON flashcards(student_id, due_at);
  CREATE INDEX IF NOT EXISTS idx_flashcards_node ON flashcards(node_id);
`);

// ---------------------------------------------------------------------------
// public shapes
// ---------------------------------------------------------------------------

export interface Flashcard {
  id: string;
  student_id: string;
  node_id: string;
  front: string;
  back: string;
  ease: number;
  interval_days: number;
  due_at: string;
  reps: number;
  lapses: number;
  created_at: string;
}

export interface ForgeConceptResult {
  label: string;
  node_id: string;
  is_new: boolean;
}

export interface ForgeResult {
  new_nodes: Node[];
  cards: Flashcard[];
  concepts: ForgeConceptResult[];
}

export type ReviewGrade = 0 | 1 | 2 | 3; // again | hard | good | easy

// ---------------------------------------------------------------------------
// row <-> Flashcard (all columns are already primitive — no JSON columns)
// ---------------------------------------------------------------------------

function rowToCard(row: Flashcard): Flashcard {
  return row;
}

export const flashcardsRepo = {
  insert(card: Flashcard): void {
    db.prepare(
      `INSERT INTO flashcards (
        id, student_id, node_id, front, back, ease, interval_days, due_at, reps, lapses, created_at
      ) VALUES (
        @id, @student_id, @node_id, @front, @back, @ease, @interval_days, @due_at, @reps, @lapses, @created_at
      )`,
    ).run(card);
  },

  getById(id: string): Flashcard | undefined {
    const row = db.prepare('SELECT * FROM flashcards WHERE id = ?').get(id) as Flashcard | undefined;
    return row ? rowToCard(row) : undefined;
  },

  /** Cards due now (due_at <= now), earliest-due first. Falls back to the
   * newest cards on file (nothing is "due" yet, e.g. right after a fresh
   * forge whose cards were minted a moment in the future — never happens
   * today, but keeps the endpoint useful even on an empty/edge deck). */
  getDue(studentId: string, nowIso: string, limit = 20): Flashcard[] {
    const due = db
      .prepare(
        `SELECT * FROM flashcards WHERE student_id = ? AND due_at <= ? ORDER BY due_at ASC LIMIT ?`,
      )
      .all(studentId, nowIso, limit) as Flashcard[];
    if (due.length > 0) return due.map(rowToCard);

    return (
      db
        .prepare(`SELECT * FROM flashcards WHERE student_id = ? ORDER BY created_at DESC LIMIT ?`)
        .all(studentId, limit) as Flashcard[]
    ).map(rowToCard);
  },

  updateAfterReview(
    id: string,
    fields: { ease: number; interval_days: number; due_at: string; reps: number; lapses: number },
  ): void {
    db.prepare(
      `UPDATE flashcards SET ease = @ease, interval_days = @interval_days, due_at = @due_at, reps = @reps, lapses = @lapses WHERE id = @id`,
    ).run({ id, ...fields });
  },
};

function nowIso(): string {
  return new Date().toISOString();
}

// ---------------------------------------------------------------------------
// slug / subject helpers (mirrors autopsyService's approach for a new node
// born from source material — kept local since services/* is otherwise
// frozen and this feature owns its own file only).
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
// stage 1: concept + card extraction (Gemini structured output, + a
// deterministic sentence/heading-split fallback for STUB_MODE / failures)
// ---------------------------------------------------------------------------

interface RawCard {
  front: string;
  back: string;
}

interface RawConcept {
  label: string;
  matched_node_id: string | null;
  subject: string | null;
  cards: RawCard[];
}

const FORGE_SCHEMA = {
  type: 'object',
  properties: {
    concepts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          label: { type: 'string' },
          matched_node_id: { type: 'string' },
          subject: { type: 'string' },
          cards: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                front: { type: 'string' },
                back: { type: 'string' },
              },
              required: ['front', 'back'],
            },
          },
        },
        required: ['label', 'cards'],
      },
    },
  },
  required: ['concepts'],
} as const;

/** Deterministic fallback: splits the pasted text on blank lines / heading-like
 * lines (and, failing that, on sentence boundaries) to find distinct concept
 * chunks, derives a short label per chunk, and mints one or two literal
 * question/answer cards straight out of the chunk's own sentences. Used in
 * STUB_MODE and whenever the Gemini call fails, so Forge never hard-fails. */
function deterministicExtract(text: string, existingNodes: Node[]): RawConcept[] {
  const HEADING_RE = /^(#{1,4}\s*|\d+[.)]\s*)?([A-Z][A-Za-z0-9 ,'/-]{3,70}):?\s*$/;

  const rawBlocks = text
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.trim())
    .filter(Boolean);

  // A single wall of text with no blank lines: fall back to grouping every
  // 2 sentences into a pseudo-chunk so we still get multiple concepts.
  const blocks =
    rawBlocks.length > 1
      ? rawBlocks
      : (() => {
          const sentences = text
            .replace(/\s+/g, ' ')
            .trim()
            .split(/(?<=[.!?])\s+/)
            .filter((s) => s.trim().length > 0);
          const grouped: string[] = [];
          for (let i = 0; i < sentences.length; i += 2) {
            grouped.push(sentences.slice(i, i + 2).join(' '));
          }
          return grouped;
        })();

  const concepts: RawConcept[] = [];

  for (const block of blocks.slice(0, 12)) {
    const lines = block.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const first = lines[0] ?? block;
    const headingMatch = HEADING_RE.exec(first);

    let label: string;
    let body: string;
    if (headingMatch && lines.length > 1) {
      label = (headingMatch[2] ?? first).trim();
      body = lines.slice(1).join(' ');
    } else {
      const words = first.replace(/[.,;:]+$/, '').split(/\s+/).slice(0, 6).join(' ');
      label = words || 'Unclassified Concept';
      body = block;
    }

    const sentences = body
      .replace(/\s+/g, ' ')
      .trim()
      .split(/(?<=[.!?])\s+/)
      .filter((s) => s.trim().length > 6);
    if (sentences.length === 0) continue;

    const cards: RawCard[] = [];
    const firstSentence = sentences[0];
    if (firstSentence) {
      cards.push({ front: `What is ${label}?`, back: firstSentence.trim() });
    }
    const secondSentence = sentences[1];
    if (secondSentence) {
      cards.push({ front: `${label} — fill in the key detail:`, back: secondSentence.trim() });
    }
    if (cards.length === 0) continue;

    // Best-effort match against existing nodes by exact label or shared
    // significant vocabulary — final say still belongs to forge()'s own
    // label/id reconciliation pass, this is just a helpful hint.
    const labelLower = label.toLowerCase();
    const exact = existingNodes.find((n) => n.label.toLowerCase() === labelLower);
    const fuzzy =
      exact ??
      existingNodes.find((n) => {
        const words = significantWords(n.label);
        return words.length > 0 && words.every((w) => labelLower.includes(w));
      });

    concepts.push({
      label,
      matched_node_id: fuzzy?.id ?? null,
      subject: fuzzy?.subject ?? null,
      cards,
    });
  }

  return concepts;
}

async function extractConceptsAndCards(text: string, existingNodes: Node[]): Promise<RawConcept[]> {
  if (STUB_MODE || !ai) {
    return deterministicExtract(text, existingNodes);
  }

  const knownConcepts = existingNodes.map((n) => ({ id: n.id, label: n.label, subject: n.subject }));
  const prompt = `You are Zynth's Flashcard Forge — you turn a chunk of textbook/lecture-notes text into
distinct study concepts and spaced-repetition flashcards.

KNOWN CONCEPT NODES (map an extracted concept onto one of these by label whenever it is genuinely the same concept):
${JSON.stringify(knownConcepts)}

SOURCE TEXT:
"""
${text}
"""

Extract every distinct, teachable concept covered in the text. For each concept return:
- "label": a short, specific concept name. If it matches a KNOWN CONCEPT NODE's label (or an obvious synonym), use that EXACT label. Otherwise propose a short, precise NEW label — never a vague catch-all.
- "matched_node_id": the "id" of the KNOWN CONCEPT NODE above whose label you used, or "" if this is a new concept.
- "subject": the academic subject this concept belongs to (e.g. "Calculus", "Physics"), only when proposing a NEW concept.
- "cards": 1 to 3 flashcards testing this concept, each with:
   - "front": a short, specific question or prompt.
   - "back": the precise answer, in the student's own study terms, 1-2 sentences.

Do not invent facts that are not supported by the text. Do not merge unrelated concepts into one entry.`;

  try {
    const res = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: FORGE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2048,
      },
    });

    const raw = res.text;
    if (!raw) throw new Error('Gemini returned an empty response for flashcard forging');

    const parsed = JSON.parse(raw) as { concepts?: unknown };
    if (!Array.isArray(parsed.concepts)) throw new Error('forge response missing concepts[]');

    const validNodeIds = new Set(existingNodes.map((n) => n.id));
    const out: RawConcept[] = [];
    for (const item of parsed.concepts) {
      const c = item as {
        label?: unknown;
        matched_node_id?: unknown;
        subject?: unknown;
        cards?: unknown;
      };
      if (typeof c.label !== 'string' || !c.label.trim()) continue;
      const matchedId =
        typeof c.matched_node_id === 'string' && validNodeIds.has(c.matched_node_id) ? c.matched_node_id : null;
      const subject = typeof c.subject === 'string' && c.subject.trim() ? c.subject.trim() : null;

      const cards: RawCard[] = [];
      if (Array.isArray(c.cards)) {
        for (const cardItem of c.cards) {
          const card = cardItem as { front?: unknown; back?: unknown };
          if (typeof card.front === 'string' && card.front.trim() && typeof card.back === 'string' && card.back.trim()) {
            cards.push({ front: card.front.trim(), back: card.back.trim() });
          }
        }
      }
      if (cards.length === 0) continue;

      out.push({ label: c.label.trim(), matched_node_id: matchedId, subject, cards });
    }

    if (out.length === 0) throw new Error('forge extraction produced no valid concepts');
    return out;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[flashcardService] extractConceptsAndCards failed, falling back to deterministic extraction:', err);
    return deterministicExtract(text, existingNodes);
  }
}

// ---------------------------------------------------------------------------
// orchestration: forge(text)
// ---------------------------------------------------------------------------

export async function forge(text: string): Promise<ForgeResult> {
  const studentId = getActiveStudentId();
  const existingNodes = nodesRepo.getAll(studentId);
  const nodesById = new Map(existingNodes.map((n) => [n.id, n]));
  const nodesByLabelLower = new Map(existingNodes.map((n) => [n.label.toLowerCase(), n]));

  const extracted = await extractConceptsAndCards(text, existingNodes);

  const newNodes: Node[] = [];
  const allCards: Flashcard[] = [];
  const conceptResults: ForgeConceptResult[] = [];

  for (const concept of extracted) {
    // 1. Resolve (or create) the node this concept belongs to. Matching order:
    //    a matched_node_id the model gave us, then an exact label match
    //    (case-insensitive) against everything already on the graph
    //    (including nodes created earlier in this SAME forge run) — this is
    //    the de-duplication step the brief calls out as the part that matters.
    let node = concept.matched_node_id ? nodesById.get(concept.matched_node_id) : undefined;
    if (!node) node = nodesByLabelLower.get(concept.label.trim().toLowerCase());

    let isNew = false;
    if (!node) {
      isNew = true;
      const label = concept.label.trim() || 'Unclassified Concept';
      let id = `node_${slugify(label)}`;
      let suffix = 2;
      while (nodesById.has(id)) {
        id = `node_${slugify(label)}_${suffix}`;
        suffix += 1;
      }
      const subject = concept.subject ?? inferSubject(label, existingNodes);
      const ts = nowIso();
      node = {
        id,
        student_id: studentId,
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
      // Plain birth-state insert — NOT a status transition. statusService is
      // never involved for a brand-new node born red.
      nodesRepo.insert(node);
      emitNodeCreated(node);
      newNodes.push(node);
    }

    nodesById.set(node.id, node);
    nodesByLabelLower.set(node.label.toLowerCase(), node);

    conceptResults.push({ label: node.label, node_id: node.id, is_new: isNew });

    // 2. Mint the cards for this concept, due immediately so a fresh forge is
    //    reviewable right away.
    const ts = nowIso();
    for (const raw of concept.cards) {
      const card: Flashcard = {
        id: `card_${nanoid(10)}`,
        student_id: studentId,
        node_id: node.id,
        front: raw.front,
        back: raw.back,
        ease: 2.5,
        interval_days: 0,
        due_at: ts,
        reps: 0,
        lapses: 0,
        created_at: ts,
      };
      flashcardsRepo.insert(card);
      allCards.push(card);
    }
  }

  return { new_nodes: newNodes, cards: allCards, concepts: conceptResults };
}

// ---------------------------------------------------------------------------
// review: getDue / gradeReview (real SM-2)
// ---------------------------------------------------------------------------

export function getDueCards(limit = 20): Flashcard[] {
  return flashcardsRepo.getDue(getActiveStudentId(), nowIso(), limit);
}

/**
 * SM-2 (SuperMemo-2) scheduling update, driven by a 4-button grade the way
 * Anki exposes it (Again/Hard/Good/Easy) mapped onto SM-2's 0-5 "quality of
 * recall" scale:
 *   0 Again -> q=0 (fail)   1 Hard -> q=3   2 Good -> q=4   3 Easy -> q=5
 *
 * - A fail (q<3) is a lapse: reps resets to 0, interval resets to 1 day,
 *   lapses increments, and ease drops (per the canonical SM-2 formula below,
 *   floored at 1.3 so a hard deck never spirals to daily reviews forever).
 * - A pass (q>=3) advances reps and grows the interval:
 *     reps 0 -> 1  : interval = 1 day
 *     reps 1 -> 2  : interval = 6 days
 *     reps >= 2    : interval = round(previous interval * ease)
 *   Ease is updated by the standard SM-2 delta:
 *     ease' = ease + (0.1 - (5-q) * (0.08 + (5-q) * 0.02)), floored at 1.3.
 */
export function gradeReview(cardId: string, grade: ReviewGrade): Flashcard {
  const card = flashcardsRepo.getById(cardId);
  if (!card) {
    throw new Error(`Flashcard ${cardId} not found`);
  }

  const quality = [0, 3, 4, 5][grade] as number;

  let { ease, interval_days: interval, reps, lapses } = card;

  if (quality < 3) {
    lapses += 1;
    reps = 0;
    interval = 1;
  } else {
    if (reps === 0) interval = 1;
    else if (reps === 1) interval = 6;
    else interval = Math.round(interval * ease);
    reps += 1;
  }

  ease = ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  ease = Math.max(1.3, Math.round(ease * 100) / 100);

  const due = new Date(Date.now() + interval * 24 * 60 * 60 * 1000).toISOString();

  flashcardsRepo.updateAfterReview(cardId, { ease, interval_days: interval, due_at: due, reps, lapses });

  return { ...card, ease, interval_days: interval, due_at: due, reps, lapses };
}
