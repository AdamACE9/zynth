import { Router } from 'express';
import { healthRouter } from './health';
import { graphRouter } from './graph';
import { nodesRouter } from './nodes';
import { quizRouter } from './quiz';
import { agentsRouter } from './agents';
import { explainRouter } from './explain';
import { autopsyRouter } from './autopsy';
import { copilotRouter } from './copilot';
import { planRouter } from './plan';
import { examRouter } from './exam';

export const apiRouter = Router();

apiRouter.use(healthRouter);
apiRouter.use(graphRouter);
apiRouter.use(nodesRouter);
apiRouter.use(quizRouter);
apiRouter.use(agentsRouter);
apiRouter.use(explainRouter);
apiRouter.use(autopsyRouter);
apiRouter.use(copilotRouter);
apiRouter.use(planRouter);
apiRouter.use(examRouter);
