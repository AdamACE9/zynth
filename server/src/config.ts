/**
 * Central config loader. Reads server/.env (gitignored) via dotenv and exposes
 * a single typed `config` object. Every other module imports config from here
 * rather than touching process.env directly.
 */
import 'dotenv/config';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// server/ root (this file lives at server/src/config.ts)
export const SERVER_ROOT = path.resolve(__dirname, '..');

export interface Config {
  port: number;
  geminiApiKey: string;
  geminiModel: string;
  // Groq is an Adam-approved second runtime provider, scoped ONLY to grading
  // free-response quiz answers (server/src/agents/groqGrader.ts). It does NOT
  // relax the single-provider constraint for any other agent call.
  groqApiKey: string;
  groqModel: string;
  clientOrigin: string;
  databasePath: string;
}

export const config: Config = {
  port: Number(process.env.PORT) || 3001,
  geminiApiKey: process.env.GEMINI_API_KEY ?? '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  groqModel: process.env.GROQ_MODEL || 'llama-3.3-70b-versatile',
  clientOrigin: process.env.CLIENT_ORIGIN || 'http://localhost:5173',
  databasePath: process.env.DATABASE_PATH || './data/zynth.sqlite',
};

/** The single demo student every seeded / served record belongs to for the hackathon. */
export const DEMO_STUDENT_ID = 'student_demo';

/**
 * When no Gemini API key is configured, the agent orchestrator returns
 * deterministic, clearly-labelled stub text instead of calling the network.
 * This keeps the whole app demoable (and typecheckable/testable) with zero
 * credentials.
 */
export const STUB_MODE = !config.geminiApiKey;
