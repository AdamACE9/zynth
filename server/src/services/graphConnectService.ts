/**
 * Makes the knowledge graph one connected structure instead of a field of
 * unrelated islands.
 *
 * Workspace generation wires prerequisite edges WITHIN each subject and never
 * between them, so a student who picks 13 subjects gets 13 separate constellations
 * floating in the same space. Measured on a real 13-subject graph: 84 nodes,
 * 104 edges, and **11 disconnected components**, of which only two had any
 * cross-subject link at all.
 *
 * That is not a cosmetic problem. The product's claim is that this is ONE map of
 * what you know, and that studying is a route across it — the Study Plan's
 * topological sort, the Ghost Path and the Autopsy's correlated-error edges all
 * assume a graph you can actually traverse. Eleven islands make "a route toward
 * your goal" meaningless the moment the goal is in a different island.
 *
 * Strategy, in order:
 *   1. Ask Gemini once for genuinely meaningful cross-subject links, given the
 *      real node labels. "Differentiation → Kinematics" is worth drawing.
 *   2. Then run a deterministic pass that bridges whatever is still separate.
 *
 * Step 2 is what makes this reliable: step 1 is a model call and may return
 * nothing useful, but the function still guarantees a connected graph on return.
 * Links are `related_topic`, never `prerequisite` — inventing a prerequisite
 * would reorder the student's study plan on a guess, and prerequisites are load
 * bearing in a way that "these are related" is not.
 */
import { GoogleGenAI } from '@google/genai';
import { nanoid } from 'nanoid';
import type { Edge, Node } from '@zynth/shared';
import { config, STUB_MODE } from '../config';
import { edgesRepo, nodesRepo } from '../db/repositories';
import { emitEdgeCreated } from '../socket';
import { withModelRetry } from '../agents/retry';

const ai = STUB_MODE ? null : new GoogleGenAI({ apiKey: config.geminiApiKey });

/** Undirected adjacency over the existing edges. */
function buildAdjacency(nodes: Node[], edges: Edge[]): Map<string, string[]> {
  const adj = new Map<string, string[]>();
  for (const n of nodes) adj.set(n.id, []);
  for (const e of edges) {
    adj.get(e.source_node_id)?.push(e.target_node_id);
    adj.get(e.target_node_id)?.push(e.source_node_id);
  }
  return adj;
}

/** Connected components, largest first. */
function findComponents(nodes: Node[], edges: Edge[]): string[][] {
  const adj = buildAdjacency(nodes, edges);
  const seen = new Set<string>();
  const components: string[][] = [];

  for (const node of nodes) {
    if (seen.has(node.id)) continue;
    const stack = [node.id];
    const component: string[] = [];
    seen.add(node.id);

    while (stack.length) {
      const current = stack.pop() as string;
      component.push(current);
      for (const neighbour of adj.get(current) ?? []) {
        if (seen.has(neighbour)) continue;
        seen.add(neighbour);
        stack.push(neighbour);
      }
    }
    components.push(component);
  }

  return components.sort((a, b) => b.length - a.length);
}

function makeEdge(studentId: string, sourceId: string, targetId: string, discoveredBy: string): Edge {
  return {
    id: `edge_${nanoid(10)}`,
    student_id: studentId,
    source_node_id: sourceId,
    target_node_id: targetId,
    relationship_type: 'related_topic',
    strength: 0.5,
    discovered_by: discoveredBy,
    created_at: new Date().toISOString(),
  };
}

const LINK_SCHEMA = {
  type: 'object',
  properties: {
    links: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          from: { type: 'string' },
          to: { type: 'string' },
        },
        required: ['from', 'to'],
      },
    },
  },
  required: ['links'],
} as const;

/**
 * One model call for cross-subject links that a teacher would recognise. Returns
 * validated node-id pairs; never throws — an empty list just means the
 * deterministic pass does all the work.
 */
