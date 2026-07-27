import { Router } from 'express';
import { z } from 'zod';
import { nodesRepo } from '../db/repositories';
import {
  startDebate,
  takeDebateTurn,
  scoreDebate,
  DebateSessionNotFoundError,
  DebateNoArgumentsError,
} from '../services/debateService';

/** Day 4 Tier 2 — Debate Arena: a real argument tree against an AI opponent. */
export const debateRouter = Router();

// ---------------------------------------------------------------------------
// POST /debate/start
// ---------------------------------------------------------------------------

const startSchema = z.object({
  motion: z.string().trim().min(1).optional(),
  node_id: z.string().optional(),
  side: z.enum(['for', 'against']).optional(),
});

debateRouter.post('/debate/start', async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { motion, node_id, side } = parsed.data;

  if (node_id && !nodesRepo.getById(node_id)) {
    res.status(404).json({ error: `Unknown node id: ${node_id}` });
    return;
  }

  try {
    const result = await startDebate({ motion, node_id, side });
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[debate routes] POST /debate/start failed:', err);
    res.status(500).json({ error: 'Failed to start debate' });
  }
});

// ---------------------------------------------------------------------------
// POST /debate/turn
// ---------------------------------------------------------------------------

const turnSchema = z.object({
  session_id: z.string().min(1),
  argument: z.string().trim().min(1),
});

debateRouter.post('/debate/turn', async (req, res) => {
  const parsed = turnSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { session_id, argument } = parsed.data;

  try {
    const result = await takeDebateTurn(session_id, argument);
    res.json(result);
  } catch (err) {
    if (err instanceof DebateSessionNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[debate routes] POST /debate/turn failed:', err);
    res.status(500).json({ error: 'Failed to take debate turn' });
  }
});

// ---------------------------------------------------------------------------
// POST /debate/score
// ---------------------------------------------------------------------------

const scoreSchema = z.object({
  session_id: z.string().min(1),
});

debateRouter.post('/debate/score', async (req, res) => {
  const parsed = scoreSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { session_id } = parsed.data;

  try {
    const score = await scoreDebate(session_id);
    res.json({ session_id, score });
  } catch (err) {
    if (err instanceof DebateSessionNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    if (err instanceof DebateNoArgumentsError) {
      res.status(400).json({ error: err.message });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[debate routes] POST /debate/score failed:', err);
    res.status(500).json({ error: 'Failed to score debate' });
  }
});
