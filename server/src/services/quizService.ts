/**
 * Quiz generation + grading logic. This module NEVER touches Node.status —
 * it only produces graded QuizQuestion[] and a computed score/passed. The
 * caller (routes/quiz.ts) is responsible for building the QuizSession and
 * handing it to statusService.applyQuizResult, which remains the sole
 * amber<->green write path.
 *
 * Generation uses Gemini structured output (per-node, 4 questions: 3 MCQ +
 * 1 free-response). Grading is exact-match for MCQ and delegates to the
 * Groq grader (agents/groqGrader.ts) for free-response. Both generation and
 * grading are bulletproof: any failure degrades to a deterministic stub
 * rather than throwing, so a quiz can always be generated and always be
 * submitted, even fully offline.
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import { QUIZ_PASS_THRESHOLD, type Node, type QuizQuestion } from '@zynth/shared';
import { config, STUB_MODE } from '../config';
import { gradeFreeResponse } from '../agents/groqGrader';
import { getConceptFocus } from './conceptFocus';
import { withModelRetry } from '../agents/retry';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

const QUESTIONS_PER_NODE = 4;
const MCQ_PER_NODE = 3;

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const GENERATION_SCHEMA = {
  type: 'object',
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          prompt: { type: 'string' },
          choices: { type: 'array', items: { type: 'string' } },
          // Parallel to `choices`, same length, "" for the correct choice — see
          // choice_tags on QuizQuestion in @zynth/shared. Optional: Live Co-Pilot
          // degrades gracefully (loses its C1/S4 tag-matching signal) without it.
          choice_tags: { type: 'array', items: { type: 'string' } },
          correct_answer: { type: 'string' },
          question_type: { type: 'string' },
          explanation: { type: 'string' },
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
  choice_tags?: unknown;
  correct_answer?: unknown;
  question_type?: unknown;
  explanation?: unknown;
}

/** Deterministic, clearly-labelled canned questions — used in STUB_MODE and as a
 * failure fallback so quiz generation can never hard-fail the demo. */
function buildCannedQuestions(node: Node): QuizQuestion[] {
  const label = node.label;
  return [
    {
      id: `q_${nanoid(8)}`,
      node_id: node.id,
      prompt: `[stub] Which statement best describes "${label}"?`,
      choices: [
        `A correct, textbook-accurate description of ${label}`,
        `A description of an unrelated concept`,
        `A common misconception about ${label}`,
        `A description that reverses the actual rule for ${label}`,
      ],
      correct_answer: `A correct, textbook-accurate description of ${label}`,
      question_type: 'mcq',
      explanation: `[stub] The first choice states the accepted definition of ${label}.`,
    },
    {
      id: `q_${nanoid(8)}`,
      node_id: node.id,
      prompt: `[stub] Which of these is a common mistake students make with "${label}"?`,
      choices: [
        `Applying ${label} without checking its conditions first`,
        `Applying ${label} correctly`,
        `Skipping ${label} entirely`,
        `Double-checking ${label} with a worked example`,
      ],
      correct_answer: `Applying ${label} without checking its conditions first`,
      question_type: 'mcq',
      explanation: `[stub] Most errors on ${label} come from skipping a precondition.`,
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
      explanation: `[stub] The other three choices are all genuine properties of ${label}.`,
    },
    {
      id: `q_${nanoid(8)}`,
      node_id: node.id,
      prompt: `[stub] In your own words, explain the key idea behind "${label}" and why it matters.`,
      correct_answer: `[stub reference answer] ${label} works because its defining rule holds under its stated conditions, and it matters because it lets you solve problems that would otherwise be intractable.`,
      question_type: 'free_response',
      explanation: `[stub] A strong answer names the defining rule of ${label} and one reason it's useful.`,
    },
  ];
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === 'string' && v.trim().length > 0;
}

/**
 * Validates + normalizes one raw generated question into a QuizQuestion tied
 * to `node`. Returns null if the shape can't be trusted — callers should drop
 * (and, if needed, backfill with a canned question) rather than propagate
 * garbage into the quiz.
 */
