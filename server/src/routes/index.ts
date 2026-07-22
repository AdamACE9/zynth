import { Router } from 'express';
import { healthRouter } from './health';
import { graphRouter } from './graph';
import { nodesRouter } from './nodes';
import { quizRouter } from './quiz';
import { agentsRouter } from './agents';

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(graphRouter);
apiRouter.use(nodesRouter);
apiRouter.use(quizRouter);
apiRouter.use(agentsRouter);
