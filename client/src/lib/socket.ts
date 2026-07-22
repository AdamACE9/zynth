import { useCallback, useEffect, useRef, useState } from 'react';
import { io, type Socket } from 'socket.io-client';
import type { ClientToServerEvents, Edge, Node, ServerToClientEvents } from '@zynth/shared';

let socket: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

/** Lazily-created singleton — default path/origin, proxied to :3001 in dev (vite.config.ts). */
export function getSocket(): Socket<ServerToClientEvents, ClientToServerEvents> {
  if (!socket) {
    socket = io({
      path: '/socket.io',
      autoConnect: true,
      reconnection: true,
      reconnectionDelay: 1000,
      timeout: 4000,
    });
  }
  return socket;
}

export interface LiveGraph {
  nodes: Node[];
  edges: Edge[];
  /** True while the socket has an active connection to the backend. */
  connected: boolean;
  /** Shallow-merge a patch into one node — used for local/optimistic updates. */
  patchNode: (nodeId: string, patch: Partial<Node>) => void;
  /** Replace one node wholesale — used when the server hands back a full Node. */
  replaceNode: (node: Node) => void;
}

/**
 * Holds the live graph in React state, seeded once from `initial` (typically
 * the result of lib/api.ts#fetchGraph), then kept in sync via Socket.io:
 *   - node:updated          -> replace that node
 *   - node:status_changed   -> replace that node (payload.node is the full node)
 *   - edge:created          -> append if not already present
 *   - graph:snapshot        -> replace the whole graph
 *
 * If the socket never connects, `nodes`/`edges` simply stay on whatever was
 * seeded — no crash, no dangling promise.
 */
export function useLiveGraph(initial: GraphPayloadLike | null): LiveGraph {
  const [nodes, setNodes] = useState<Node[]>([]);
  const [edges, setEdges] = useState<Edge[]>([]);
  const [connected, setConnected] = useState(false);
  const seededRef = useRef(false);

  useEffect(() => {
    if (initial && !seededRef.current) {
      setNodes(initial.nodes);
      setEdges(initial.edges);
      seededRef.current = true;
    }
  }, [initial]);

  useEffect(() => {
    const s = getSocket();

    const handleConnect = () => setConnected(true);
    const handleDisconnect = () => setConnected(false);

    const handleNodeUpdated: ServerToClientEvents['node:updated'] = (node) => {
      setNodes((prev) => prev.map((n) => (n.id === node.id ? node : n)));
    };

    const handleStatusChanged: ServerToClientEvents['node:status_changed'] = (payload) => {
      setNodes((prev) => prev.map((n) => (n.id === payload.node.id ? payload.node : n)));
    };

    const handleEdgeCreated: ServerToClientEvents['edge:created'] = (edge) => {
      setEdges((prev) => (prev.some((e) => e.id === edge.id) ? prev : [...prev, edge]));
    };

    const handleSnapshot: ServerToClientEvents['graph:snapshot'] = (payload) => {
      setNodes(payload.nodes);
      setEdges(payload.edges);
      seededRef.current = true;
    };

    s.on('connect', handleConnect);
    s.on('disconnect', handleDisconnect);
    s.on('node:updated', handleNodeUpdated);
    s.on('node:status_changed', handleStatusChanged);
    s.on('edge:created', handleEdgeCreated);
    s.on('graph:snapshot', handleSnapshot);

    return () => {
      s.off('connect', handleConnect);
      s.off('disconnect', handleDisconnect);
      s.off('node:updated', handleNodeUpdated);
      s.off('node:status_changed', handleStatusChanged);
      s.off('edge:created', handleEdgeCreated);
      s.off('graph:snapshot', handleSnapshot);
    };
  }, []);

  const patchNode = useCallback((nodeId: string, patch: Partial<Node>) => {
    setNodes((prev) => prev.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)));
  }, []);

  const replaceNode = useCallback((node: Node) => {
    setNodes((prev) => prev.map((n) => (n.id === node.id ? node : n)));
  }, []);

  return { nodes, edges, connected, patchNode, replaceNode };
}

interface GraphPayloadLike {
  nodes: Node[];
  edges: Edge[];
}
