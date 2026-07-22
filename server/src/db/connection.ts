/**
 * Opens the single shared better-sqlite3 connection used by the whole server.
 * WAL mode + foreign keys are enabled here (schema.sql also declares them,
 * but PRAGMAs are per-connection so we set them again defensively).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { config, SERVER_ROOT } from '../config';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const resolvedDbPath = path.isAbsolute(config.databasePath)
  ? config.databasePath
  : path.resolve(SERVER_ROOT, config.databasePath);

// Ensure the containing directory (e.g. server/data/) exists before opening.
const dbDir = path.dirname(resolvedDbPath);
if (!fs.existsSync(dbDir)) {
  fs.mkdirSync(dbDir, { recursive: true });
}

export const db: Database.Database = new Database(resolvedDbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

const SCHEMA_PATH = path.resolve(__dirname, 'schema.sql');

/** Runs schema.sql. Idempotent — safe to call on every boot. */
export function runMigrations(): void {
  const schemaSql = fs.readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schemaSql);
}
