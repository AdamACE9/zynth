import { Router } from 'express';
import { getActiveStudentId } from '../config';
import { mistakeRecordsRepo, nodesRepo } from '../db/repositories';
import { engageNode } from '../services/statusService';
import { generateIntuitionSpec } from '../services/intuitionService';
import { recordConceptFocus } from '../services/conceptFocus';

export const nodesRouter = Router();

nodesRouter.get('/nodes', (_req, res) => {
  res.json(nodesRepo.getAll(getActiveStudentId()));
});

nodesRouter.get('/nodes/:id', (req, res) => {
  const node = nodesRepo.getById(req.params.id);
  if (!node) {
    res.status(404).json({ error: `No node with id ${req.params.id}` });
    return;
  }
  res.json(node);
});

/**
 * red → amber. The sole engagement endpoint, used by Intuition (once the
 * student commits to a prediction) and by Explain. It delegates to
 * statusService.engageNode, which stays the only code path allowed to write
 * Node.status — this handler deliberately contains no status logic of its own.
 */
nodesRouter.post('/nodes/:id/engage', (req, res) => {
  const node = nodesRepo.getById(req.params.id);
  if (!node) {
    res.status(404).json({ error: `No node with id ${req.params.id}` });
    return;
  }
  const updated = engageNode(req.params.id);
  res.json(updated);
});

/**
 * The Intuition spec for a node — the visual, interactive understanding step.
 *
 *   GET /api/nodes/:id/intuition
 *   200: IntuitionSpec
 *
 * Synchronous by design. The module this replaced streamed five AI personas
 * over a socket, and the waiting was itself a large part of why it felt like a
 * chore; here the student gets one validated spec and starts dragging.
 *
 * Any recorded mistakes on this node are passed to the generator so the
 * prediction targets the misunderstanding the student has actually
 * demonstrated. That personalisation is the thing a textbook cannot do.
 *
 * This never 500s on a generation failure — intuitionService falls back to a
 * deterministic spec, so the screen always renders.
 */
nodesRouter.get('/nodes/:id/intuition', async (req, res) => {
  const node = nodesRepo.getById(req.params.id);
  if (!node) {
    res.status(404).json({ error: `No node with id ${req.params.id}` });
    return;
  }

  let mistakes: Awaited<ReturnType<typeof mistakeRecordsRepo.getByNode>> = [];
  try {
    mistakes = mistakeRecordsRepo.getByNode(req.params.id);
  } catch {
    // Personalisation is a bonus, not a requirement — a read failure here must
    // not cost the student the visual.
  }

  const spec = await generateIntuitionSpec(node, mistakes);

  // Hand the objective to quiz generation. Without this the quiz independently
  // re-interprets the node label and can examine a facet the student was never
  // shown — see conceptFocus.ts for the concrete failure this fixes.
  recordConceptFocus(node.id, spec.objective, spec.title);

  res.json(spec);
});
