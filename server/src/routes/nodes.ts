import { Router } from 'express';
import { DEMO_STUDENT_ID } from '../config';
import { nodesRepo } from '../db/repositories';
import { engageNode } from '../services/statusService';
import { runWarRoom } from '../agents/orchestrator';

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
