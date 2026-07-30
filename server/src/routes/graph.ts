import { Router } from 'express';
import { getActiveStudentId } from '../config';
import { connectGraph } from '../services/graphConnectService';
import { nodesRepo, edgesRepo } from '../db/repositories';

export const graphRouter = Router();

graphRouter.get('/graph', (_req, res) => {
  const studentId = getActiveStudentId();
  const nodes = nodesRepo.getAll(studentId);
  const edges = edgesRepo.getAll(studentId);
  res.json({ nodes, edges });
});

/**
 * Bridges every disconnected island in the graph so it is one traversable map.
 *
 *   POST /api/graph/connect
 *   200: { componentsBefore, componentsAfter, edgesAdded, meaningfulLinks }
 *
 * Idempotent — an already-connected graph adds nothing and costs no model call.
 * Exposed as an endpoint because subject-per-island graphs already exist in the
 * wild; new workspaces are connected at creation time.
 */
graphRouter.post('/graph/connect', async (_req, res) => {
  try {
    const result = await connectGraph(getActiveStudentId());
    res.json(result);
  } catch (err) {
    console.error('[routes/graph] connect failed:', err);
    res.status(500).json({ error: 'Failed to connect the graph' });
  }
});
