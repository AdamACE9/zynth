import { Router } from 'express';
import { STUB_MODE } from '../config';

export const healthRouter = Router();

healthRouter.get('/health', (_req, res) => {
  res.json({ ok: true, stubMode: STUB_MODE });
});
