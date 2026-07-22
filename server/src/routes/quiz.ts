import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { QUIZ_PASS_THRESHOLD, type QuizQuestion, type QuizSession } from '@zynth/shared';
import { DEMO_STUDENT_ID } from '../config';
import { nodesRepo, quizSessionsRepo } from '../db/repositories';
import { applyQuizResult } from '../services/statusService';

export const quizRouter = Router();

// Real adaptive question generation + grading is Day 2. For now we generate a
// trivial one-question-per-node quiz and derive score/passed from either an
// explicit `simulate_score` (demo/testing hook) or a crude "did they answer"
// heuristic over `answers`. Whatever score comes out of this IS the real
// input to statusService.applyQuizResult — the status mutation is never faked.
const quizRequestSchema = z.object({
  node_ids: z.array(z.string()).min(1),
  answers: z.record(z.string(), z.string()).optional(),
  simulate_score: z.number().min(0).max(100).optional(),
});

function buildStubQuestions(nodeIds: string[]): QuizQuestion[] {
  return nodeIds.map((nodeId) => {
    const node = nodesRepo.getById(nodeId);
    const label = node?.label ?? nodeId;
    return {
      id: `q_${nanoid(8)}`,
      node_id: nodeId,
      prompt: `In one or two sentences, explain the key idea behind "${label}".`,
      correct_answer: '(free response — Day 2: real grading via exam_grader agent)',
    };
  });
}

quizRouter.post('/quiz', (req, res) => {
  const parsed = quizRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { node_ids, answers, simulate_score } = parsed.data;

  const unknown = node_ids.filter((id) => !nodesRepo.getById(id));
  if (unknown.length > 0) {
    res.status(404).json({ error: `Unknown node id(s): ${unknown.join(', ')}` });
    return;
  }

  const questions = buildStubQuestions(node_ids);

  let score: number;
  if (typeof simulate_score === 'number') {
    score = simulate_score;
  } else if (answers) {
    const answered = questions.filter((q) => (answers[q.id] ?? '').trim().length > 0).length;
    score = questions.length > 0 ? Math.round((answered / questions.length) * 100) : 0;
  } else {
    score = 85; // default stub outcome so the endpoint is demoable with a bare {node_ids}
  }

  const passed = score >= QUIZ_PASS_THRESHOLD;

  const session: QuizSession = {
    id: `quiz_${nanoid(10)}`,
    student_id: DEMO_STUDENT_ID,
    node_ids,
    questions,
    score,
    passed,
    created_at: new Date().toISOString(),
  };

  quizSessionsRepo.insert(session);
  const { updated } = applyQuizResult(session);

  res.json({ session, updated });
});
