/**
 * Exam Simulator — question generation, node selection, and self-grading with
 * a live streamed "where did the logic diverge" reasoning trace per question.
 *
 * CRITICAL: this module NEVER calls statusService and NEVER writes
 * Node.status. An exam produces a *report* (graded questions, a reasoning
 * log, and a per-node score breakdown) and may record MistakeRecords
 * (source 'exam_sim'). Only a passed Quiz (server/src/services/statusService)
 * can move a node to green — see routes/exam.ts for the enforcement comment.
 *
 * Generation and grading both honour STUB_MODE and are bulletproof: any
 * Gemini/Groq failure degrades to deterministic, clearly-labelled fallback
 * text rather than throwing, so an exam can always be generated, graded, and
 * explained — even fully offline.
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import type { AgentName, ExamNodeResult, ExamReasoningEntry, Node, QuizQuestion, Status } from '@zynth/shared';
import { config, STUB_MODE } from '../config';
import { AGENT_CONFIGS } from '../agents/personas';
import { nodesRepo } from '../db/repositories';
import { emitExamReasoning } from '../socket';
import { gradeFreeResponse } from '../agents/groqGrader';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

function findPersonaConfig(name: AgentName) {
  const persona = AGENT_CONFIGS.find((c) => c.name === name);
  if (!persona) {
    throw new Error(`examService: no AgentConfig registered for "${name}"`);
  }
  return persona;
}

// ---------------------------------------------------------------------------
// 1. Node selection — "weak/relevant nodes" when the caller doesn't pin
//    down node_ids explicitly.
// ---------------------------------------------------------------------------

/**
 * Ranks nodes for exam inclusion: amber (engaged but unproven — the whole
 * point of a practice paper) first, then green (a retest keeps mastery
 * honest), then red only as a last resort (an unengaged concept has no
 * baseline to test against, but we'd rather include it than return nothing).
 * Within a status tier, lowest mastery_score first — weakest evidence first.
 */
const NODE_SELECTION_RANK: Record<Status, number> = { amber: 0, green: 1, red: 2 };

export function selectExamNodes(allNodes: Node[], questionCount: number): Node[] {
  if (allNodes.length === 0) return [];
  const nonRed = allNodes.filter((n) => n.status !== 'red');
  const pool = nonRed.length > 0 ? nonRed : allNodes;

  const sorted = [...pool].sort((a, b) => {
    const rankDiff = NODE_SELECTION_RANK[a.status] - NODE_SELECTION_RANK[b.status];
    if (rankDiff !== 0) return rankDiff;
    return a.mastery_score - b.mastery_score;
  });

  const count = Math.max(1, Math.min(questionCount, sorted.length));
  return sorted.slice(0, count);
}

/** Spreads `total` questions across `nodeCount` nodes as evenly as possible, front-loading the remainder. */
function distributeCounts(nodeCount: number, total: number): number[] {
  if (nodeCount <= 0) return [];
  const base = Math.floor(total / nodeCount);
  const remainder = total % nodeCount;
  return Array.from({ length: nodeCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

// ---------------------------------------------------------------------------
// 2. Question generation
// ---------------------------------------------------------------------------

const EXAM_GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          correct_answer: { type: 'string' },
          question_type: { type: 'string' },
        },
        required: ['prompt', 'correct_answer', 'question_type'],
      },
    },
  },
  required: ['questions'],
} as const;

