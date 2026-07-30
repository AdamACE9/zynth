/**
 * Explain — the calm, context-aware 1:1 tutor chat for a single concept node.
 *
 * Unlike War Room (a theatrical 5-persona debate), Explain is a single warm
 * tutor voice that already knows the node, the student's recorded mistakes on
 * it, and its mastery/status trend — so the student never has to re-explain
 * their situation. This module is the single choke point for that context
 * assembly + the Gemini multi-turn chat + session persistence.
 *
 * Status: per statusService, engaged_at is set on the FIRST War Room OR
 * Explain interaction, ever (red -> amber). This module calls
 * statusService.engageNode() exactly once per session — only when the
 * session has no prior student messages before this call.
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import type { ExplainMessage, ExplainSession, MistakeRecord, Node, StatusHistoryEntry } from '@zynth/shared';
import { config, STUB_MODE, getActiveStudentId } from '../config';
import { AGENT_CONFIGS } from '../agents/personas';
import { explainSessionsRepo, mistakeRecordsRepo, nodesRepo } from '../db/repositories';
import { engageNode } from './statusService';
import { getConceptFocus } from './conceptFocus';
import { withModelRetry } from '../agents/retry';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

function findExplainPersona() {
  const persona = AGENT_CONFIGS.find((c) => c.name === 'explain_tutor');
  if (!persona) {
    throw new Error('explainService: no AgentConfig registered for "explain_tutor"');
  }
  return persona;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Short human-readable status trend, e.g. "red -> amber this week; no failed retests." */
function summarizeTrend(history: StatusHistoryEntry[]): string {
  if (history.length === 0) return 'No status history recorded yet.';
  const recent = history.slice(-4);
  const chain = recent.map((h) => h.status).join(' -> ');
  const last = recent[recent.length - 1]!;
  const lastWhen = new Date(last.timestamp).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
  return `${chain} (most recent change: ${last.cause} on ${lastWhen}).`;
}

function summarizeMistakes(mistakes: MistakeRecord[]): string {
  if (mistakes.length === 0) {
    return 'No recorded mistakes on this concept yet — this may be a first pass or a confidence check.';
  }
  return mistakes
    .map((m, i) => `${i + 1}. [${m.error_type}] "${m.raw_excerpt}" (from ${m.source})`)
    .join('\n');
}

/**
 * Builds the systemInstruction that folds in everything the tutor already
 * knows about this student+node, so the student never has to re-explain
 * their situation.
 */
export function buildContextInstruction(node: Node, mistakes: MistakeRecord[]): string {
  // What Intuition just taught, if anything. The quiz is generated against this
  // same objective, so naming it here is what makes the tutor cover the ground
  // the student is about to be examined on rather than a different slice.
  const focus = getConceptFocus(node.id);
  const persona = findExplainPersona();
  const trend = summarizeTrend(node.history);
  const mistakeList = summarizeMistakes(mistakes);

  return (
    `${persona.system_prompt}\n\n` +
    `--- STUDENT CONTEXT (you already know this — never ask the student to re-explain it) ---\n` +
    `Concept: ${node.label} (${node.subject}).\n` +
    `Current status: ${node.status}, mastery score ${node.mastery_score}/100.\n` +
    `Status trend: ${trend}\n` +
    `Known mistakes on this concept:\n${mistakeList}\n` +
    `--- END CONTEXT ---\n\n` +
    `Diagnose from what you already know above. If it's useful, ask ONE focused question — but do not make the ` +
    `student restate their situation from scratch. Be calm, concise, and encouraging.`
  );
}

function stubReply(node: Node, mistakes: MistakeRecord[], message: string): string {
  const trimmed = message.length > 80 ? `${message.slice(0, 77)}...` : message;
  if (mistakes.length > 0) {
    const m = mistakes[mistakes.length - 1]!;
    return (
      `[stub:explain_tutor] I can see you've been working on ${node.label}, currently ${node.status} at ` +
      `${node.mastery_score}/100. Your last recorded slip was a ${m.error_type} — "${m.raw_excerpt}". ` +
      `Let's start there: about "${trimmed}", walk me through the step right before it goes wrong.`
    );
  }
  return (
    `[stub:explain_tutor] Looking at ${node.label} (${node.status}, ${node.mastery_score}/100) — no recorded ` +
    `mistakes yet, so let's check your footing on "${trimmed}" before we go further.`
  );
}

function toGeminiHistory(messages: ExplainMessage[]): { role: 'user' | 'model'; parts: { text: string }[] }[] {
  return messages.map((m) => ({
    role: m.role === 'student' ? 'user' : 'model',
    parts: [{ text: m.content }],
  }));
}

export interface ExplainTurnResult {
  session_id: string;
  messages: ExplainMessage[];
  tutor_reply: string;
}

/**
 * Handles one turn of the Explain chat for a node: loads/creates the
 * ExplainSession, engages the node on the very first student message, calls
 * Gemini (or the stub) with full context, persists the exchange, and returns
 * the updated session.
 */
