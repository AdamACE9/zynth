/**
 * The agent router/mechanism. runAgent() is the single choke point for every
 * Gemini call in the app — it looks up a persona's system prompt, calls the
 * model, and gracefully degrades to a deterministic stub if there's no API
 * key (STUB_MODE) or the call fails for any reason (bad key, quota, network).
 * The app must never hard-crash because of the LLM provider.
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import type { AgentName, WarRoomMessage, WarRoomPersona, WarRoomSession } from '@zynth/shared';
import { config, STUB_MODE, DEMO_STUDENT_ID } from '../config';
import { AGENT_CONFIGS } from './personas';
import { nodesRepo, warRoomSessionsRepo } from '../db/repositories';
import { emitAgentThinking } from '../socket';
import { engageNode } from '../services/statusService';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

function findPersona(name: AgentName) {
  const persona = AGENT_CONFIGS.find((c) => c.name === name);
  if (!persona) {
    throw new Error(`orchestrator: no AgentConfig registered for "${name}"`);
  }
  return persona;
}

/** Deterministic, clearly-labelled stand-in text used whenever we can't (or won't) call Gemini. */
function stubText(name: AgentName, userPrompt: string): string {
  const topic = userPrompt.length > 80 ? `${userPrompt.slice(0, 77)}...` : userPrompt;
  const flavor: Partial<Record<AgentName, string>> = {
    war_room_analogist: `Think of it like a familiar everyday process that mirrors the mechanics of "${topic}" step for step.`,
    war_room_purist: `Formally: the defining property of "${topic}" holds precisely when its conditions are satisfied — no hand-waving needed.`,
    war_room_real_world: `You'd see "${topic}" show up directly in engineering, science, or everyday decisions that depend on this exact mechanism.`,
    war_room_skeptic: `But what happens at the edge case for "${topic}"? If the explanation survives that, it's solid — if not, back to the drawing board.`,
    war_room_synthesis: `Pulling it together: "${topic}" comes down to one clean idea once you combine the intuition, the rigor, and the edge-case check.`,
    diagnosis: `This mistake traces back to "${topic}" — looks like a concept gap rather than a careless slip.`,
    autopsy: `Pattern detected: several recent mistakes trace back to a shared prerequisite gap near "${topic}".`,
    planner: `Recommended next step toward your goal: work on "${topic}" next, since it unblocks the most downstream nodes.`,
    exam_grader: `Reasoning: your answer diverges from the correct approach to "${topic}" at the step where the key rule is applied.`,
    explain_tutor: `Let's start with what you already know about "${topic}" before we add anything new.`,
  };
  const body = flavor[name] ?? `Stub response for ${name} about "${topic}".`;
  return `[stub:${name}] ${body}`;
}

export interface RunAgentOptions {
  temperature?: number;
}

export async function runAgent(
  name: AgentName,
  userPrompt: string,
  opts?: RunAgentOptions,
): Promise<{ text: string; stubbed: boolean }> {
  const persona = findPersona(name);

  if (STUB_MODE || !ai) {
    return { text: stubText(name, userPrompt), stubbed: true };
  }

  try {
    const res = await ai.models.generateContent({
      model: persona.model,
      contents: userPrompt,
      config: {
        systemInstruction: persona.system_prompt,
        temperature: opts?.temperature ?? persona.temperature,
      },
    });
    const text = res.text;
    if (!text) {
      throw new Error('Gemini returned an empty response');
    }
    return { text, stubbed: false };
  } catch (err) {
    // Never let a bad key / quota / network hiccup crash the app.
    // eslint-disable-next-line no-console
    console.error(`[orchestrator] runAgent(${name}) failed, falling back to stub:`, err);
    return { text: `[stub:${name}:error-fallback] ${stubText(name, userPrompt)}`, stubbed: true };
  }
}

const WAR_ROOM_SEQUENCE: { agent: AgentName; persona: WarRoomPersona }[] = [
  { agent: 'war_room_analogist', persona: 'analogist' },
  { agent: 'war_room_purist', persona: 'purist' },
  { agent: 'war_room_real_world', persona: 'real_world' },
  { agent: 'war_room_skeptic', persona: 'skeptic' },
  { agent: 'war_room_synthesis', persona: 'synthesis' },
];

/**
 * Runs the full War Room debate for a node: analogist → purist → real_world →
 * skeptic → synthesis, each building on the prior transcript. Persists a
 * WarRoomSession and — crucially — calls statusService.engageNode so this is
 * a live demonstration of "agent results write back to Node state" (red → amber).
 */
export async function runWarRoom(nodeId: string): Promise<WarRoomSession> {
  const node = nodesRepo.getById(nodeId);
  if (!node) {
    throw new Error(`runWarRoom: no node with id ${nodeId}`);
  }

  const transcript: WarRoomMessage[] = [];

  for (const step of WAR_ROOM_SEQUENCE) {
    const priorContext = transcript
      .map((m) => `[${m.agent_persona}]: ${m.message}`)
      .join('\n\n');
    const userPrompt = priorContext
      ? `Concept: "${node.label}" (${node.subject}).\n\nWar Room so far:\n${priorContext}\n\nAdd your perspective.`
      : `Concept: "${node.label}" (${node.subject}). Open the War Room debate with your perspective on how to explain this to a student who is stuck.`;

    emitAgentThinking({ agent: step.agent, node_id: nodeId, message: `${step.persona} is thinking...` });

    const { text } = await runAgent(step.agent, userPrompt);

    const message: WarRoomMessage = {
      agent_persona: step.persona,
      message: text,
      at: new Date().toISOString(),
    };
    transcript.push(message);
    emitAgentThinking({ agent: step.agent, node_id: nodeId, message: text });
  }

  const session: WarRoomSession = {
    id: `warroom_${nanoid(10)}`,
    student_id: DEMO_STUDENT_ID,
    node_id: nodeId,
    transcript,
    outcome: null,
    created_at: new Date().toISOString(),
  };
  warRoomSessionsRepo.insert(session);

  // The whole point: War Room engagement is what flips a node red -> amber.
  engageNode(nodeId);

  return session;
}
