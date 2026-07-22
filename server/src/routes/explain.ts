import { Router } from 'express';
import { nodesRepo } from '../db/repositories';
import { sendExplainTurn } from '../services/explainService';

/**
 * Context-aware 1:1 tutor chat (see TASKBRIEFING Section 2). Contract:
 *   POST /api/nodes/:id/explain
 *   body: { message: string; session_id?: string }
 *   200:  { session_id: string; messages: ExplainMessage[]; tutor_reply: string }
 * Looks up/creates an ExplainSession for (student, node), appends the student
 * message + tutor reply, and calls statusService.engageNode() on the first
 * student message of the session (red -> amber).
 */
export const explainRouter = Router();

explainRouter.post('/nodes/:id/explain', async (req, res) => {
  const node = nodesRepo.getById(req.params.id);
  if (!node) {
    res.status(404).json({ error: `No node with id ${req.params.id}` });
    return;
  }

  const { message, session_id: sessionId } = req.body ?? {};
  if (typeof message !== 'string' || message.trim().length === 0) {
    res.status(400).json({ error: '"message" is required and must be a non-empty string' });
    return;
  }

  try {
    const result = await sendExplainTurn(req.params.id, message, sessionId);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[routes/explain] failed:', err);
    res.status(500).json({ error: 'Explain failed to respond' });
  }
});
