import { Router } from 'express';
import { z } from 'zod';
import { ask, getQueue, answerBatchOrQuestion, OfficeHoursNotFoundError } from '../services/officeHoursService';

/**
 * Office Hours Queue (Day 4 Tier 2). Full pipeline lives in
 * server/src/services/officeHoursService.ts — this file is pure request
 * plumbing.
 *
 * POST /api/officehours/ask     body: { question: string; asker_name?: string }
 *                                200: { item: OfficeHoursQuestion }
 * GET  /api/officehours         200: { batches: OfficeHoursBatch[] }  — triaged,
 *                                biggest/most-blocking batch first.
 * POST /api/officehours/answer  body: { batch_id?: string; question_id?: string }
 *                                200: { batch: OfficeHoursBatch } (answer filled,
 *                                member questions flipped to status:'answered')
 */
export const officehoursRouter = Router();

const askSchema = z.object({
  question: z.string().min(1, 'question must not be empty'),
  asker_name: z.string().optional(),
});

officehoursRouter.post('/officehours/ask', async (req, res) => {
  const parsed = askSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const item = await ask(parsed.data.question, parsed.data.asker_name);
    res.json({ item });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[officehours] ask() failed:', err);
    res.status(500).json({ error: 'Failed to submit question' });
  }
});

officehoursRouter.get('/officehours', async (_req, res) => {
  try {
    const batches = await getQueue();
    res.json({ batches });
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[officehours] getQueue() failed:', err);
    res.status(500).json({ error: 'Failed to load office hours queue' });
  }
});

const answerSchema = z
  .object({
    batch_id: z.string().min(1).optional(),
    question_id: z.string().min(1).optional(),
  })
  .refine((v) => !!v.batch_id || !!v.question_id, { message: 'batch_id or question_id is required' });

officehoursRouter.post('/officehours/answer', async (req, res) => {
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const batch = await answerBatchOrQuestion(parsed.data);
    res.json({ batch });
  } catch (err) {
    if (err instanceof OfficeHoursNotFoundError) {
      res.status(404).json({ error: err.message });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[officehours] answerBatchOrQuestion() failed:', err);
    res.status(500).json({ error: 'Failed to answer batch' });
  }
});