function validateGeneratedQuestion(node: Node, raw: RawGeneratedQuestion): QuizQuestion | null {
  if (!isNonEmptyString(raw.prompt) || !isNonEmptyString(raw.correct_answer)) {
    return null;
  }
  const questionType = raw.question_type === 'mcq' || raw.question_type === 'free_response'
    ? raw.question_type
    : null;
  if (!questionType) return null;

  if (questionType === 'mcq') {
    if (
      !Array.isArray(raw.choices) ||
      raw.choices.length !== 4 ||
      !raw.choices.every(isNonEmptyString)
    ) {
      return null;
    }
    if (!raw.choices.includes(raw.correct_answer)) {
      // correct_answer must be exactly one of the offered choices for exact-match grading.
      return null;
    }
  }

  // choice_tags is OPTIONAL and must degrade gracefully: only kept when it's
  // an array of the exact same length as choices, every entry a string (""
  // allowed for the correct choice), and the tag on the correct choice's slot
  // is empty. Anything else (wrong length, non-strings, missing) -> undefined,
  // never a reason to drop the whole question.
  let choiceTags: string[] | undefined;
  if (questionType === 'mcq' && Array.isArray(raw.choice_tags)) {
    const choices = raw.choices as string[];
    const tags = raw.choice_tags;
    const validShape =
      tags.length === choices.length && tags.every((t) => typeof t === 'string');
    if (validShape) {
      const correctIdx = choices.indexOf(raw.correct_answer as string);
      const normalized = (tags as string[]).map((t) => t.trim());
      if (correctIdx === -1 || normalized[correctIdx] === '') {
        choiceTags = normalized;
      }
      // else: model tagged the correct choice with a non-empty misconception
      // tag, which is internally inconsistent — drop the tags, keep the question.
    }
  }

  return {
    id: `q_${nanoid(8)}`,
    node_id: node.id,
    prompt: raw.prompt,
    choices: questionType === 'mcq' ? (raw.choices as string[]) : undefined,
    correct_answer: raw.correct_answer,
    question_type: questionType,
    explanation: isNonEmptyString(raw.explanation) ? raw.explanation : undefined,
    choice_tags: choiceTags,
  };
}

/**
 * Generates 4 questions (3 MCQ + 1 free-response) for a single node via
 * Gemini structured output. Falls back to canned questions in STUB_MODE, on
 * any Gemini error, or if the model's output doesn't validate — generation
 * must never throw.
 */
