/**
 * Socket.io server + typed emit helpers. `initSocket(httpServer)` is called
 * once from index.ts; every other module imports the emit* helpers from here
 * and can call them safely even before init (they no-op with a warning so
 * seeding/tests never crash on a missing socket server).
 */
import type { Server as HttpServer } from 'node:http';
import { Server } from 'socket.io';
import type {
  AgentName,
  ClientToServerEvents,
  Edge,
  Node,
  ServerToClientEvents,
  Status,
  StatusChangeCause,
} from '@zynth/shared';
import { config, DEMO_STUDENT_ID } from './config';
import { nodesRepo, edgesRepo } from './db/repositories';

type ZynthServer = Server<ClientToServerEvents, ServerToClientEvents>;

let io: ZynthServer | undefined;

export function initSocket(httpServer: HttpServer): ZynthServer {
  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: config.clientOrigin },
  });

  io.on('connection', (socket) => {
    // Send a fresh snapshot to every newly connected client.
    const nodes = nodesRepo.getAll(DEMO_STUDENT_ID);
    const edges = edgesRepo.getAll(DEMO_STUDENT_ID);
    socket.emit('graph:snapshot', { nodes, edges });

    socket.on('graph:request_snapshot', () => {
      const freshNodes = nodesRepo.getAll(DEMO_STUDENT_ID);
      const freshEdges = edgesRepo.getAll(DEMO_STUDENT_ID);
      socket.emit('graph:snapshot', { nodes: freshNodes, edges: freshEdges });
    });
  });

  return io;
}

function guardedIo(): ZynthServer | undefined {
  if (!io) {
    // eslint-disable-next-line no-console
    console.warn('[socket] emit called before initSocket() — skipping (this is fine during seed/tests)');
    return undefined;
  }
  return io;
}

export function emitNodeUpdated(node: Node): void {
  guardedIo()?.emit('node:updated', node);
}

export function emitStatusChanged(node: Node, cause: StatusChangeCause, previousStatus: Status): void {
  guardedIo()?.emit('node:status_changed', { node, cause, previous_status: previousStatus });
}

export function emitEdgeCreated(edge: Edge): void {
  guardedIo()?.emit('edge:created', edge);
}

export function emitAgentThinking(payload: { agent: AgentName; node_id: string; message: string }): void {
  guardedIo()?.emit('agent:thinking', payload);
}

export function emitGraphSnapshot(nodes: Node[], edges: Edge[]): void {
  guardedIo()?.emit('graph:snapshot', { nodes, edges });
}
