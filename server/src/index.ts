import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { config, STUB_MODE, DEMO_STUDENT_ID } from './config';
import { runMigrations, db } from './db/connection';
import { seed } from './db/seed';
import { apiRouter } from './routes';
import { initSocket } from './socket';
import { ensureSeedWorkspace } from './services/workspaceService';

runMigrations();

const nodeCount = (db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number }).count;
if (nodeCount === 0) {
  // eslint-disable-next-line no-console
  console.log('[index] nodes table is empty — auto-seeding demo data...');
  seed();
} else {
  // seed() (which also registers the sample workspace row) only runs on a
  // fresh database. Existing databases from before workspaces existed still
  // need that row backfilled — idempotent, does not touch nodes/edges.
  ensureSeedWorkspace(DEMO_STUDENT_ID, 'Calculus & Physics (sample)', ['Calculus', 'Physics']);
}

const app = express();
app.use(cors({ origin: config.clientOrigin }));
app.use(express.json());
app.use('/api', apiRouter);

const httpServer = http.createServer(app);
initSocket(httpServer);

httpServer.listen(config.port, () => {
  // eslint-disable-next-line no-console
  console.log(`[index] Zynth server listening on http://localhost:${config.port}`);
  // eslint-disable-next-line no-console
  console.log(`[index] Socket.io ready, CORS allowed for ${config.clientOrigin}`);
  // eslint-disable-next-line no-console
  console.log(`[index] STUB_MODE = ${STUB_MODE} (${STUB_MODE ? 'no GEMINI_API_KEY set — agents return deterministic stubs' : 'Gemini calls are live'})`);
});
