import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { QUIZ_PASS_THRESHOLD, type ErrorType, type MistakeRecord, type QuizQuestion, type QuizSession } from '@zynth/shared';
import { getActiveStudentId } from '../config';
import { nodesRepo, quizSessionsRepo, mistakeRecordsRepo } from '../db/repositories';
import { applyQuizResult } from '../services/statusService';
import { generateQuiz, gradeQuiz, buildMistakeExcerpt, registerQuizSession } from '../services/quizService';
import { handleQuizAnswerEvent, initializeCopilotSession, CopilotSessionError } from '../services/copilotService';
import { lexicalOverlap } from '../agents/groqGrader';

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
    student_id: getActiveStudentId(),
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

  const quizId = `quiz_${nanoid(10)}`;
  // Registers this exact question set under quiz_id so the Live Co-Pilot's
  // POST /quiz/answer (which only carries question_id, per spec) can look up
  // the real prompt/choices/correct_answer/choice_tags later. See
  // quizService.registerQuizSession for why this exists.
  registerQuizSession(quizId, node_ids, questions);
  initializeCopilotSession(quizId);

  res.json({ quiz_id: quizId, questions });
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

  const studentId = getActiveStudentId();
  const session: QuizSession = {
    id: `quiz_${nanoid(10)}`,
    student_id: studentId,
    node_ids,
    questions: graded,
    score,
    passed,
    created_at: new Date().toISOString(),
  };

  quizSessionsRepo.insert(session);

  // Write a MistakeRecord for EVERY wrong answer (source 'quiz'), in the
  // canonical raw_excerpt format (quizService.buildMistakeExcerpt) so future
  // sessions' Live Co-Pilot can lexically match against them (P3, C2/C2b).
  // The spec doesn't say what error_type to assign here (no per-question
  // Gemini call happens at bulk submit) — this is a reasonable heuristic:
  // a free-response answer that's a near-miss of the reference answer reads
  // as a careless_slip; everything else defaults to concept_gap, the same
  // "assume the more actionable read" default autopsyService uses.
  const now = new Date().toISOString();
  for (const q of graded) {
    if (q.is_correct) continue;
    const errorType = inferErrorType(q);
    const mistake: MistakeRecord = {
      id: `mistake_${nanoid(10)}`,
      student_id: studentId,
      node_id: q.node_id,
      source: 'quiz',
      raw_excerpt: buildMistakeExcerpt(q),
      error_type: errorType,
      created_at: now,
    };
    mistakeRecordsRepo.insert(mistake);
  }

  // The ONLY status mutation in this file: hands the graded session to the
  // single amber<->green write path.
  const { updated } = applyQuizResult(session);

  res.json({
    session,
    updated,
    per_question: graded.map((q) => ({ id: q.id, is_correct: !!q.is_correct })),
  });
});

/** Heuristic error_type for a bulk-submit wrong answer (no per-question Gemini call happens here). */
function inferErrorType(q: QuizQuestion): ErrorType {
  if (q.question_type === 'free_response') {
    const overlap = lexicalOverlap(q.given_answer ?? '', q.correct_answer);
    if (overlap >= 0.45 && (q.given_answer ?? '').trim().length >= 12) return 'careless_slip';
  }
  return 'concept_gap';
}

// ---------------------------------------------------------------------------
// Live Co-Pilot: POST /api/quiz/answer
// ---------------------------------------------------------------------------

const answerEventSchema = z.object({
  session_id: z.string(),
  question_id: z.string(),
  node_id: z.string(),
  question_type: z.enum(['mcq', 'free_response']),
  session_index: z.number().int().min(0),
  node_index: z.number().int().min(0),
  given_answer: z.string(),
  latency_ms: z.number().nonnegative().optional(),
  revision_count: z.number().int().nonnegative().optional(),
});

/**
 * POST /api/quiz/answer
 * body: { session_id, question_id, node_id, question_type, session_index,
 *         node_index, given_answer, latency_ms?, revision_count? }
 * 200: { is_correct, correct_answer, explanation? }
 *
 * Fires once per question on first commit — a repeat POST for a question_id
 * already seen in this session returns the same grading result without
 * re-running the Co-Pilot (see copilotService.handleQuizAnswerEvent).
 * Grades synchronously (fast) and updates the live heatmap synchronously;
 * the Gemini diagnosis (if the detection pipeline decides to attempt one) is
 * fire-and-forget and never blocks this response.
 */
quizRouter.post('/quiz/answer', async (req, res) => {
  const parsed = answerEventSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }

  try {
    const result = await handleQuizAnswerEvent(parsed.data);
    res.json(result);
  } catch (err) {
    if (err instanceof CopilotSessionError) {
      res.status(404).json({ error: err.message });
      return;
    }
    // eslint-disable-next-line no-console
    console.error('[quiz routes] POST /quiz/answer failed:', err);
    res.status(500).json({ error: 'Failed to process quiz answer' });
  }
});
