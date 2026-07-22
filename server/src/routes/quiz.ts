import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { QUIZ_PASS_THRESHOLD, type QuizQuestion, type QuizSession } from '@zynth/shared';
import { DEMO_STUDENT_ID } from '../config';
import { nodesRepo, quizSessionsRepo } from '../db/repositories';
import { applyQuizResult } from '../services/statusService';
import { generateQuiz, gradeQuiz } from '../services/quizService';

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

// ---------------------------------------------------------------------------
// STUBS — the Quiz subagent implements these on Day 2. They replace the demo
// heuristic above with real question generation + grading, WITHOUT changing
// the existing POST /quiz behavior (kept above for backwards compatibility /
// other callers during the transition).
// ---------------------------------------------------------------------------

const generateQuizSchema = z.object({
  node_ids: z.array(z.string()).min(1),
});

/**
 * POST /api/quiz/generate
 * body: { node_ids: string[] }
 * 200:  { quiz_id: string; questions: QuizQuestion[] }
 * Generates 4 questions per node (3 mcq + 1 free_response) via Gemini
 * structured generation (server/src/services/quizService.ts), falling back
 * to canned questions in STUB_MODE or on any generation failure. Does NOT
 * score or touch Node.status — that only happens in /quiz/submit below.
 */
quizRouter.post('/quiz/generate', async (req, res) => {
  const parsed = generateQuizSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { node_ids } = parsed.data;

  const nodes = node_ids.map((id) => nodesRepo.getById(id));
  const unknown = node_ids.filter((id, i) => !nodes[i]);
  if (unknown.length > 0) {
    res.status(404).json({ error: `Unknown node id(s): ${unknown.join(', ')}` });
    return;
  }

  const questions = await generateQuiz(nodes.filter((n): n is NonNullable<typeof n> => !!n));

  res.json({ quiz_id: `quiz_${nanoid(10)}`, questions });
});

const submittedQuestionSchema = z.object({
  id: z.string(),
  node_id: z.string(),
  prompt: z.string(),
  choices: z.array(z.string()).optional(),
  correct_answer: z.string(),
  given_answer: z.string().optional(),
  is_correct: z.boolean().optional(),
  question_type: z.enum(['mcq', 'free_response']).optional(),
  explanation: z.string().optional(),
});

const submitQuizSchema = z.object({
  node_ids: z.array(z.string()).min(1),
  questions: z.array(submittedQuestionSchema).min(1),
});

/**
 * POST /api/quiz/submit
 * body: { node_ids: string[]; questions: QuizQuestion[] } — each question
 *       carries the student's `given_answer`.
 * 200:  { session: QuizSession; updated: Node[]; per_question: { id: string; is_correct: boolean }[] }
 * Grades every question (MCQ exact-match, free_response via the Groq
 * grader), computes a pooled score/passed, persists a QuizSession, and
 * applies it via statusService.applyQuizResult — the ONLY place in this
 * file (or anywhere) that mutates Node.status.
 */
quizRouter.post('/quiz/submit', async (req, res) => {
  const parsed = submitQuizSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { node_ids, questions } = parsed.data;

  const unknown = node_ids.filter((id) => !nodesRepo.getById(id));
  if (unknown.length > 0) {
    res.status(404).json({ error: `Unknown node id(s): ${unknown.join(', ')}` });
    return;
  }

  const { questions: graded, score, passed } = await gradeQuiz(questions as QuizQuestion[]);

  const session: QuizSession = {
    id: `quiz_${nanoid(10)}`,
    student_id: DEMO_STUDENT_ID,
    node_ids,
    questions: graded,
    score,
    passed,
    created_at: new Date().toISOString(),
  };

  quizSessionsRepo.insert(session);
  // The ONLY status mutation in this file: hands the graded session to the
  // single amber<->green write path.
  const { updated } = applyQuizResult(session);

  res.json({
    session,
    updated,
    per_question: graded.map((q) => ({ id: q.id, is_correct: !!q.is_correct })),
  });
});
