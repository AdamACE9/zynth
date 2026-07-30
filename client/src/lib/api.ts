import type {
  Edge,
  ExplainMessage,
  IntuitionSpec,
  MistakeRecord,
  Node,
  QuizQuestion,
  QuizSession,
} from '@zynth/shared';
import { mockGraph } from './mockGraph';

/**
 * Where the API lives. Empty in dev + single-origin deploys, so every call
 * stays a relative /api/... path and Vite's proxy handles it. When the frontend
 * is hosted apart from the backend (Vercel + Render), set VITE_API_BASE to the
 * backend origin, e.g. https://zynth-api.onrender.com — no trailing slash.
 */
export const API_BASE: string = (import.meta.env.VITE_API_BASE ?? '').replace(/\/+$/, '');

/** Prefixes an /api path with API_BASE when one is configured. */
export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export interface GraphPayload {
  nodes: Node[];
  edges: Edge[];
}

/**
 * A student's saved graph. Confirmed against server/src/routes/workspaces.ts:
 * POST creates one from real subjects via Gemini (every node red, one call
 * per subject); GET /api/graph always serves whichever workspace is
 * currently active (server/src/config.ts#getActiveStudentId). `is_active` is
 * computed server-side on every response that returns a Workspace; `active`
 * is kept as a defensive fallback key in case that ever changes.
 */
export interface Workspace {
  id: string;
  name: string;
  subjects: string[];
  goal?: string | null;
  is_active?: boolean;
  active?: boolean;
  created_at?: string;
  last_opened_at?: string | null;
}

/** How many concepts Gemini generates per subject: light 5-7, standard 8-14, deep 15-20. */
export type WorkspaceDepth = 'light' | 'standard' | 'deep';

export function isActiveWorkspace(ws: Workspace): boolean {
  return Boolean(ws.is_active ?? ws.active);
}

/** Unwraps either `{ workspace: {...} }` or a bare workspace object. */
function unwrapWorkspace(data: unknown): Workspace | null {
  const ws = (data as { workspace?: Workspace } | Workspace | null)?.hasOwnProperty?.('workspace')
    ? (data as { workspace?: Workspace }).workspace
    : (data as Workspace | null);
  return ws && typeof ws === 'object' && typeof ws.id === 'string' ? ws : null;
}

/**
 * Lists all saved workspaces, newest first (per contract). Throws on failure
 * — callers use this as the source of truth for "does this student have a
 * real graph yet", so a silent empty-array fallback would be actively wrong.
 */
export async function listWorkspaces(): Promise<Workspace[]> {
  const res = await fetch(apiUrl('/api/workspaces'));
  if (!res.ok) {
    throw new Error(`GET /api/workspaces responded ${res.status}`);
  }
  const data: unknown = await res.json();
  const list = Array.isArray(data) ? data : (data as { workspaces?: unknown })?.workspaces;
  if (!Array.isArray(list)) {
    throw new Error('Malformed /api/workspaces response body');
  }
  return list as Workspace[];
}

/** The currently-active workspace, or null if none is active yet. */
export async function getActiveWorkspace(): Promise<Workspace | null> {
  const res = await fetch(apiUrl('/api/workspaces/active'));
  if (res.status === 404) return null;
  if (!res.ok) {
    throw new Error(`GET /api/workspaces/active responded ${res.status}`);
  }
  const data: unknown = await res.json();
  return unwrapWorkspace(data);
}

export interface CreateWorkspacePayload {
  name: string;
  subjects: string[];
  goal?: string;
  /** How many concepts to generate per subject — see onboarding/Onboarding.tsx#levelToDepth
   * for how the student's chosen study level maps onto this. */
  depth?: WorkspaceDepth;
}

/**
 * Creates a brand-new workspace: the backend runs a Gemini call per subject
 * to generate a real graph (every node red) and returns it. This can take a
 * while — callers should show real progress, not a frozen spinner (see
 * onboarding/steps/BuildStep.tsx).
 */
