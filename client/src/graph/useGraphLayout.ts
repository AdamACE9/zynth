import { useMemo } from 'react';
// eslint-disable-next-line import/no-unresolved -- ambient module, see types/d3-force-3d.d.ts
import { forceLink, forceManyBody, forceSimulation, forceX, forceY, forceZ } from 'd3-force-3d';
import type { Edge, Node } from '@zynth/shared';

export type PositionMap = Map<string, [number, number, number]>;

export interface GraphLayout {
  /** Final 3D position per node id, after ~200 precomputed simulation ticks. */
  positions: PositionMap;
  /** Fixed anchor point per cluster (subject) — used to place constellation labels. */
  clusterAnchors: PositionMap;
}

interface SimNode {
  id: string;
  cluster: string;
  x: number;
  y: number;
  z: number;
}

interface SimLink {
  source: string;
  target: string;
}

/** Places each cluster's anchor evenly around a circle so constellations stay visually separate. */
function computeClusterAnchors(clusters: string[]): PositionMap {
  const anchors: PositionMap = new Map();
  const radius = Math.max(15, clusters.length * 8);
  clusters.forEach((cluster, i) => {
    const angle = (i / clusters.length) * Math.PI * 2;
    const y = i % 2 === 0 ? 1.5 : -1.5;
    anchors.set(cluster, [Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
  });
  return anchors;
}

function computeLayout(nodes: Node[], edges: Edge[]): GraphLayout {
  const clusters = Array.from(new Set(nodes.map((n) => n.cluster || n.subject))).sort();
  const anchors = computeClusterAnchors(clusters);

  const simNodes: SimNode[] = nodes.map((n) => {
    const cluster = n.cluster || n.subject;
    const anchor = anchors.get(cluster) ?? [0, 0, 0];
    return {
      id: n.id,
      cluster,
      x: anchor[0] + (Math.random() - 0.5) * 6,
      y: anchor[1] + (Math.random() - 0.5) * 6,
      z: anchor[2] + (Math.random() - 0.5) * 6,
    };
  });

  const nodeIds = new Set(simNodes.map((n) => n.id));
  const simLinks: SimLink[] = edges
    .filter((e) => nodeIds.has(e.source_node_id) && nodeIds.has(e.target_node_id))
    .map((e) => ({ source: e.source_node_id, target: e.target_node_id }));

  const simulation = forceSimulation(simNodes, 3)
    .force('charge', forceManyBody().strength(-45))
    .force(
      'link',
      forceLink(simLinks)
        .id((d: SimNode) => d.id)
        .distance(4.5)
        .strength(0.55),
    )
    .force(
      'x',
      forceX((d: SimNode) => anchors.get(d.cluster)?.[0] ?? 0).strength(0.15),
    )
    .force(
      'y',
      forceY((d: SimNode) => anchors.get(d.cluster)?.[1] ?? 0).strength(0.15),
    )
    .force(
      'z',
      forceZ((d: SimNode) => anchors.get(d.cluster)?.[2] ?? 0).strength(0.15),
    )
    .stop();

  const TICKS = 200;
  for (let i = 0; i < TICKS; i++) {
    simulation.tick();
  }

  const positions: PositionMap = new Map();
  simNodes.forEach((n) => positions.set(n.id, [n.x, n.y, n.z]));

  return { positions, clusterAnchors: anchors };
}

/**
 * Computes a 3D force-directed layout, clustered by node.cluster (falling
 * back to node.subject), with a fixed anchor point per cluster so
 * same-subject nodes visibly group into separate constellations.
 *
 * The expensive simulation (~200 ticks) only reruns when the graph's
 * *topology* changes (node ids, cluster membership, edge endpoints) — not on
 * every status/mastery update, which would otherwise re-layout the whole
 * scene every time a node's color changes.
 */
export function useGraphLayout(nodes: Node[], edges: Edge[]): GraphLayout {
  const topologyKey = useMemo(() => {
    const nodeKey = nodes
      .map((n) => `${n.id}:${n.cluster || n.subject}`)
      .sort()
      .join(',');
    const edgeKey = edges
      .map((e) => `${e.id}:${e.source_node_id}-${e.target_node_id}`)
      .sort()
      .join(',');
    return `${nodeKey}||${edgeKey}`;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges]);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => computeLayout(nodes, edges), [topologyKey]);
}
