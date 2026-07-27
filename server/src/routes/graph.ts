import { Router } from 'express';
import { getActiveStudentId } from '../config';
import { nodesRepo, edgesRepo } from '../db/repositories';

export const graphRouter = Router();

graphRouter.get('/graph', (_req, res) => {
  const studentId = getActiveStudentId();
  const nodes = nodesRepo.getAll(studentId);
  const edges = edgesRepo.getAll(studentId);
  res.json({ nodes, edges });
});
