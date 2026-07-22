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
import { config, STUB_MODE, DEMO_STUDENT_ID } from '../config';
import { AGENT_CONFIGS } from '../agents/personas';
import { explainSessionsRepo, mistakeRecordsRepo, nodesRepo } from '../db/repositories';
import { engageNode } from './statusService';

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

  const allMistakes = mistakeRecordsRepo.getByStudent(DEMO_STUDENT_ID);
  const nodeMistakes = allMistakes.filter((m) => m.node_id === nodeId);

  // Load or create the session.
  let session: ExplainSession | undefined;
  if (sessionId) {
    session = explainSessionsRepo.getById(sessionId);
  }
  if (!session) {
    session = explainSessionsRepo.getByNode(DEMO_STUDENT_ID, nodeId) ?? undefined;
  }

  const isNewSession = !session;
  if (!session) {
    session = {
      id: `explain_${nanoid(10)}`,
      student_id: DEMO_STUDENT_ID,
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
