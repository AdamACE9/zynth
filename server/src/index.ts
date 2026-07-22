import http from 'node:http';
import express from 'express';
import cors from 'cors';
import { config, STUB_MODE } from './config';
import { runMigrations, db } from './db/connection';
import { seed } from './db/seed';
import { apiRouter } from './routes';
import { initSocket } from './socket';

runMigrations();

const nodeCount = (db.prepare('SELECT COUNT(*) as count FROM nodes').get() as { count: number }).count;
if (nodeCount === 0) {
  // eslint-disable-next-line no-console
  console.log('[index] nodes table is empty — auto-seeding demo data...');
  seed();
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
