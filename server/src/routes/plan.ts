import { Router } from 'express';
import { createPlan, getCurrentGhostPath } from '../services/planService';

/**
 * Study-Plan Board (see server/src/services/planService.ts for the actual
 * routing/replanning logic — this file is intentionally thin). Contract:
 *   POST /api/plan   body: { goal: string }        -> 200 GhostPath
 *   GET  /api/plan                                  -> 200 GhostPath | 404 { error }
 *
 * Note there is NO manual "replan" endpoint: re-planning happens silently and
 * automatically inside planService whenever Node.status changes anywhere in
 * the app (see the module header there for exactly how that's wired), and is
 * pushed to clients via the 'plan:updated' socket event, not polled here.
 */
export const planRouter = Router();

planRouter.post('/plan', async (req, res) => {
  const { goal } = req.body ?? {};
  if (typeof goal !== 'string' || goal.trim().length === 0) {
    res.status(400).json({ error: '"goal" is required and must be a non-empty string' });
    return;
  }
  try {
    const ghost = await createPlan(goal);
    res.json(ghost);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[routes/plan] failed to build plan:', err);
    res.status(500).json({ error: 'Failed to build study plan' });
  }
});

planRouter.get('/plan', (_req, res) => {
  const ghost = getCurrentGhostPath();
  if (!ghost) {
    res.status(404).json({ error: 'No active study plan' });
    return;
  }
  res.json(ghost);
});
