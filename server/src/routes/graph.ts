import { Router } from 'express';
import { DEMO_STUDENT_ID } from '../config';
import { nodesRepo, edgesRepo } from '../db/repositories';

export const graphRouter = Router();

graphRouter.get('/graph', (_req, res) => {
  const nodes = nodesRepo.getAll(DEMO_STUDENT_ID);
  const edges = edgesRepo.getAll(DEMO_STUDENT_ID);
  res.json({ nodes, edges });
});
