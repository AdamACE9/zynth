import { db } from '../db/connection';
/**
 * The bridge between what Intuition taught and what the Quiz asks.
 *
 * Why this exists: Intuition and Quiz were two independent Gemini calls that each
 * received only a node's label and independently decided what to cover. For a
 * node labelled "Linear Algebra and Calculus", Intuition built a visual about a
 * parabola's derivative shifting, and the quiz then asked about eigenvectors in
 * PCA and cosine similarity in NLP. Both were reasonable readings of the label,
 * and together they were unanswerable — the student is tested on something they
 * were never shown.
 *
 * That breaks the product's core promise. Amber means "engaged, not proven", and
 * the quiz is the ONLY route to green; if the quiz tests a different facet of the
 * concept than the one the student just worked through, green stops measuring
 * understanding and starts measuring luck.
 *
 * So Intuition now states a one-line objective — what the student should be able
 * to do afterwards — and records it here. Quiz generation reads it and anchors
 * its questions to it.
 *
 * This was in-memory only at first, and that was wrong: `tsx watch` restarts the
 * dev server on every file save, and Render restarts on deploy, so the objective
 * was routinely lost between opening Intuition and reaching the quiz — which is
 * exactly the bug it was added to fix, reappearing intermittently. It now writes
 * through to SQLite, with the map kept as a read cache.
 *
 * The table is created on demand rather than in schema.sql: it is a cache, not
 * part of the data model, and it must not be able to break a migration hours
 * before a deadline.
 */

/** How long a recorded focus stays relevant. Beyond this the student has almost
 *  certainly moved on, and a stale objective would skew a fresh quiz. */
const FOCUS_TTL_MS = 6 * 60 * 60 * 1000; // 6 hours

/** Bounds the map so a long-lived process can't accumulate one entry per node. */
const MAX_ENTRIES = 200;

interface FocusEntry {
  objective: string;
  /** The visual's own framing, for extra context in the quiz prompt. */
  title: string;
  recordedAt: number;
}

const focusByNode = new Map<string, FocusEntry>();

/** Lazily created so a failure here can never stop the server booting. */
let tableReady = false;
function ensureTable(): boolean {
  if (tableReady) return true;
  try {
    db.prepare(
      `CREATE TABLE IF NOT EXISTS concept_focus (
         node_id    TEXT PRIMARY KEY,
         objective  TEXT NOT NULL,
         title      TEXT NOT NULL,
         recorded_at INTEGER NOT NULL
       )`,
    ).run();
    tableReady = true;
  } catch (err) {
    console.warn('[conceptFocus] could not create cache table; falling back to memory only:', err);
  }
  return tableReady;
}

/**
 * Records what the student was just taught about this node. Called after an
 * Intuition spec is successfully generated.
 */
export function recordConceptFocus(nodeId: string, objective: string, title: string): void {
  if (!nodeId || !objective.trim()) return;

  // Cheap bound: drop the oldest entry once past the cap. Insertion order is
  // guaranteed for Map, so the first key is the oldest.
  if (focusByNode.size >= MAX_ENTRIES && !focusByNode.has(nodeId)) {
    const oldest = focusByNode.keys().next().value;
    if (oldest !== undefined) focusByNode.delete(oldest);
  }

  const entry: FocusEntry = { objective: objective.trim(), title: title.trim(), recordedAt: Date.now() };
  focusByNode.set(nodeId, entry);

  // Write through. A failure here costs coherence on the next quiz, never the
  // request the student is currently making.
  if (ensureTable()) {
    try {
      db.prepare(
        `INSERT INTO concept_focus (node_id, objective, title, recorded_at)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(node_id) DO UPDATE SET
           objective = excluded.objective,
           title = excluded.title,
           recorded_at = excluded.recorded_at`,
      ).run(nodeId, entry.objective, entry.title, entry.recordedAt);
    } catch (err) {
      console.warn(`[conceptFocus] failed to persist focus for ${nodeId}:`, err);
    }
  }
}

/**
 * What this student was most recently taught about this node, or null if nothing
 * recent. Quiz generation uses this to test the thing that was actually shown.
 */
export function getConceptFocus(nodeId: string): { objective: string; title: string } | null {
  let entry = focusByNode.get(nodeId);

  // Cache miss — most often because the process restarted between the student
  // opening Intuition and reaching the quiz.
  if (!entry && ensureTable()) {
    try {
      const row = db
        .prepare('SELECT objective, title, recorded_at FROM concept_focus WHERE node_id = ?')
        .get(nodeId) as { objective: string; title: string; recorded_at: number } | undefined;
      if (row) {
        entry = { objective: row.objective, title: row.title, recordedAt: row.recorded_at };
        focusByNode.set(nodeId, entry);
      }
    } catch (err) {
      console.warn(`[conceptFocus] failed to read focus for ${nodeId}:`, err);
    }
  }

  if (!entry) return null;

  if (Date.now() - entry.recordedAt > FOCUS_TTL_MS) {
    focusByNode.delete(nodeId);
    if (ensureTable()) {
      try {
        db.prepare('DELETE FROM concept_focus WHERE node_id = ?').run(nodeId);
      } catch {
        /* expiry is best-effort */
      }
    }
    return null;
  }

  return { objective: entry.objective, title: entry.title };
}

/** Test seam — lets the verifier assert the hand-off without a live model call. */
export function __clearConceptFocus(): void {
  focusByNode.clear();
  if (ensureTable()) {
    try {
      db.prepare('DELETE FROM concept_focus').run();
    } catch {
      /* test seam only */
    }
  }
}
