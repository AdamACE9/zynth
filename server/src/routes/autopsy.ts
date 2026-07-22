import { Router } from 'express';
import { z } from 'zod';
import { analyze } from '../services/autopsyService';

/**
 * POST /api/autopsy
 * body: { text: string }  // raw pasted/extracted homework or test text
 * 200:  { mistakes: MistakeRecord[]; clusters: AutopsyCluster[]; new_edges: Edge[]; new_nodes: Node[] }
 *
 * Runs the full Autopsy pipeline (server/src/services/autopsyService.ts):
 * extracts + classifies mistakes onto known-or-new concept nodes, clusters
 * every mistake on file for the demo student looking for cross-concept
 * patterns, and wires up idempotent `correlated_error` edges for each
 * multi-node pattern found. Emits `autopsy:progress` over the socket as it
 * works, plus `node:created` / `edge:created` for anything new it discovers.
 */
export const autopsyRouter = Router();

const autopsyRequestSchema = z.object({
  text: z.string().min(1, 'text must not be empty'),
});

autopsyRouter.post('/autopsy', async (req, res) => {
  const parsed = autopsyRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await analyze(parsed.data.text);
    res.json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[autopsy] analyze() failed:', err);
    res.status(500).json({ error: 'Autopsy analysis failed' });
  }
});
