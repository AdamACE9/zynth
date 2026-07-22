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
      return (
        `Think about "${label}" like a recipe in the kitchen: each step only works if it happens in the right ` +
        `order. In ${subject}, this concept is the "crack the eggs before you fold them in" step — skip it or do it ` +
        `out of sequence and everything downstream looks fine for a moment, then quietly falls apart.`
      );
    case 'purist':
      return (
        `Let's be precise about "${label}". Formally, the defining property holds if and only if its stated ` +
        `conditions are satisfied — nothing more, nothing less. In ${subject}, that means writing out the exact ` +
        `statement and checking each condition against it directly, rather than trusting a mental picture that ` +
        `might be quietly wrong.`
      );
    case 'real_world':
      return (
        `Here's where "${label}" actually shows up outside the classroom: it's the same mechanism people lean on ` +
        `constantly in ${subject}-adjacent work, and it's exactly the kind of gap that causes real mistakes in later ` +
        `units if it stays shaky now. This isn't abstract — it's load-bearing.`
      );
    case 'skeptic':
      return (
        `Hold on — the kitchen analogy and the formal definition both sound clean, but what happens at the edge ` +
        `case for "${label}"? If the explanation survives a boundary condition or a degenerate input, it's solid. ` +
        `If it quietly breaks there instead, we are not done yet — say so before the student walks away confident.`
      );
    case 'synthesis':
    default:
      return (
        `Pulling the analogy, the formal definition, the real-world grounding, and the skeptic's edge case ` +
        `together: "${label}" comes down to one clean idea, and it holds up from every angle we just tested it ` +
        `from — intuitive, rigorous, useful, and durable under scrutiny. That's the version worth carrying forward.`
      );
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
  const priorContext = transcript.map((m) => `[${m.agent_persona}]: ${m.message}`).join('\n\n');
  const userPrompt = priorContext
    ? `Concept: "${node.label}" (${node.subject}).\n\nWar Room so far:\n${priorContext}\n\nAdd your perspective — respond to what's already been said, don't repeat it.`
    : `Concept: "${node.label}" (${node.subject}). Open the War Room debate with your perspective on how to explain this to a student who is stuck.`;

  const stream = await ai.models.generateContentStream({
    model: personaCfg.model,
    contents: userPrompt,
    config: {
      systemInstruction: personaCfg.system_prompt,
      temperature: personaCfg.temperature,
      thinkingConfig: { thinkingBudget: 0 },
      maxOutputTokens: 500,
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
