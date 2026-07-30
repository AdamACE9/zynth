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

/**
 * Gap between adjacent cluster centres, in world units. A cluster of 6-8 nodes
 * settles at roughly 6 units across, so this leaves a clear lane between
 * neighbours without stranding them.
 */
const CLUSTER_SPACING = 15;

/** Places each cluster's anchor evenly around a circle so constellations stay visually separate. */
function computeClusterAnchors(clusters: string[]): PositionMap {
  const anchors: PositionMap = new Map();

  // Radius is derived from the ARC SPACING we want, not from the cluster count
  // directly. It used to be `clusters.length * 6`, which is radius growing
  // linearly with count — so the gap between neighbours grew linearly too. At 13
  // subjects that put the ring 78 units out with ~38 units of dead space between
  // adjacent clusters, six times wider than a cluster. The camera had to pull
  // right back to frame it, every node shrank to a dot, and orbiting swung you
  // across enormous empty gaps. Solving `circumference = count * spacing` keeps
  // the gap constant instead: 13 subjects now sit at ~31 units, not 78.
  const radius = Math.max(11, (clusters.length * CLUSTER_SPACING) / (Math.PI * 2));

  clusters.forEach((cluster, i) => {
    const angle = (i / clusters.length) * Math.PI * 2;
    // Alternating ±2.5 reads as depth for two or three clusters and as a flat
    // pancake for thirteen. Riding a slow sine around the ring gives the map
    // real vertical structure without any cluster drifting far off-plane.
    const y = Math.sin((i / Math.max(1, clusters.length)) * Math.PI * 4) * 4.5;
    anchors.set(cluster, [Math.cos(angle) * radius, y, Math.sin(angle) * radius]);
  });
  return anchors;
}

/**
 * Orders clusters around the ring so that subjects which are actually LINKED end
 * up next to each other.
 *
 * Previously this was `.sort()` — alphabetical, i.e. arbitrary. Calculus and
 * Physics landed on opposite sides of the ring, so the cross-subject edge
 * joining them drew as a long straight line straight through the middle of the
 * map, over the top of every other cluster. With a dozen such links the centre
 * became a cat's cradle and the whole thing read as noise.
 *
 * Greedy nearest-neighbour: start from the most-connected cluster, then repeatedly
 * append whichever unplaced cluster shares the most edges with the one just
 * placed. Not optimal — optimal is a Hamiltonian path problem — but it reliably
 * puts Calculus beside Physics and Geometry beside Trigonometry, which is all
 * this needs to do. Ties break alphabetically so the layout stays deterministic
 * across reloads.
 */
function orderClustersByAffinity(clusters: string[], nodes: Node[], edges: Edge[]): string[] {
  if (clusters.length < 3) return [...clusters].sort();

  const clusterOf = new Map(nodes.map((n) => [n.id, n.cluster || n.subject]));
  const affinity = new Map<string, Map<string, number>>();
  for (const c of clusters) affinity.set(c, new Map());

  for (const edge of edges) {
    const a = clusterOf.get(edge.source_node_id);
    const b = clusterOf.get(edge.target_node_id);
    if (!a || !b || a === b) continue;
    affinity.get(a)?.set(b, (affinity.get(a)?.get(b) ?? 0) + 1);
    affinity.get(b)?.set(a, (affinity.get(b)?.get(a) ?? 0) + 1);
  }

  const degree = (c: string) => [...(affinity.get(c)?.values() ?? [])].reduce((s, v) => s + v, 0);

  const remaining = new Set([...clusters].sort());
  let current = [...remaining].reduce((best, c) => (degree(c) > degree(best) ? c : best), [...remaining][0] as string);

  const ordered: string[] = [];
  while (remaining.size) {
    ordered.push(current);
    remaining.delete(current);
    if (!remaining.size) break;

    let next: string | null = null;
    let bestScore = -1;
    for (const candidate of remaining) {
      const score = affinity.get(current)?.get(candidate) ?? 0;
      if (score > bestScore) {
        bestScore = score;
        next = candidate;
      }
    }
    // No shared edge with anything left — fall back to the next alphabetically
    // so disconnected subjects still land somewhere stable.
    current = next ?? ([...remaining][0] as string);
  }

  return ordered;
}

function computeLayout(nodes: Node[], edges: Edge[]): GraphLayout {
  const clusterNames = Array.from(new Set(nodes.map((n) => n.cluster || n.subject)));
  const clusters = orderClustersByAffinity(clusterNames, nodes, edges);
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
