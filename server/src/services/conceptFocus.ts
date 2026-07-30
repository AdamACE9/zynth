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
 * Deliberately in-memory rather than a schema change: this is a within-session
 * hand-off (Intuition → "Prove it" → Quiz), the deadline is hours away, and a
 * missing entry degrades to exactly the previous behaviour. Nothing depends on it
 * surviving a restart.
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

  focusByNode.set(nodeId, { objective: objective.trim(), title: title.trim(), recordedAt: Date.now() });
}

/**
 * What this student was most recently taught about this node, or null if nothing
 * recent. Quiz generation uses this to test the thing that was actually shown.
 */
export function getConceptFocus(nodeId: string): { objective: string; title: string } | null {
  const entry = focusByNode.get(nodeId);
  if (!entry) return null;

  if (Date.now() - entry.recordedAt > FOCUS_TTL_MS) {
    focusByNode.delete(nodeId);
    return null;
  }

  return { objective: entry.objective, title: entry.title };
}

/** Test seam — lets the verifier assert the hand-off without a live model call. */
export function __clearConceptFocus(): void {
  focusByNode.clear();
}
