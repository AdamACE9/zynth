/**
 * Central config loader. Reads server/.env (gitignored) via dotenv and exposes
 * a single typed `config` object. Every other module imports config from here
 * rather than touching process.env directly.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';

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

/**
 * The original single demo student. Kept exported (and still seeded) so
 * nothing breaks — it is now just the FIRST workspace ("Calculus & Physics
 * (sample)"), not necessarily the active one. Prefer getActiveStudentId()
 * everywhere that needs "the student/workspace currently being served."
 */
export const DEMO_STUDENT_ID = 'student_demo';

/**
 * When no Gemini API key is configured, the agent orchestrator returns
 * deterministic, clearly-labelled stub text instead of calling the network.
 * This keeps the whole app demoable (and typecheckable/testable) with zero
 * credentials.
 */
export const STUB_MODE = !config.geminiApiKey;

// ---------------------------------------------------------------------------
// Active workspace (= active student_id).
//
// A "workspace" (server/src/services/workspaceService.ts) is just a
// student_id — every table already scopes by student_id, so switching
// workspaces is just switching which student_id every route reads/writes.
// The active id is persisted here (survives server restarts) in a tiny
// key/value settings table.
//
// IMPORTANT: this file intentionally does NOT import server/src/db/connection.ts.
// connection.ts imports `config` from this module at its own top level to
// resolve the database path, so importing it back from here would create a
// circular ES module dependency (connection.ts's top-level code would run
// while `config` is still mid-initialization here, throwing a TDZ error on
// first boot). Instead this opens its own tiny lazy, independent
// better-sqlite3 connection to the SAME database file, only on first use —
// well after every module has finished loading.
// ---------------------------------------------------------------------------

const ACTIVE_WORKSPACE_KEY = 'active_workspace_id';

let settingsDb: Database.Database | undefined;

function getSettingsDb(): Database.Database {
  if (!settingsDb) {
    const resolvedDbPath = path.isAbsolute(config.databasePath)
      ? config.databasePath
      : path.resolve(SERVER_ROOT, config.databasePath);
    const dbDir = path.dirname(resolvedDbPath);
    if (!fs.existsSync(dbDir)) {
      fs.mkdirSync(dbDir, { recursive: true });
    }
    settingsDb = new Database(resolvedDbPath);
    settingsDb.pragma('journal_mode = WAL');
    settingsDb.exec(
      `CREATE TABLE IF NOT EXISTS app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`,
    );
  }
  return settingsDb;
}

let cachedActiveStudentId: string | undefined;

/** Returns the currently active workspace's student_id, defaulting to DEMO_STUDENT_ID. */
export function getActiveStudentId(): string {
  if (cachedActiveStudentId) return cachedActiveStudentId;
  const row = getSettingsDb()
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(ACTIVE_WORKSPACE_KEY) as { value: string } | undefined;
  cachedActiveStudentId = row?.value || DEMO_STUDENT_ID;
  return cachedActiveStudentId;
}

/** Switches the active workspace and persists the choice so it survives a restart. */
export function setActiveStudentId(id: string): void {
  getSettingsDb()
    .prepare(
      `INSERT INTO app_settings (key, value) VALUES ('${ACTIVE_WORKSPACE_KEY}', @id)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    )
    .run({ id });
  cachedActiveStudentId = id;
}
