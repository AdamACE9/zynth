import { Router } from 'express';
import { DEMO_STUDENT_ID } from '../config';
import { nodesRepo } from '../db/repositories';
import { engageNode } from '../services/statusService';
import { runWarRoom } from '../agents/orchestrator';
import { runWarRoomStream } from '../agents/warRoomStream';

export const nodesRouter = Router();

nodesRouter.get('/nodes', (_req, res) => {
  res.json(nodesRepo.getAll(DEMO_STUDENT_ID));
});

nodesRouter.get('/nodes/:id', (req, res) => {
  const node = nodesRepo.getById(req.params.id);
  if (!node) {
    res.status(404).json({ error: `No node with id ${req.params.id}` });
    return;
  }
  res.json(node);
});

/** Demo trigger: shows red -> amber live without going through the full War Room. */
nodesRouter.post('/nodes/:id/engage', (req, res) => {
  const node = nodesRepo.getById(req.params.id);
  if (!node) {
    res.status(404).json({ error: `No node with id ${req.params.id}` });
    return;
  }
  const updated = engageNode(req.params.id);
  res.json(updated);
});

nodesRouter.post('/nodes/:id/war-room', async (req, res) => {
  const node = nodesRepo.getById(req.params.id);
  if (!node) {
    res.status(404).json({ error: `No node with id ${req.params.id}` });
    return;
  }
  try {
    const session = await runWarRoom(req.params.id);
    res.json(session);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[routes/nodes] war-room failed:', err);
    res.status(500).json({ error: 'War Room failed to run' });
  }
});

/**
 * Kicks off the streaming War Room debate for a node. Contract:
 *   POST /api/nodes/:id/war-room/stream
 *   body: {} (no body needed — node id is in the path)
 *   200:  { session_id: string }
 * Runs the same 5-persona debate as runWarRoom() above, but emits progress
 * live via the 'warroom:turn' socket event (phase: start/token/done per
 * persona turn) instead of blocking until the whole transcript is ready, then
 * emits 'warroom:resolved' once the debate converges and engageNode() has
 * run. This handler returns as soon as the session_id exists — it does NOT
 * await the debate itself, which continues in the background. The client
 * follows along via getSocket() rather than this POST's body.
 */
nodesRouter.post('/nodes/:id/war-room/stream', (req, res) => {
  const node = nodesRepo.getById(req.params.id);
  if (!node) {
    res.status(404).json({ error: `No node with id ${req.params.id}` });
    return;
  }
  try {
    const { session_id } = runWarRoomStream(req.params.id);
    res.json({ session_id });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[routes/nodes] war-room/stream failed to start:', err);
    res.status(500).json({ error: 'War Room stream failed to start' });
  }
});
