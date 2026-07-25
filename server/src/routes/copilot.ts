import { Router } from 'express';

/**
 * Day 3 — implemented by the copilot feature work. Mounted up-front so no feature
 * agent has to edit routes/index.ts (which they all share).
 */
export const copilotRouter = Router();

copilotRouter.get('/copilot/_stub', (_req, res) => {
  res.status(501).json({ error: 'not implemented yet' });
});
