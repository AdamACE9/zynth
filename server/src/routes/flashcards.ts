import { Router } from 'express';
import { z } from 'zod';
import { forge, getDueCards, gradeReview } from '../services/flashcardService';

/**
 * Flashcard Forge (Day 4 Tier 2). Full pipeline lives in
 * server/src/services/flashcardService.ts — this router is just validation +
 * error translation, matching the shape of routes/autopsy.ts.
 */
export const flashcardsRouter = Router();

// ---------------------------------------------------------------------------
// POST /api/flashcards/forge
// body: { text: string }
// 200:  { new_nodes: Node[]; cards: Flashcard[]; concepts: {label,node_id,is_new}[] }
// ---------------------------------------------------------------------------

const forgeRequestSchema = z.object({
  text: z.string().min(1, 'text must not be empty'),
});

flashcardsRouter.post('/flashcards/forge', async (req, res) => {
  const parsed = forgeRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await forge(parsed.data.text);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[flashcards] forge() failed:', err);
    res.status(500).json({ error: 'Flashcard forging failed' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/flashcards/due
// 200: { cards: Flashcard[] }  // due_at <= now, earliest first; falls back to
//                                newest-first when nothing is due yet
// ---------------------------------------------------------------------------

flashcardsRouter.get('/flashcards/due', (_req, res) => {
  try {
    const cards = getDueCards();
    res.json({ cards });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[flashcards] getDueCards() failed:', err);
    res.status(500).json({ error: 'Could not load due flashcards' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/flashcards/review
// body: { card_id: string; grade: 0 | 1 | 2 | 3 } // again | hard | good | easy
// 200:  { card: Flashcard }  // real SM-2 update: ease, interval_days, due_at, reps, lapses
// ---------------------------------------------------------------------------

const reviewRequestSchema = z.object({
  card_id: z.string().min(1),
  grade: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

flashcardsRouter.post('/flashcards/review', (req, res) => {
  const parsed = reviewRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const card = gradeReview(parsed.data.card_id, parsed.data.grade);
    res.json({ card });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[flashcards] gradeReview() failed:', err);
    res.status(404).json({ error: err instanceof Error ? err.message : 'Flashcard review failed' });
  }
});