export async function createWorkspace(payload: CreateWorkspacePayload): Promise<Workspace> {
  const res = await fetch(apiUrl('/api/workspaces'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let detail = '';
    try {
      detail = await res.text();
    } catch {
      /* body already consumed or unreadable — the status code alone is still useful */
    }
    throw new Error(`POST /api/workspaces responded ${res.status}${detail ? `: ${detail}` : ''}`);
  }
  const data: unknown = await res.json();
  const ws = unwrapWorkspace(data);
  if (!ws) {
    throw new Error('Malformed /api/workspaces response body');
  }
  return ws;
}

/** Makes one workspace active — subsequent GET /api/graph calls serve its graph. */
export async function activateWorkspace(id: string): Promise<Workspace> {
  const res = await fetch(apiUrl(`/api/workspaces/${encodeURIComponent(id)}/activate`), { method: 'POST' });
  if (!res.ok) {
    throw new Error(`POST /api/workspaces/${id}/activate responded ${res.status}`);
  }
  const data: unknown = await res.json();
  const ws = unwrapWorkspace(data);
  if (!ws) {
    throw new Error('Malformed activate response body');
  }
  return ws;
}

/** Destroys a workspace and everything in it. Irreversible — callers must confirm first. */
export async function deleteWorkspace(id: string): Promise<void> {
  const res = await fetch(apiUrl(`/api/workspaces/${encodeURIComponent(id)}`), { method: 'DELETE' });
  if (!res.ok) {
    throw new Error(`DELETE /api/workspaces/${id} responded ${res.status}`);
  }
}

/** Renames a workspace via PATCH /api/workspaces/:id { name }. */
export async function renameWorkspace(id: string, name: string): Promise<Workspace> {
  const res = await fetch(apiUrl(`/api/workspaces/${encodeURIComponent(id)}`), {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    throw new Error(`PATCH /api/workspaces/${id} responded ${res.status}`);
  }
  const data: unknown = await res.json();
  const ws = unwrapWorkspace(data);
  if (!ws) {
    throw new Error('Malformed rename response body');
  }
  return ws;
}

/**
 * Fetches the live graph from the backend. This function ALWAYS resolves —
 * on any network error, non-2xx status, or malformed body, it logs a console
 * warning and falls back to the local mock graph so the 3D scene never has
 * nothing to render.
 */
export async function fetchGraph(): Promise<GraphPayload> {
  try {
    const res = await fetch(apiUrl('/api/graph'));
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
  const res = await fetch(apiUrl(`/api/nodes/${encodeURIComponent(nodeId)}/engage`), {
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
 * Fetches the Intuition spec for a node — the visual, interactive understanding
 * step. Deliberately a single synchronous request rather than a socket stream:
 * the module this replaced made the student watch five AI personas type, and
 * that waiting was a large part of why it felt like a chore.
 *
 * The server never fails this call on a generation error — it falls back to a
 * deterministic spec — so a rejection here means the network or the node id,
 * not the model.
 */
/**
 * The tutor's opening lesson for a node. Explain is step 2 of the flow, so it
 * teaches before the student asks — scoped by the same objective the quiz is
 * generated from.
 */
export async function fetchExplainLesson(nodeId: string): Promise<{ lesson: string; stubbed: boolean }> {
  const res = await fetch(apiUrl(`/api/nodes/${encodeURIComponent(nodeId)}/explain/lesson`));
  if (!res.ok) throw new Error(`GET /api/nodes/${nodeId}/explain/lesson responded ${res.status}`);
  return (await res.json()) as { lesson: string; stubbed: boolean };
}

export async function fetchIntuition(nodeId: string): Promise<IntuitionSpec> {
  const res = await fetch(apiUrl(`/api/nodes/${encodeURIComponent(nodeId)}/intuition`));
  if (!res.ok) {
    throw new Error(`GET /api/nodes/${nodeId}/intuition responded ${res.status}`);
  }
  const spec = (await res.json()) as IntuitionSpec;
  if (!spec || typeof spec.kind !== 'string' || !spec.predict) {
    throw new Error('Malformed Intuition spec');
  }
  return spec;
}

/**
 * Generates a quiz for one or more nodes. NOTE: the backend endpoint is
 * currently a 501 stub (Day 2 feature work).
 */
export async function generateQuiz(nodeIds: string[]): Promise<{ quiz_id: string; questions: QuizQuestion[] }> {
  const res = await fetch(apiUrl('/api/quiz/generate'), {
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
  const res = await fetch(apiUrl('/api/quiz/submit'), {
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
  const res = await fetch(apiUrl(`/api/nodes/${encodeURIComponent(nodeId)}/explain`), {
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
  const res = await fetch(apiUrl('/api/autopsy'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });
  if (!res.ok) {
    throw new Error(`POST /api/autopsy responded ${res.status}`);
  }
  return (await res.json()) as { mistakes: MistakeRecord[]; clusters: any[]; new_edges: Edge[]; new_nodes: Node[] };
}
