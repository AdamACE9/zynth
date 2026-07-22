import { Router } from 'express';
import { AGENT_CONFIGS } from '../agents/personas';

export const agentsRouter = Router();

const SHORT_DESCRIPTIONS: Record<string, string> = {
  diagnosis: 'Classifies a mistake into the concept node and error type it belongs to.',
  war_room_analogist: 'War Room persona — explains via everyday analogies.',
  war_room_purist: 'War Room persona — rigorous, first-principles / formal explanations.',
  war_room_real_world: 'War Room persona — grounds the concept in concrete applications.',
  war_room_skeptic: 'War Room persona — stress-tests explanations with edge cases.',
  war_room_synthesis: 'War Room persona — converges the debate into one clean explanation.',
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