interface RawGeneratedQuestion {
  prompt?: unknown;
  choices?: unknown;
  correct_answer?: unknown;
  question_type?: unknown;
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

function validateGeneratedQuestion(node: Node, raw: RawGeneratedQuestion): QuizQuestion | null {
  if (!isNonEmptyString(raw.prompt) || !isNonEmptyString(raw.correct_answer)) return null;
  const questionType = raw.question_type === 'mcq' || raw.question_type === 'free_response' ? raw.question_type : null;
  if (!questionType) return null;

  if (questionType === 'mcq') {
    if (!Array.isArray(raw.choices) || raw.choices.length !== 4 || !raw.choices.every(isNonEmptyString)) return null;
    if (!raw.choices.includes(raw.correct_answer)) return null;
  }

  return {
    id: `q_${nanoid(8)}`,
    node_id: node.id,
    prompt: raw.prompt,
    choices: questionType === 'mcq' ? (raw.choices as string[]) : undefined,
    correct_answer: raw.correct_answer,
    question_type: questionType,
  };
}

/** Deterministic canned questions for one node — used in STUB_MODE or on any generation failure. */
function buildCannedQuestionsForNode(node: Node, count: number): QuizQuestion[] {
  const label = node.label;
  const bank: QuizQuestion[] = [
    {
      id: `q_${nanoid(8)}`,
      node_id: node.id,
      prompt: `[stub] Under exam conditions: which statement best applies "${label}" correctly?`,
      choices: [
        `The textbook-accurate application of ${label}`,
        `A description of an unrelated concept`,
        `A common misconception about ${label}`,
        `A description that reverses the actual rule for ${label}`,
      ],
      correct_answer: `The textbook-accurate application of ${label}`,
      question_type: 'mcq',
    },
    {
      id: `q_${nanoid(8)}`,
      node_id: node.id,
      prompt: `[stub] A past-paper style question: which of these is a classic exam mistake with "${label}"?`,
      choices: [
        `Applying ${label} without checking its conditions first`,
        `Applying ${label} correctly`,
        `Skipping the question entirely`,
        `Showing full working for ${label}`,
      ],
      correct_answer: `Applying ${label} without checking its conditions first`,
      question_type: 'mcq',
    },
    {
      id: `q_${nanoid(8)}`,
      node_id: node.id,
      prompt: `[stub] Which choice is NOT a valid property of "${label}"?`,
      choices: [
        `A property that does not actually apply to ${label}`,
        `A valid, standard property of ${label}`,
        `Another valid, standard property of ${label}`,
        `A third valid, standard property of ${label}`,
      ],
      correct_answer: `A property that does not actually apply to ${label}`,
      question_type: 'mcq',
    },
    {
      id: `q_${nanoid(8)}`,
      node_id: node.id,
      prompt: `[stub] Exam free-response: explain, in your own words, how "${label}" works and show one worked step.`,
      correct_answer: `[stub reference answer] ${label} works because its defining rule holds under its stated conditions; a correct answer names that rule and applies it in one concrete step.`,
      question_type: 'free_response',
    },
  ];
  // last requested slot is free_response when count >= 2, so a mixed exam still exercises the Groq grading path.
  const picks: QuizQuestion[] = [];
  for (let i = 0; i < count; i++) {
    const wantFreeResponse = i === count - 1 && count >= 2;
    const source = wantFreeResponse ? bank[3]! : bank[i % 3]!;
    picks.push({ ...source, id: `q_${nanoid(8)}` });
  }
  return picks;
}

/**
 * Generates `count` exam questions for a single node via Gemini structured
 * output — mostly MCQ (fast, exact-match gradable) with the last slot as a
 * free-response when count >= 2, so the demo exercises both grading paths.
 * Falls back to canned questions in STUB_MODE, on any Gemini error, or if
 * the model's output doesn't validate.
 */
async function generateQuestionsForNodeExam(node: Node, count: number): Promise<QuizQuestion[]> {
  if (count <= 0) return [];
  if (STUB_MODE || !ai) {
    return buildCannedQuestionsForNode(node, count);
  }

  const wantsFreeResponse = count >= 2;
  const mcqCount = wantsFreeResponse ? count - 1 : count;

  const prompt = `You are writing exam-style past-paper questions for one syllabus concept, under timed conditions.
Concept: "${node.label}" (subject: ${node.subject}).

Generate exactly ${count} questions testing this concept:
- ${mcqCount} multiple-choice question(s) (question_type "mcq"), each with EXACTLY 4 short answer choices in "choices", where "correct_answer" is copied EXACTLY (character for character) from one of the 4 choices.
${wantsFreeResponse ? '- 1 free-response question (question_type "free_response"), where "correct_answer" is a concise model/reference answer usable as a grading rubric.' : ''}
Write these like real exam questions (precise, unambiguous, no hints in the wording). Vary the wrong MCQ choices so none are trivially eliminable. Do not reference these instructions in the output.`;

  try {
    const res = await ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: EXAM_GENERATION_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 2048,
      },
    });

    const text = res.text;
    if (!text) throw new Error('Gemini returned an empty response for exam generation');

    const parsed: unknown = JSON.parse(text);
    const rawQuestions = (parsed as { questions?: unknown })?.questions;
    if (!Array.isArray(rawQuestions)) throw new Error('Gemini exam generation response missing questions[]');

    const validated = rawQuestions
      .map((q) => validateGeneratedQuestion(node, q as RawGeneratedQuestion))
      .filter((q): q is QuizQuestion => q !== null);

    const mcqs = validated.filter((q) => q.question_type === 'mcq');
    const freeResponses = validated.filter((q) => q.question_type === 'free_response');

    if (mcqs.length < mcqCount || (wantsFreeResponse && freeResponses.length < 1)) {
      throw new Error(`Gemini exam generation produced an invalid mix (mcq=${mcqs.length}, free_response=${freeResponses.length})`);
    }

    return [...mcqs.slice(0, mcqCount), ...freeResponses.slice(0, wantsFreeResponse ? 1 : 0)];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[examService] generateQuestionsForNodeExam(${node.id}) failed, falling back to canned questions:`, err);
    return buildCannedQuestionsForNode(node, count);
  }
}

/** Generates the full exam: `questionCount` questions distributed across `nodes`. */
export async function generateExamQuestions(nodes: Node[], questionCount: number): Promise<QuizQuestion[]> {
  const counts = distributeCounts(nodes.length, questionCount);
  const perNode = await Promise.all(nodes.map((node, i) => generateQuestionsForNodeExam(node, counts[i] ?? 0)));
  return perNode.flat();
}

// ---------------------------------------------------------------------------
// 3. Grading + live "where did the logic diverge" reasoning
// ---------------------------------------------------------------------------

export interface GradedExamResult {
  questions: QuizQuestion[]; // given_answer + is_correct filled in
  live_reasoning_log: ExamReasoningEntry[];
  node_results: ExamNodeResult[];
}

/** Deterministic reasoning text — STUB_MODE and the live-call failure fallback. Never blank, never a bare "wrong". */
function buildStubReasoning(question: QuizQuestion, givenAnswer: string, isCorrect: boolean, nodeLabel: string): string {
  if (isCorrect) {
    return `[stub] Correct — your answer lines up with the accepted reasoning path for ${nodeLabel}.`;
  }
  const trimmed = givenAnswer.trim();
  if (!trimmed) {
    return `[stub] No answer was given, so this couldn't be credited. The expected path for ${nodeLabel} starts from "${question.correct_answer.slice(0, 90)}".`;
  }
  return `[stub] Your answer diverges from the correct approach to ${nodeLabel}: you went with "${trimmed.slice(0, 90)}", but the expected reasoning leads to "${question.correct_answer.slice(0, 90)}". That's the exact step where the two paths split.`;
}

