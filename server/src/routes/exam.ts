import { Router } from 'express';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import type { ExamSimSession, MistakeRecord, Node, QuizQuestion } from '@zynth/shared';
import { getActiveStudentId } from '../config';
import { examSimSessionsRepo, mistakeRecordsRepo, nodesRepo } from '../db/repositories';
import { gradeAndStreamExam, generateExamQuestions, selectExamNodes } from '../services/examService';

export const examRouter = Router();

const DEFAULT_QUESTION_COUNT = 6;

// ---------------------------------------------------------------------------
// In-memory pending-exam store. /exam/start hands the student a session_id +
// questions immediately (per spec) WITHOUT persisting anything yet — there is
// no ExamSimSession worth persisting until it's been graded (mirrors how
// quizSessionsRepo.insert only happens post-grade in routes/quiz.ts). This map
// bridges start -> submit within a server lifetime, keyed by session_id, since
// /exam/submit only receives { session_id, answers } and needs the original
// question set (with correct_answer/node_id) back to grade against.
// ---------------------------------------------------------------------------
interface PendingExam {
  student_id: string;
  source_paper: string;
  questions: QuizQuestion[];
  duration_seconds: number;
  created_at: string;
}

const pendingExams = new Map<string, PendingExam>();

/** ~2.5 minutes per question, floored at 10 minutes so a tiny exam is still usable. */
function secondsForQuestionCount(n: number): number {
  return Math.max(600, n * 150);
}

const startSchema = z.object({
  node_ids: z.array(z.string()).optional(),
  source_paper: z.string().optional(),
  question_count: z.number().int().min(1).max(20).optional(),
});

/**
 * POST /api/exam/start
 * body: { node_ids?: string[]; source_paper?: string; question_count?: number }
 * 200:  { session_id: string; questions: QuizQuestion[]; duration_seconds: number }
 *
 * Generates a timed simulated past paper via Gemini (server/src/services/examService.ts),
 * defaulting to the student's weak/relevant nodes when node_ids isn't given.
 * Returns immediately — grading + the live reasoning trace happen on submit.
 */
examRouter.post('/exam/start', async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { node_ids, source_paper, question_count } = parsed.data;
  const questionCount = question_count ?? DEFAULT_QUESTION_COUNT;

  const studentId = getActiveStudentId();
  let nodes: Node[];
  if (node_ids && node_ids.length > 0) {
    const resolved = node_ids.map((id) => nodesRepo.getById(id));
    const unknown = node_ids.filter((id, i) => !resolved[i]);
    if (unknown.length > 0) {
      res.status(404).json({ error: `Unknown node id(s): ${unknown.join(', ')}` });
      return;
    }
    nodes = resolved as Node[];
  } else {
    const all = nodesRepo.getAll(studentId);
    if (all.length === 0) {
      res.status(400).json({ error: 'No nodes exist for this student yet — nothing to build an exam from.' });
      return;
    }
    nodes = selectExamNodes(all, questionCount);
  }

  const questions = await generateExamQuestions(nodes, questionCount);
  const sessionId = `exam_${nanoid(10)}`;
  const duration_seconds = secondsForQuestionCount(questions.length);
  const paperLabel = source_paper?.trim() || `Simulated Paper — ${new Date().toLocaleDateString()}`;

  pendingExams.set(sessionId, {
    student_id: studentId,
    source_paper: paperLabel,
    questions,
    duration_seconds,
    created_at: new Date().toISOString(),
  });

  res.json({ session_id: sessionId, questions, duration_seconds });
});

const submitSchema = z.object({
  session_id: z.string(),
  answers: z.record(z.string(), z.string()).default({}),
});

/**
 * POST /api/exam/submit
 * body: { session_id: string; answers: Record<questionId, string> }
 * 200:  { session: ExamSimSession }
 *
 * Self-grades every question, streaming the exam_grader agent's own
 * divergence reasoning per question over Socket.io ('exam:reasoning'), then
 * persists the full ExamSimSession (report + reasoning log + per-node
 * scores). Records a MistakeRecord (source 'exam_sim') for each wrong
 * answer. Deliberately never touches Node.status — see examService.ts header.
 */
examRouter.post('/exam/submit', async (req, res) => {
  const parsed = submitSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.flatten() });
    return;
  }
  const { session_id, answers } = parsed.data;

  const pending = pendingExams.get(session_id);
  if (!pending) {
    res.status(404).json({ error: `Unknown or already-submitted exam session: ${session_id}` });
    return;
  }

  const { questions, live_reasoning_log, node_results } = await gradeAndStreamExam(
    session_id,
    pending.questions,
    answers,
  );

  const session: ExamSimSession = {
    id: session_id,
    student_id: pending.student_id,
    source_paper: pending.source_paper,
    questions,
    live_reasoning_log,
    node_results,
    created_at: pending.created_at,
  };

  examSimSessionsRepo.insert(session);
  pendingExams.delete(session_id);

  // Report-only side effect: log each miss as a MistakeRecord so Autopsy can
  // later cluster it. Blank answers read as a careless slip (likely ran out
  // of time / skipped); an actual wrong answer reads as a concept gap. This
  // NEVER touches Node.status.
  for (const q of questions) {
    if (q.is_correct) continue;
    const hasAnswer = !!q.given_answer && q.given_answer.trim().length > 0;
    const record: MistakeRecord = {
      id: `mistake_${nanoid(10)}`,
      student_id: pending.student_id,
      node_id: q.node_id,
      source: 'exam_sim',
      raw_excerpt: hasAnswer ? q.given_answer! : '(no answer given)',
      error_type: hasAnswer ? 'concept_gap' : 'careless_slip',
      created_at: new Date().toISOString(),
    };
    mistakeRecordsRepo.insert(record);
  }

  res.json({ session });
});

/**
 * GET /api/exam/:id
 * 200: { session: ExamSimSession }
 * The persisted session, for replay of the reasoning log + weak-topic report.
 */
examRouter.get('/exam/:id', (req, res) => {
  const session = examSimSessionsRepo.getById(req.params.id);
  if (!session) {
    res.status(404).json({ error: `No exam session with id ${req.params.id}` });
    return;
  }
  res.json({ session });
});
