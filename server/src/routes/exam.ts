import { Router } from 'express';

/**
 * Day 3 — implemented by the exam feature work. Mounted up-front so no feature
 * agent has to edit routes/index.ts (which they all share).
 */
export const examRouter = Router();

examRouter.get('/exam/_stub', (_req, res) => {
  res.status(501).json({ error: 'not implemented yet' });
});