interface StreamReasoningParams {
  sessionId: string;
  question: QuizQuestion;
  index: number;
  total: number;
  givenAnswer: string;
  isCorrect: boolean;
  nodeLabel: string;
  nodeSubject: string;
}

/**
 * Streams the exam_grader agent's divergence reasoning for one question over
 * `exam:reasoning` (phase 'token' per chunk), returning the full text. Never
 * throws — any Gemini failure degrades to a single-shot stub reasoning,
 * still emitted as a 'token' chunk so the client's live view never stalls.
 */
async function streamDivergenceReasoning(params: StreamReasoningParams): Promise<string> {
  const { sessionId, question, index, total, givenAnswer, isCorrect, nodeLabel, nodeSubject } = params;

  const emitToken = (text: string) =>
    emitExamReasoning({ session_id: sessionId, question_id: question.id, index, total, phase: 'token', text });

  if (STUB_MODE || !ai) {
    const text = buildStubReasoning(question, givenAnswer, isCorrect, nodeLabel);
    emitToken(text);
    return text;
  }

  const persona = findPersonaConfig('exam_grader');
  const choicesLine = question.choices ? `Choices: ${question.choices.join(' | ')}\n` : '';
  const prompt = `Concept: "${nodeLabel}" (${nodeSubject}).
Question: ${question.prompt}
${choicesLine}Correct answer: ${question.correct_answer}
Student's answer: ${givenAnswer.trim() ? givenAnswer : '(no answer given)'}
This has already been graded as ${isCorrect ? 'CORRECT' : 'INCORRECT'} — that verdict is FINAL and not yours to
re-derive or second-guess. Do not redo the full calculation from scratch and do not contradict the given verdict.

${isCorrect
    ? 'In exactly 1 short sentence, name the correct method they used (do not re-derive the answer step by step).'
    : 'In 2-3 short sentences, pinpoint SPECIFICALLY the one step or concept where their thinking diverged from the correct approach — name the exact misconception or missed step. Do not just say "wrong", do not restate the correct answer without explaining the divergence, and do not walk through the entire correct derivation.'}
Write in second person ("you"), plain text, no markdown, no restating these instructions.`;

  try {
    const stream = await ai.models.generateContentStream({
      model: persona.model,
      contents: prompt,
      config: {
        systemInstruction: persona.system_prompt,
        temperature: persona.temperature,
        thinkingConfig: { thinkingBudget: 0 },
        maxOutputTokens: 220,
      },
    });

    let full = '';
    for await (const chunk of stream) {
      const t = chunk.text;
      if (t) {
        full += t;
        emitToken(t);
      }
    }

    if (!full.trim()) throw new Error('exam_grader stream returned empty text');
    return full.trim();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[examService] streamDivergenceReasoning(${question.id}) failed, falling back to stub:`, err);
    const text = buildStubReasoning(question, givenAnswer, isCorrect, nodeLabel);
    emitToken(text);
    return text;
  }
}

function computeNodeResults(gradedQuestions: QuizQuestion[]): ExamNodeResult[] {
  const byNode = new Map<string, { correct: number; total: number }>();
  for (const q of gradedQuestions) {
    const bucket = byNode.get(q.node_id) ?? { correct: 0, total: 0 };
    bucket.total += 1;
    if (q.is_correct) bucket.correct += 1;
    byNode.set(q.node_id, bucket);
  }
  return Array.from(byNode.entries()).map(([node_id, { correct, total }]) => ({
    node_id,
    score: total > 0 ? Math.round((100 * correct) / total) : 0,
  }));
}

/**
 * Grades every question in the exam SEQUENTIALLY (question 1 fully graded +
 * reasoned before question 2 starts) so the live 'exam:reasoning' stream
 * reads as a coherent per-question trace rather than interleaved chunks from
 * several questions at once. Never throws.
 */
export async function gradeAndStreamExam(
  sessionId: string,
  questions: QuizQuestion[],
  answers: Record<string, string>,
): Promise<GradedExamResult> {
  const total = questions.length;
  const gradedQuestions: QuizQuestion[] = [];
  const reasoningLog: ExamReasoningEntry[] = [];

  for (let i = 0; i < questions.length; i++) {
    const q = questions[i]!;
    const givenAnswer = (answers[q.id] ?? '').trim();
    const node = nodesRepo.getById(q.node_id);
    const nodeLabel = node?.label ?? q.node_id;
    const nodeSubject = node?.subject ?? '';

    let isCorrect: boolean;
    let graderFeedback = '';
    if (q.question_type === 'free_response') {
      // eslint-disable-next-line no-await-in-loop
      const grade = await gradeFreeResponse(q, givenAnswer);
      isCorrect = grade.is_correct;
      graderFeedback = grade.feedback;
    } else {
      isCorrect = givenAnswer.length > 0 && givenAnswer === q.correct_answer;
    }

    emitExamReasoning({
      session_id: sessionId,
      question_id: q.id,
      index: i,
      total,
      phase: 'thinking',
      text: `Reviewing question ${i + 1} of ${total} — ${nodeLabel}…`,
    });

    // eslint-disable-next-line no-await-in-loop
    const reasoning = await streamDivergenceReasoning({
      sessionId,
      question: q,
      index: i,
      total,
      givenAnswer,
      isCorrect,
      nodeLabel,
      nodeSubject,
    });

    emitExamReasoning({
      session_id: sessionId,
      question_id: q.id,
      index: i,
      total,
      phase: 'graded',
      text: reasoning,
      is_correct: isCorrect,
    });

    reasoningLog.push({ question_id: q.id, reasoning });
    gradedQuestions.push({
      ...q,
      given_answer: givenAnswer,
      is_correct: isCorrect,
      explanation: graderFeedback || q.explanation,
    });
  }

  return {
    questions: gradedQuestions,
    live_reasoning_log: reasoningLog,
    node_results: computeNodeResults(gradedQuestions),
  };
}
