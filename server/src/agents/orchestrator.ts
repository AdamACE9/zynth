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
import { config, STUB_MODE, getActiveStudentId } from '../config';
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