export async function generateQuestionsForNode(node: Node): Promise<QuizQuestion[]> {
  if (STUB_MODE || !ai) {
    return buildCannedQuestions(node);
  }

  // What the student was just shown, if they came here from Intuition. Without
  // this, the two model calls each interpret the node label independently and
  // can land on completely different facets of it — a visual about a parabola's
  // derivative followed by questions on PCA eigenvectors. Since a passed quiz is
  // the only route to green, that makes green measure luck.
  const focus = getConceptFocus(node.id);
  const focusContext = focus
    ? `

CRITICAL — the student has JUST worked through an interactive visual on this exact node, titled "${focus.title}", whose stated objective was:
    "${focus.objective}"
Every question you write MUST test THAT objective. This is what they were actually taught, and it is the only thing it is fair to examine them on right now. Do not wander to other facets of "${node.label}" however important those facets are in general — an unanswerable quiz is worse than no quiz. You may vary difficulty and framing, and you may probe whether the idea transfers to a new situation, but the underlying idea being tested must be the objective above.`
    : '';

  const prompt = `You are writing a short mastery quiz for one syllabus concept.
Concept: "${node.label}" (subject: ${node.subject}).${focusContext}

Generate exactly ${QUESTIONS_PER_NODE} questions testing understanding of this concept:
- ${MCQ_PER_NODE} multiple-choice questions (question_type "mcq"), each with EXACTLY 4 short answer choices in "choices", where "correct_answer" is copied EXACTLY (character for character) from one of the 4 choices.
- 1 free-response question (question_type "free_response"), where "correct_answer" is a concise model/reference answer usable as a grading rubric.
Every question needs a short "explanation" of why the correct answer is correct.
For every MCQ, also return "choice_tags": an array the SAME LENGTH as "choices", one short snake_case tag per choice naming the SPECIFIC misconception a student would hold to pick that wrong choice (e.g. "drops_negative_sign", "confuses_product_and_chain_rule"). Use "" for the correct choice's tag. If two different MCQ questions in this set have a wrong choice driven by the SAME underlying misconception, reuse the EXACT SAME tag string for both — this lets a downstream system detect that two separate wrong answers share one root cause rather than being unrelated slips. Do not tag trivial/careless-slip choices with a fake concept name; only tag choices that reflect a real, nameable misunderstanding.
Do not reference these instructions in the output. Vary the wrong MCQ choices so none are trivially eliminable.`;

  try {
    const res = await withModelRetry(
      () => ai.models.generateContent({
      model: config.geminiModel,
      contents: prompt,
      config: {
        responseMimeType: 'application/json',
        responseSchema: GENERATION_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
        // 4 questions, each with 4 choices, 4 parallel misconception tags, a
        // correct answer and an explanation, plus a free-response rubric. At 2048
        // the model was silently truncated mid-string and JSON.parse threw
        // "Unterminated string at position 5968", which the catch below turned
        // into stub questions — so the real symptom was a quiz full of
        // "[stub] Which statement best describes X?" placeholders, with the
        // actual cause buried in a log line. Truncation is not a rare edge here:
        // a fully-populated response is comfortably over 2048.
        maxOutputTokens: 4096,
      },
      }),
      { label: `quiz generation for "${node.label}"` },
    );

    const text = res.text;
    if (!text) {
      throw new Error('Gemini returned an empty response for quiz generation');
    }

    const parsed: unknown = JSON.parse(text);
    const rawQuestions = (parsed as { questions?: unknown })?.questions;
    if (!Array.isArray(rawQuestions)) {
      throw new Error('Gemini quiz generation response missing questions[]');
    }

    const validated = rawQuestions
      .map((q) => validateGeneratedQuestion(node, q as RawGeneratedQuestion))
      .filter((q): q is QuizQuestion => q !== null);

    const mcqCount = validated.filter((q) => q.question_type === 'mcq').length;
    const freeResponseCount = validated.filter((q) => q.question_type === 'free_response').length;

    // Require at least the shape we asked for; anything short (bad JSON,
    // model dropped a question, wrong type mix) falls back to canned rather
    // than shipping a malformed/short quiz.
    if (mcqCount < MCQ_PER_NODE || freeResponseCount < 1) {
      throw new Error(
        `Gemini quiz generation produced an invalid mix (mcq=${mcqCount}, free_response=${freeResponseCount})`,
      );
    }

    // Trim to exactly the target shape in case the model over-generated.
    const mcqs = validated.filter((q) => q.question_type === 'mcq').slice(0, MCQ_PER_NODE);
    const freeResponses = validated
      .filter((q) => q.question_type === 'free_response')
      .slice(0, 1);

    return [...mcqs, ...freeResponses];
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error(`[quizService] generateQuestionsForNode(${node.id}) failed, falling back to canned questions:`, err);
    return buildCannedQuestions(node);
  }
}

/** Generates questions for every node in the quiz, node-by-node, concatenated in order. */
export async function generateQuiz(nodes: Node[]): Promise<QuizQuestion[]> {
  const perNode = await Promise.all(nodes.map((node) => generateQuestionsForNode(node)));
  return perNode.flat();
}

// ---------------------------------------------------------------------------
// Grading
// ---------------------------------------------------------------------------

/**
 * Grades one already-answered question in place (returns a new object).
 * MCQ: exact string match against correct_answer. Free-response: delegated
 * to the Groq grader, which is itself bulletproof (never throws).
 */
async function gradeQuestion(question: QuizQuestion): Promise<QuizQuestion> {
  const givenAnswer = question.given_answer ?? '';

  if (question.question_type === 'free_response') {
    const { is_correct, feedback } = await gradeFreeResponse(question, givenAnswer);
    return {
      ...question,
      given_answer: givenAnswer,
      is_correct,
      explanation: question.explanation ? `${question.explanation} (Grader: ${feedback})` : feedback,
    };
  }

  // mcq (or unspecified — default to exact-match behavior for safety)
  const isCorrect = givenAnswer === question.correct_answer;
  return { ...question, given_answer: givenAnswer, is_correct: isCorrect };
}

