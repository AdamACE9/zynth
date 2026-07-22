/**
 * Streaming version of the War Room debate (server/src/agents/orchestrator.ts
 * has the original blocking runWarRoom()). This is the Day 2 demo centerpiece:
 * clicking a red/amber node opens a live multi-persona debate that streams
 * token-by-token over Socket.io and, on convergence, flips the node red→amber.
 *
 * `runWarRoomStream(nodeId)` returns a session_id SYNCHRONOUSLY and kicks the
 * actual 5-persona debate off in the background — the HTTP handler in
 * routes/nodes.ts never blocks on the debate, the client instead follows the
 * 'warroom:turn' / 'warroom:resolved' socket events keyed by that session_id.
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import type { AgentName, Node, WarRoomMessage, WarRoomPersona, WarRoomSession } from '@zynth/shared';
import { config, STUB_MODE, DEMO_STUDENT_ID } from '../config';
import { AGENT_CONFIGS } from './personas';
import { nodesRepo, warRoomSessionsRepo } from '../db/repositories';
import { emitWarRoomTurn, emitWarRoomResolved } from '../socket';
import { engageNode } from '../services/statusService';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

function findPersonaConfig(name: AgentName) {
  const persona = AGENT_CONFIGS.find((c) => c.name === name);
  if (!persona) {
    throw new Error(`warRoomStream: no AgentConfig registered for "${name}"`);
  }
  return persona;
}

const WAR_ROOM_SEQUENCE: { agent: AgentName; persona: WarRoomPersona }[] = [
  { agent: 'war_room_analogist', persona: 'analogist' },
  { agent: 'war_room_purist', persona: 'purist' },
  { agent: 'war_room_real_world', persona: 'real_world' },
  { agent: 'war_room_skeptic', persona: 'skeptic' },
  { agent: 'war_room_synthesis', persona: 'synthesis' },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Deterministic, node-appropriate canned paragraph per persona — used in
 * STUB_MODE (no Gemini key) and as a per-turn fallback if a live stream call
 * errors mid-debate. Written to feel like a real response to the prior
 * turns (skeptic challenges, synthesis converges) rather than a parallel
 * monologue, same spirit as orchestrator.ts's stubText().
 */
function stubParagraph(persona: WarRoomPersona, node: Pick<Node, 'label' | 'subject'>): string {
  const { label, subject } = node;
  switch (persona) {
    case 'analogist':
      return `Ok so "${label}" is basically a recipe step — do it out of order and everything after it quietly breaks. 🍳`;
    case 'purist':
      return `Cute, but analogies leak. For "${label}" you actually have to check the definition — does every condition really hold? That's the test.`;
    case 'real_world':
      return `And it's not busywork — "${label}" is exactly the step that bites people later in ${subject} if it's shaky now.`;
    case 'skeptic':
      return `Hang on — does that survive the weird edge case? Push "${label}" to a degenerate input. If it still holds, fine. If not, we're not done.`;
    case 'synthesis':
    default:
      return `Pulling it together: "${label}" is one clean idea — intuitive like the analogy, precise like the definition, and it held up to the skeptic. Keep that version.`;
  }
}

/** Emits a canned paragraph token-by-token (word-by-word) with a small delay, returning the full text. */
async function streamStub(
  sessionId: string,
  node: Node,
  persona: WarRoomPersona,
): Promise<string> {
  const paragraph = stubParagraph(persona, node);
  const words = paragraph.split(' ');
  let fullMessage = '';
  for (const word of words) {
    const chunkText = (fullMessage ? ' ' : '') + word;
    fullMessage += chunkText;
    emitWarRoomTurn({ session_id: sessionId, node_id: node.id, persona, phase: 'token', text: chunkText });
    // eslint-disable-next-line no-await-in-loop
    await sleep(40);
  }
  return fullMessage;
}

