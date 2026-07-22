/**
 * Free-response quiz grading via Groq (llama-3.3-70b-versatile). This is the
 * ONE Adam-approved exception to the single-runtime-provider (Gemini) rule —
 * scoped narrowly to grading a student's written answer against a reference
 * answer. It never touches Node.status directly; its output (`is_correct`)
 * only ever reaches statusService indirectly, via quizService's score/passed
 * computation and the caller's own applyQuizResult call.
 *
 * Bulletproof by design: any network failure, missing key, bad JSON, or
 * malformed shape falls back to a deterministic, clearly-labelled stub rather
 * than throwing. A quiz must always be gradeable, even fully offline.
 */
import type { QuizQuestion } from '@zynth/shared';
import { config } from '../config';

export interface FreeResponseGrade {
  is_correct: boolean;
  feedback: string;
}

const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

const GRADER_SYSTEM_PROMPT =
  'You are a strict but fair grader. Return ONLY JSON {"is_correct":bool,"feedback":string}.';

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((word) => word.length > 3), // skip tiny stopword-ish tokens
  );
}

/**
 * Deterministic stand-in used when there's no GROQ_API_KEY configured, or the
 * live call fails for any reason: correct iff the student wrote something
 * non-trivial AND shares at least one meaningful keyword with the reference
 * answer. Clearly a stub — never mistaken for a real grade in logs/UI.
 */
function stubGrade(question: QuizQuestion, givenAnswer: string): FreeResponseGrade {
  const trimmed = givenAnswer.trim();
  if (trimmed.length === 0) {
    return { is_correct: false, feedback: '[stub grader] No answer was given.' };
  }
  const referenceTokens = tokenize(question.correct_answer);
  const givenTokens = tokenize(trimmed);
  const overlaps = [...givenTokens].some((token) => referenceTokens.has(token));
  return {
    is_correct: overlaps,
    feedback: overlaps
      ? '[stub grader] Your answer shares key terms with the reference answer.'
      : '[stub grader] Your answer does not clearly match the reference answer\'s key ideas.',
  };
}

function isValidGradeShape(value: unknown): value is FreeResponseGrade {
  return (
    !!value &&
    typeof value === 'object' &&
    typeof (value as Record<string, unknown>).is_correct === 'boolean' &&
    typeof (value as Record<string, unknown>).feedback === 'string'
  );
}

/**
 * Grades a single free-response answer. Never throws — on any failure
 * (missing key, network error, malformed response) it degrades to
 * `stubGrade`, keeping the whole quiz submit path bulletproof.
 */
export async function gradeFreeResponse(
  question: QuizQuestion,
  givenAnswer: string,
): Promise<FreeResponseGrade> {
  if (!config.groqApiKey) {
    return stubGrade(question, givenAnswer);
  }

  try {
    const res = await fetch(GROQ_ENDPOINT, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.groqApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.groqModel,
        messages: [
          { role: 'system', content: GRADER_SYSTEM_PROMPT },
          {
            role: 'user',
            content: `Question: ${question.prompt}\nReference answer: ${question.correct_answer}\nStudent answer: ${givenAnswer}\nDoes the student answer demonstrate correct understanding?`,
          },
        ],
        temperature: 0,
        response_format: { type: 'json_object' },
      }),
    });

    if (!res.ok) {
      throw new Error(`Groq responded ${res.status}`);
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error('Groq response missing choices[0].message.content');
    }

    const parsed: unknown = JSON.parse(content);
    if (!isValidGradeShape(parsed)) {
      throw new Error('Groq response JSON did not match {is_correct, feedback} shape');
    }

    return parsed;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[groqGrader] gradeFreeResponse failed, falling back to stub:', err);
    return stubGrade(question, givenAnswer);
  }
}