export async function sendExplainTurn(
  nodeId: string,
  message: string,
  sessionId?: string,
): Promise<ExplainTurnResult> {
  const node = nodesRepo.getById(nodeId);
  if (!node) {
    throw new Error(`sendExplainTurn: no node with id ${nodeId}`);
  }

  const studentId = getActiveStudentId();
  const allMistakes = mistakeRecordsRepo.getByStudent(studentId);
  const nodeMistakes = allMistakes.filter((m) => m.node_id === nodeId);

  // Load or create the session.
  let session: ExplainSession | undefined;
  if (sessionId) {
    session = explainSessionsRepo.getById(sessionId);
  }
  if (!session) {
    session = explainSessionsRepo.getByNode(studentId, nodeId) ?? undefined;
  }

  const isNewSession = !session;
  if (!session) {
    session = {
      id: `explain_${nanoid(10)}`,
      student_id: studentId,
      node_id: nodeId,
      messages: [],
      created_at: nowIso(),
    };
  }

  // First-ever student message in this session -> engage the node (idempotent).
  const hasPriorStudentMessage = session.messages.some((m) => m.role === 'student');
  if (!hasPriorStudentMessage) {
    engageNode(nodeId);
  }

  const systemInstruction = buildContextInstruction(node, nodeMistakes);

  let tutorReply: string;
  if (STUB_MODE || !ai) {
    tutorReply = stubReply(node, nodeMistakes, message);
  } else {
    try {
      const chat = ai.chats.create({
        model: config.geminiModel,
        history: toGeminiHistory(session.messages),
        config: {
          systemInstruction,
          thinkingConfig: { thinkingBudget: 0 },
          maxOutputTokens: 700,
        },
      });
      const resp = await chat.sendMessage({ message });
      tutorReply = resp.text ?? '';
      if (!tutorReply) {
        throw new Error('Gemini returned an empty response');
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error('[explainService] Gemini call failed, falling back to stub:', err);
      tutorReply = `[stub:explain_tutor:error-fallback] ${stubReply(node, nodeMistakes, message)}`;
    }
  }

  const now = nowIso();
  const studentMessage: ExplainMessage = { role: 'student', content: message, at: now };
  const tutorMessage: ExplainMessage = { role: 'tutor', content: tutorReply, at: nowIso() };
  const updatedMessages = [...session.messages, studentMessage, tutorMessage];

  if (isNewSession) {
    explainSessionsRepo.insert({ ...session, messages: updatedMessages });
  } else {
    explainSessionsRepo.update(session.id, { messages: updatedMessages });
  }

  return {
    session_id: session.id,
    messages: updatedMessages,
    tutor_reply: tutorReply,
  };
}

/**
 * The opening lesson: a complete, structured explanation of the concept,
 * delivered before the student has asked anything.
 *
 * Explain used to be purely reactive — it waited for a question. That is the
 * wrong shape for its new position in the flow. Intuition builds the intuition
 * and is deliberately tiny (one slider, one prediction, ~40 words); it does not
 * and should not carry the full content. Adam: "make explain ai step 2, and it
 * should have all knowledge that will be tested in the quiz. as the visualize
 * isnt enough."
 *
 * So the tutor now teaches first and takes questions after. It is scoped by the
 * same conceptFocus objective the quiz is generated from, which is what makes
 * "everything the quiz tests was covered here" true by construction rather than
 * by luck.
 */
export async function generateOpeningLesson(nodeId: string): Promise<{ lesson: string; stubbed: boolean }> {
  const node = nodesRepo.getById(nodeId);
  if (!node) throw new Error(`generateOpeningLesson: no node with id ${nodeId}`);

  const mistakes = mistakeRecordsRepo.getByNode(nodeId);
  const focus = getConceptFocus(nodeId);

  if (STUB_MODE || !ai) {
    return {
      lesson:
        `[stub:explain_tutor] Here is the short version of ${node.label}. ` +
        `Add a GEMINI_API_KEY to get the full lesson, then ask me anything about it.`,
      stubbed: true,
    };
  }

  const prompt =
    `${buildContextInstruction(node, mistakes)}

` +
    `TASK: teach this concept from scratch, right now, before the student asks anything.
` +
    `Cover EVERYTHING they will be examined on${focus ? ` under the objective "${focus.objective}"` : ` about ${node.label}`}. ` +
    `They are about to take a quiz built from exactly that scope, so anything you leave out is something they can fairly be asked and will not know.

` +
    `Shape it as:
` +
    `1. What it is, in plain language.
` +
    `2. The mechanism — how it actually works, with one concrete worked example using real numbers.
` +
    `3. The mistake people make here, named specifically${mistakes.length ? ' (theirs above included)' : ''}.
` +
    `4. One line on how to check yourself.

` +
    `Use short paragraphs and plain sentences. No headings, no markdown, no bullet characters — this renders as chat.

` +
    `CRITICAL — this is a single uninterrupted explanation, not a conversation:
` +
    `- Do NOT write the student's side. No "(Student replies)", no imagined answers, no dialogue.
` +
    `- Do NOT ask questions inside the lesson or pause for a response. You are teaching, not interviewing.
` +
    `- Do NOT open with a greeting or "today we're going to learn". Start with the actual content.
` +
    `(The tutor persona above tells you to ask a focused question first. That applies to later turns in the chat, NOT to this opening lesson.)
` +
    `Only the very last sentence may invite a question.

` +
    `Aim for 180-260 words: complete enough to answer the quiz from, short enough to actually read.`;

  try {
    const res = await withModelRetry(
      () =>
        ai.models.generateContent({
          model: config.geminiModel,
          contents: prompt,
          config: { thinkingConfig: { thinkingBudget: 0 }, maxOutputTokens: 1400 },
        }),
      { label: `opening lesson for "${node.label}"` },
    );

    const lesson = res.text?.trim();
    if (!lesson) throw new Error('empty lesson');
    return { lesson, stubbed: false };
  } catch (err) {
    console.warn('[explainService] opening lesson failed:', err instanceof Error ? err.message : err);
    return {
      lesson: `Let's go through ${node.label} together. Ask me what you'd like to start with — or tell me which part feels shakiest.`,
      stubbed: true,
    };
  }
}