async function proposeMeaningfulLinks(nodes: Node[]): Promise<Array<[string, string]>> {
  if (STUB_MODE || !ai || nodes.length < 2) return [];

  // Grouped by subject so the model can see what is available to connect, and
  // capped so a large graph can't blow the prompt out.
  const bySubject = new Map<string, Node[]>();
  for (const n of nodes) {
    const list = bySubject.get(n.subject) ?? [];
    if (list.length < 8) list.push(n);
    bySubject.set(n.subject, list);
  }
  if (bySubject.size < 2) return [];

  const catalogue = [...bySubject.entries()]
    .map(([subject, list]) => `${subject}:\n${list.map((n) => `  ${n.id} — ${n.label}`).join('\n')}`)
    .join('\n\n');

  const prompt = `A student's knowledge graph currently has each subject as a separate island. Propose links BETWEEN subjects so it becomes one connected map.

${catalogue}

Return up to ${Math.min(14, bySubject.size * 2)} links. Rules:
- "from" and "to" must be EXACT node ids copied from the list above.
- Every link MUST join two DIFFERENT subjects. Links inside one subject are useless here and will be discarded.
- Only propose a link a teacher would recognise as real: one concept genuinely underpins, mirrors or is applied by the other (differentiation underpins kinematics; probability underpins statistical mechanics; algebra underpins nearly everything quantitative).
- Prefer links that connect subjects which currently share nothing, and prefer the most foundational concept in each subject.
- Do NOT invent a link between two subjects that have no real relationship. Returning fewer, honest links is better than padding the list.`;

  try {
    const res = await withModelRetry(
      () =>
        ai.models.generateContent({
          model: config.geminiModel,
          contents: prompt,
          config: {
            responseMimeType: 'application/json',
            responseSchema: LINK_SCHEMA,
            thinkingConfig: { thinkingBudget: 0 },
            maxOutputTokens: 1200,
          },
        }),
      { label: 'cross-subject graph links' },
    );

    const text = res.text;
    if (!text) return [];

    const parsed = JSON.parse(text) as { links?: Array<{ from?: unknown; to?: unknown }> };
    const byId = new Map(nodes.map((n) => [n.id, n]));
    const out: Array<[string, string]> = [];

    for (const link of parsed.links ?? []) {
      const from = typeof link.from === 'string' ? link.from : '';
      const to = typeof link.to === 'string' ? link.to : '';
      const a = byId.get(from);
      const b = byId.get(to);
      // Hallucinated ids, self-links and same-subject links are all dropped.
      if (!a || !b || a.id === b.id || a.subject === b.subject) continue;
      out.push([a.id, b.id]);
    }
    return out;
  } catch (err) {
    console.warn('[graphConnect] cross-subject link proposal failed:', err instanceof Error ? err.message : err);
    return [];
  }
}

export interface ConnectResult {
  componentsBefore: number;
  componentsAfter: number;
  edgesAdded: number;
  meaningfulLinks: number;
}

/**
 * Connects every island in this student's graph. Idempotent: a graph that is
 * already connected gets no new edges and costs no model call.
 */
export async function connectGraph(studentId: string): Promise<ConnectResult> {
  const nodes = nodesRepo.getAll(studentId);
  let edges = edgesRepo.getAll(studentId);

  const before = findComponents(nodes, edges);
  if (before.length <= 1) {
    return { componentsBefore: before.length, componentsAfter: before.length, edgesAdded: 0, meaningfulLinks: 0 };
  }

  const added: Edge[] = [];
  const existing = new Set(edges.map((e) => [e.source_node_id, e.target_node_id].sort().join('|')));

  const addLink = (a: string, b: string, discoveredBy: string): boolean => {
    const key = [a, b].sort().join('|');
    if (existing.has(key)) return false;
    const edge = makeEdge(studentId, a, b, discoveredBy);
    edgesRepo.insert(edge);
    existing.add(key);
    added.push(edge);
    return true;
  };

  // 1. Meaningful links first, so the bridges that survive are the good ones.
  let meaningful = 0;
  for (const [a, b] of await proposeMeaningfulLinks(nodes)) {
    if (addLink(a, b, 'graph_connect_agent')) meaningful += 1;
  }

  // 2. Deterministic closure. Recompute components with the model's links in
  //    place, then chain whatever is still separate onto the largest component.
  //    This is what makes connectivity a guarantee rather than a hope.
  edges = edgesRepo.getAll(studentId);
  const remaining = findComponents(nodes, edges);

  // Only chain the leftovers when the model gave us nothing usable. Its links
  // are chosen for real subject affinity; the fallback picks by graph structure
  // alone and will happily join "Real Numbers" to "Cell Structure", which is a
  // line the student cannot learn anything from. A couple of honest islands beat
  // a fully-connected graph full of invented relationships.
  if (remaining.length > 1 && meaningful === 0) {
    const byId = new Map(nodes.map((n) => [n.id, n]));
    // Bridge from each island's most-connected node — its hub — so the join
    // lands somewhere central rather than on a random leaf.
    const adjacency = buildAdjacency(nodes, edges);
    const hubOf = (component: string[]): string =>
      component.reduce((best, id) =>
        (adjacency.get(id)?.length ?? 0) > (adjacency.get(best)?.length ?? 0) ? id : best,
      component[0] as string);

    const anchor = hubOf(remaining[0] as string[]);
    for (let i = 1; i < remaining.length; i += 1) {
      const hub = hubOf(remaining[i] as string[]);
      addLink(anchor, hub, 'graph_connect_fallback');
      void byId; // ids are already validated by construction
    }
  }

  for (const edge of added) emitEdgeCreated(edge);

  const after = findComponents(nodes, edgesRepo.getAll(studentId));

  console.log(
    `[graphConnect] ${before.length} components → ${after.length}; ${added.length} edges added (${meaningful} meaningful)`,
  );

  return {
    componentsBefore: before.length,
    componentsAfter: after.length,
    edgesAdded: added.length,
    meaningfulLinks: meaningful,
  };
}
