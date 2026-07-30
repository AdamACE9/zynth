import { Router } from 'express';
import { AGENT_CONFIGS } from '../agents/personas';

export const agentsRouter = Router();

const SHORT_DESCRIPTIONS: Record<string, string> = {
  diagnosis: 'Classifies a mistake into the concept node and error type it belongs to.',
  autopsy: 'Finds cross-mistake patterns and proposes new graph edges.',
  planner: 'Builds and replans an ordered path of nodes toward a stated goal.',
  exam_grader: 'Grades exam-sim responses with shown step-by-step reasoning.',
  explain_tutor: 'One-on-one Socratic tutor for a single concept node.',
};

agentsRouter.get('/agents', (_req, res) => {
  const summary = AGENT_CONFIGS.map((c) => ({
    name: c.name,
    model: c.model,
    description: SHORT_DESCRIPTIONS[c.name] ?? '',
  }));
  res.json(summary);
});
