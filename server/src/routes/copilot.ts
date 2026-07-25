import { Router } from 'express';
import { getHeatmapSnapshot } from '../services/copilotService';

export const copilotRouter = Router();

/**
 * GET /api/copilot/:session_id/heatmap
 * A snapshot fetch for CopilotPanel on mount, so it isn't blank until the
 * next `copilot:heatmap` socket push. The socket event remains the live
 * source of truth after mount — this is just the initial paint.
 * 404 if the session_id was never registered via POST /quiz/generate.
 */
copilotRouter.get('/copilot/:session_id/heatmap', (req, res) => {
  const cells = getHeatmapSnapshot(req.params.session_id as string);
  if (!cells) {
    res.status(404).json({ error: `Unknown copilot session ${req.params.session_id}` });
    return;
  }
  res.json({ session_id: req.params.session_id, cells });
});