/** Streams a live Gemini turn, emitting each chunk as it arrives, returning the full accumulated text. */
async function streamLive(
  sessionId: string,
  node: Node,
  agent: AgentName,
  persona: WarRoomPersona,
  transcript: WarRoomMessage[],
): Promise<string> {
  if (!ai) {
    throw new Error('streamLive called without a Gemini client');
  }
  const personaCfg = findPersonaConfig(agent);
  const priorContext = transcript.map((m) => `${m.agent_persona}: ${m.message}`).join('\n');
  const userPrompt = priorContext
    ? `You're in the Zynth War Room group chat about "${node.label}" (${node.subject}). A student is stuck on it.\n\nChat so far:\n${priorContext}\n\nText your reply. React to what someone just said (call them out by name), add ONE sharp beat, and pass it on. 1-2 short sentences, plain text.`
    : `You're kicking off the Zynth War Room group chat about "${node.label}" (${node.subject}). A student is stuck on it. Drop your opening take — 1-2 short sentences, like a text message.`;

  // The persona system prompts (personas.ts) describe each voice; this appended
  // directive forces the *format*: short, conversational, no markdown — a group
  // chat where the agents text each other, not five essays.
  const systemInstruction = `${personaCfg.system_prompt}\n\n=== WAR ROOM CHAT FORMAT (overrides any length hints above) ===\nYou are texting in a fast group chat with the other agents (Analogist, Purist, Real-World, Skeptic, Synthesis). Rules:\n- 1-2 SHORT sentences. A text message, never a paragraph or a lecture.\n- Talk TO the others by name when you react ("the Analogist's kitchen thing works, but…", "fair point Skeptic —").\n- Plain conversational text ONLY. Absolutely no markdown: no **bold**, no *italics*, no #headings, no bullet/numbered lists, no code fences, no backticks.\n- Add one sharp, specific beat about "${node.label}" and stop. Don't restate the whole concept.`;

  const stream = await ai.models.generateContentStream({
    model: personaCfg.model,
    contents: userPrompt,
    config: {
      systemInstruction,
      temperature: personaCfg.temperature,
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 160,
    },
  });

  let fullMessage = '';
  for await (const chunk of stream) {
    const t = chunk.text;
    if (t) {
      fullMessage += t;
      emitWarRoomTurn({ session_id: sessionId, node_id: node.id, persona, phase: 'token', text: t });
    }
  }

  if (!fullMessage) {
    throw new Error('Gemini streamed an empty response');
  }
  return fullMessage;
}

async function runDebate(sessionId: string, node: Node): Promise<void> {
  const transcript: WarRoomMessage[] = [];

  for (const step of WAR_ROOM_SEQUENCE) {
    emitWarRoomTurn({ session_id: sessionId, node_id: node.id, persona: step.persona, phase: 'start', text: '' });

    let fullMessage: string;
    if (STUB_MODE || !ai) {
      // eslint-disable-next-line no-await-in-loop
      fullMessage = await streamStub(sessionId, node, step.persona);
    } else {
      try {
        // eslint-disable-next-line no-await-in-loop
        fullMessage = await streamLive(sessionId, node, step.agent, step.persona, transcript);
      } catch (err) {
        // Never let a bad key / quota / network hiccup kill the demo mid-debate.
        // eslint-disable-next-line no-console
        console.error(`[warRoomStream] live stream for ${step.persona} failed, falling back to stub:`, err);
        // eslint-disable-next-line no-await-in-loop
        fullMessage = await streamStub(sessionId, node, step.persona);
      }
    }

    emitWarRoomTurn({ session_id: sessionId, node_id: node.id, persona: step.persona, phase: 'done', text: fullMessage });
    transcript.push({ agent_persona: step.persona, message: fullMessage, at: new Date().toISOString() });
  }

  const session: WarRoomSession = {
    id: sessionId,
    student_id: DEMO_STUDENT_ID,
    node_id: node.id,
    transcript,
    outcome: 'understood',
    created_at: new Date().toISOString(),
  };
  warRoomSessionsRepo.insert(session);

  // The whole point: War Room engagement is what flips a node red -> amber.
  // engageNode is the ONLY function in this codebase allowed to change
  // Node.status (see services/statusService.ts) — we never touch it directly.
  const updatedNode = engageNode(node.id);

  emitWarRoomResolved({ session_id: sessionId, node_id: node.id, outcome: 'understood', node: updatedNode });
}

/**
 * Kicks off the streaming War Room debate for a node and returns immediately
 * with a session_id — the 5-persona debate (analogist → purist → real_world →
 * skeptic → synthesis) runs asynchronously in the background, emitting
 * 'warroom:turn' (start/token/done per persona) and finally 'warroom:resolved'
 * once the session is persisted and the node has been engaged.
 */
export function runWarRoomStream(nodeId: string): { session_id: string } {
  const node = nodesRepo.getById(nodeId);
  if (!node) {
    throw new Error(`runWarRoomStream: no node with id ${nodeId}`);
  }

  const session_id = `warroom_${nanoid(10)}`;

  // Fire-and-forget — the HTTP response must not wait on this.
  void runDebate(session_id, node).catch((err) => {
    // eslint-disable-next-line no-console
    console.error(`[warRoomStream] debate for session ${session_id} crashed:`, err);
  });

  return { session_id };
}
