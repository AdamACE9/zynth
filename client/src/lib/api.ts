import type { Edge, ExplainMessage, MistakeRecord, Node, QuizQuestion, QuizSession } from '@zynth/shared';
import { mockGraph } from './mockGraph';

export interface GraphPayload {
  nodes: Node[];
  edges: Edge[];
}

/**
 * Fetches the live graph from the backend. This function ALWAYS resolves —
 * on any network error, non-2xx status, or malformed body, it logs a console
 * warning and falls back to the local mock graph so the 3D scene never has
 * nothing to render.
 */
export async function fetchGraph(): Promise<GraphPayload> {
  try {
    const res = await fetch('/api/graph');
    if (!res.ok) {
      throw new Error(`GET /api/graph responded ${res.status}`);
    }
    const data: unknown = await res.json();
    if (
      !data ||
      typeof data !== 'object' ||
      !Array.isArray((data as GraphPayload).nodes) ||
      !Array.isArray((data as GraphPayload).edges)
    ) {
      throw new Error('Malformed /api/graph response body');
    }
    return data as GraphPayload;
  } catch (err) {
    console.warn('[Zynth] /api/graph unreachable — falling back to mock graph.', err);
    return mockGraph;
  }
}

/**
 * POSTs the "engage" trigger for a node (red -> amber, per the Node.status
 * state machine in @zynth/shared). Throws on failure — callers are expected
 * to fall back to a local optimistic flip for demo purposes when the
 * backend isn't running (see ui/NodePanel.tsx).
 */
export async function engageNode(nodeId: string): Promise<Node> {
  const res = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/engage`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`POST /api/nodes/${nodeId}/engage responded ${res.status}`);
  }
  const data: unknown = await res.json();
  const node = (data as { node?: Node })?.node ?? (data as Node);
  if (!node || typeof node.id !== 'string') {
    throw new Error('Malformed engage response body');
  }
  return node;
}

/**
 * Kicks off a streaming War Room debate for a node. The transcript itself
 * arrives via the 'warroom:turn' / 'warroom:resolved' socket events (see
 * lib/socket.ts#getSocket) — this call just starts the session and hands
 * back its id so the caller can correlate incoming socket events.
 * NOTE: the backend endpoint is currently a 501 stub (Day 2 feature work).
 */
export async function startWarRoomStream(nodeId: string): Promise<{ session_id: string }> {
  const res = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/war-room/stream`, {
    method: 'POST',
  });
  if (!res.ok) {
    throw new Error(`POST /api/nodes/${nodeId}/war-room/stream responded ${res.status}`);
  }
  return (await res.json()) as { session_id: string };
}

/**
 * Generates a quiz for one or more nodes. NOTE: the backend endpoint is
 * currently a 501 stub (Day 2 feature work).
 */
export async function generateQuiz(nodeIds: string[]): Promise<{ quiz_id: string; questions: QuizQuestion[] }> {
  const res = await fetch('/api/quiz/generate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ node_ids: nodeIds }),
  });
  if (!res.ok) {
    throw new Error(`POST /api/quiz/generate responded ${res.status}`);
  }
  return (await res.json()) as { quiz_id: string; questions: QuizQuestion[] };
}

/**
 * Submits a completed quiz attempt (questions carrying `given_answer`) for
 * grading. This is the real amber->green trigger path. NOTE: the backend
 * endpoint is currently a 501 stub (Day 2 feature work).
 */
export async function submitQuiz(payload: {
  node_ids: string[];
  questions: QuizQuestion[];
}): Promise<{ session: QuizSession; updated: Node[]; per_question: { id: string; is_correct: boolean }[] }> {
  const res = await fetch('/api/quiz/submit', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`POST /api/quiz/submit responded ${res.status}`);
  }
  return (await res.json()) as {
    session: QuizSession;
    updated: Node[];
    per_question: { id: string; is_correct: boolean }[];
  };
}

/**
 * Sends one message in the context-aware Explain tutor chat for a node.
 * Pass `sessionId` to continue an existing session; omit it to start a new
 * one. NOTE: the backend endpoint is currently a 501 stub (Day 2 feature work).
 */
export async function sendExplainMessage(
  nodeId: string,
  message: string,
  sessionId?: string,
): Promise<{ session_id: string; messages: ExplainMessage[]; tutor_reply: string }> {
  const res = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/explain`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message, session_id: sessionId }),
  });
  if (!res.ok) {
    throw new Error(`POST /api/nodes/${nodeId}/explain responded ${res.status}`);
  }
  return (await res.json()) as { session_id: string; messages: ExplainMessage[]; tutor_reply: string };
}

/**
 * Runs the Autopsy Board over raw pasted/extracted homework or test text —
 * classifies mistakes onto nodes, clusters recurring patterns, and proposes
 * new correlated_error edges (+ any newly-discovered nodes). NOTE: the
 * backend endpoint is currently a 501 stub (Day 2 feature work).
 */
export async function runAutopsy(
  text: string,
): Promise<{ mistakes: MistakeRecord[]; clusters: any[]; new_edges: Edge[]; new_nodes: Node[] }> {
  const res = await fetch('/api/autopsy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`POST /api/autopsy responded ${res.status}`);
  }
  return (await res.json()) as { mistakes: MistakeRecord[]; clusters: any[]; new_edges: Edge[]; new_nodes: Node[] };
}
