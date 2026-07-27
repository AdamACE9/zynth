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

/**
 * Migrate IMMEDIATELY, as a side effect of opening the connection — before any
 * other module can touch the database.
 *
 * index.ts imports `./routes` (line 7) before it calls runMigrations() (line 10),
 * and ES module imports resolve first. So every service's module-load code —
 * `db.exec('CREATE TABLE ...')`, `db.prepare(...)`, a first-run seed — executed
 * against a schema-less database. That was invisible in development, where the
 * db file already had its tables from a previous run, and fatal on a fresh
 * deploy: the first boot on Render died with
 * `SqliteError: no such table: nodes` and crash-looped.
 *
 * Anchoring migration to the connection itself makes the ordering impossible to
 * get wrong; the explicit runMigrations() call in index.ts is now a harmless
 * no-op kept for clarity.
 */
runMigrations();