export interface GradedQuiz {
  questions: QuizQuestion[];
  score: number;
  passed: boolean;
}

/**
 * Grades every question in the quiz and computes a pooled score across ALL
 * questions (MCQ + free-response together), matching the locked spec:
 * score = round(100 * correct / total); passed = score >= QUIZ_PASS_THRESHOLD.
 */
export async function gradeQuiz(questions: QuizQuestion[]): Promise<GradedQuiz> {
  const graded = await Promise.all(questions.map((q) => gradeQuestion(q)));
  const total = graded.length;
  const correct = graded.filter((q) => q.is_correct).length;
  const score = total > 0 ? Math.round((100 * correct) / total) : 0;
  const passed = score >= QUIZ_PASS_THRESHOLD;
  return { questions: graded, score, passed };
}

/**
 * Grades exactly one question (question.given_answer must already be set).
 * Exposed for the Live Co-Pilot's `POST /api/quiz/answer` — it needs the same
 * MCQ-exact-match / Groq-free-response grading as bulk submit, but per-question
 * and off the bulk-submit path. Thin wrapper over the same private
 * `gradeQuestion` so there is exactly one grading implementation.
 */
export async function gradeSingleQuestion(question: QuizQuestion): Promise<QuizQuestion> {
  return gradeQuestion(question);
}

// ---------------------------------------------------------------------------
// Live Co-Pilot support: in-memory "what quiz is this session" registry +
// mistake-excerpt formatting shared between /quiz/submit and copilotService.
//
// There is no DB table for an in-progress quiz (QuizSession is only written
// at final submit — see db/schema.sql), and the Co-Pilot's fixed
// `POST /api/quiz/answer` body (session_id, question_id, node_id, ...) never
// carries the full question text/choices/correct_answer. So `/quiz/generate`
// registers the exact question set it just generated here, keyed by the same
// quiz_id it hands back to the client as `session_id` for every subsequent
// `/quiz/answer` call. This is a deliberate, minimal adaptation of the spec's
// literal request body — the alternative (stuffing full question payloads
// into every answer POST) would be far more fragile. Purely in-memory and
// process-lifetime — fine for the hackathon demo, not meant to survive a
// server restart mid-quiz.
// ---------------------------------------------------------------------------

export interface RegisteredQuizSession {
  session_id: string;
  node_ids: string[];
  questions: QuizQuestion[];
  /** Cutoff for "predating the session" checks (MistakeRecord corroborators, P3). */
  started_at: string;
}

const quizSessionRegistry = new Map<string, RegisteredQuizSession>();

export function registerQuizSession(sessionId: string, nodeIds: string[], questions: QuizQuestion[]): RegisteredQuizSession {
  const registered: RegisteredQuizSession = {
    session_id: sessionId,
    node_ids: nodeIds,
    questions,
    started_at: new Date().toISOString(),
  };
  quizSessionRegistry.set(sessionId, registered);
  return registered;
}

export function getQuizSession(sessionId: string): RegisteredQuizSession | undefined {
  return quizSessionRegistry.get(sessionId);
}

/**
 * The tag of the choice the student actually picked, or undefined if the
 * question isn't a tagged MCQ, has no given_answer, or the chosen choice's
 * tag is empty/unset. Parallel-array lookup against `choices`/`choice_tags`.
 */
export function chosenChoiceTag(question: QuizQuestion): string | undefined {
  if (!question.choices || !question.choice_tags || question.given_answer == null) return undefined;
  const idx = question.choices.indexOf(question.given_answer);
  if (idx < 0) return undefined;
  const tag = question.choice_tags[idx];
  return tag && tag.trim().length > 0 ? tag : undefined;
}

/**
 * The canonical raw_excerpt format for a wrong-answer MistakeRecord, used by
 * BOTH /quiz/submit (every wrong answer, at final grading) and copilotService
 * (a live V2 careless_slip drop). Keeping the format in exactly one place is
 * what lets P3's lexical-overlap matching find these records again later.
 */
export function buildMistakeExcerpt(question: QuizQuestion): string {
  const tag = chosenChoiceTag(question) ?? '-';
  return `Q: ${question.prompt} | Chose: ${question.given_answer ?? ''} | Correct: ${question.correct_answer} | Tag: ${tag}`;
}
