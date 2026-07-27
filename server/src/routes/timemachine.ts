import { Router } from 'express';
import { createTimeMachineRun, getCurrentTimeMachine } from '../services/timeMachineService';

/**
 * Curriculum Time-Machine (see server/src/services/timeMachineService.ts for
 * the actual scheduling/reroute logic — this file is intentionally thin).
 * Contract:
 *   POST /api/timemachine  body: { exam_date?: ISO string, goal?: string }  -> 200 TimeMachineResult
 *   GET  /api/timemachine                                                   -> 200 TimeMachineResult | 404 { error }
 *
 * GET always recomputes the verdict/checkpoints/reroute live from current
 * Node.status — there is no cache to invalidate.
 */
export const timemachineRouter = Router();

timemachineRouter.post('/timemachine', async (req, res) => {
  const { exam_date, goal } = req.body ?? {};
  if (exam_date !== undefined && typeof exam_date !== 'string') {
    res.status(400).json({ error: '"exam_date" must be an ISO date string if provided' });
    return;
  }
  if (goal !== undefined && typeof goal !== 'string') {
    res.status(400).json({ error: '"goal" must be a string if provided' });
    return;
  }
  try {
    const result = await createTimeMachineRun(goal ?? null, exam_date ?? null);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[routes/timemachine] failed to build schedule:', err);
    res.status(500).json({ error: 'Failed to build time-machine schedule' });
  }
});

timemachineRouter.get('/timemachine', async (_req, res) => {
  try {
    const result = await getCurrentTimeMachine();
    if (!result) {
      res.status(404).json({ error: 'No active time-machine schedule' });
      return;
    }
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[routes/timemachine] failed to compute schedule:', err);
    res.status(500).json({ error: 'Failed to compute time-machine schedule' });
  }
});
