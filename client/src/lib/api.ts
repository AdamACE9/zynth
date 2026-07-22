import type { Edge, Node } from '@zynth/shared';
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
