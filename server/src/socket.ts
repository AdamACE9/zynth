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
  CopilotHeatCell,
  CopilotInsight,
  Edge,
  GhostPath,
  Node,
  ServerToClientEvents,
  Status,
  StatusChangeCause,
  WarRoomOutcome,
  WarRoomPersona,
} from '@zynth/shared';
import { config, getActiveStudentId } from './config';
import { nodesRepo, edgesRepo } from './db/repositories';

type ZynthServer = Server<ClientToServerEvents, ServerToClientEvents>;

let io: ZynthServer | undefined;

export function initSocket(httpServer: HttpServer): ZynthServer {
  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer, {
    cors: { origin: config.clientOrigin },
  });

  io.on('connection', (socket) => {
    // Send a fresh snapshot of the ACTIVE workspace to every newly connected client.
    const nodes = nodesRepo.getAll(getActiveStudentId());
    const edges = edgesRepo.getAll(getActiveStudentId());
    socket.emit('graph:snapshot', { nodes, edges });

    socket.on('graph:request_snapshot', () => {
      const freshNodes = nodesRepo.getAll(getActiveStudentId());
      const freshEdges = edgesRepo.getAll(getActiveStudentId());
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

export function emitNodeCreated(node: Node): void {
  guardedIo()?.emit('node:created', node);
}

export function emitWarRoomTurn(payload: {
  session_id: string;
  node_id: string;
  persona: WarRoomPersona;
  phase: 'start' | 'token' | 'done';
  text: string;
}): void {
  guardedIo()?.emit('warroom:turn', payload);
}

export function emitWarRoomResolved(payload: {
  session_id: string;
  node_id: string;
  outcome: WarRoomOutcome;
  node: Node;
}): void {
  guardedIo()?.emit('warroom:resolved', payload);
}

export function emitAutopsyProgress(payload: { message: string }): void {
  guardedIo()?.emit('autopsy:progress', payload);
}

// -- Day 3: Live Co-Pilot, Study Plan, Exam Simulator ------------------------

/** Live mastery heatmap during a quiz. Always emitted, never suppressed. */
export function emitCopilotHeatmap(payload: { session_id: string; cells: CopilotHeatCell[] }): void {
  guardedIo()?.emit('copilot:heatmap', payload);
}

/** An unprompted diagnosis. Emitting this INTERRUPTS the student — fire rarely. */
export function emitCopilotInsight(payload: CopilotInsight): void {
  guardedIo()?.emit('copilot:insight', payload);
}

/** The study plan silently rerouted itself because mastery changed. */
export function emitPlanUpdated(payload: { ghost: GhostPath; because: string }): void {
  guardedIo()?.emit('plan:updated', payload);
}

/** Exam Simulator showing its own reasoning as it works. */
export function emitExamReasoning(payload: {
  session_id: string;
  question_id: string;
  index: number;
  total: number;
  phase: 'thinking' | 'token' | 'graded';
  text: string;
  is_correct?: boolean;
}): void {
  guardedIo()?.emit('exam:reasoning', payload);
}
