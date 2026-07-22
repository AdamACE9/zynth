/**
 * Fallback knowledge graph, used whenever the backend isn't reachable
 * (see lib/api.ts). Mirrors the shape of the backend seed data: a Calculus
 * cluster and a Physics cluster, a mix of red/amber/green statuses, and one
 * cross-subject edge (Derivatives <-> Kinematics) to demonstrate that edges
 * aren't confined to a single constellation.
 *
 * x/y/z are always null here — 3D layout is computed at runtime by
 * graph/useGraphLayout.ts, never persisted in mock or seed data.
 */
import type { Edge, Node, RelationshipType, Status } from '@zynth/shared';

const STUDENT_ID = 'demo-student';

function iso(daysAgo: number): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
}

interface NodeSeed {
  id: string;
  label: string;
  subject: string;
  status: Status;
  masteryScore: number;
  retestCount?: number;
  engagedDaysAgo?: number;
  quizPassedDaysAgo?: number;
}

function makeNode(seed: NodeSeed): Node {
  const engagedAt = seed.status !== 'red' ? iso(seed.engagedDaysAgo ?? 10) : null;
  const quizPassedAt = seed.status === 'green' ? iso(seed.quizPassedDaysAgo ?? 4) : null;

  const history: Node['history'] = [{ timestamp: iso(20), status: 'red', cause: 'seed' }];
  if (engagedAt) history.push({ timestamp: engagedAt, status: 'amber', cause: 'engage' });
  if (quizPassedAt) history.push({ timestamp: quizPassedAt, status: 'green', cause: 'quiz_passed' });

  return {
    id: seed.id,
    student_id: STUDENT_ID,
    label: seed.label,
    subject: seed.subject,
    cluster: seed.subject,
    status: seed.status,
    mastery_score: seed.masteryScore,
    engaged_at: engagedAt,
    last_quiz_passed_at: quizPassedAt,
    last_quiz_result:
      seed.status === 'green'
        ? { passed: true, score: seed.masteryScore, at: quizPassedAt ?? iso(4) }
        : null,
    retest_count: seed.retestCount ?? 0,
    history,
    x: null,
    y: null,
    z: null,
    created_at: iso(20),
    updated_at: iso(0),
  };
}

const CALC_NODES: NodeSeed[] = [
  { id: 'calc-limits', label: 'Limits', subject: 'Calculus', status: 'green', masteryScore: 92, retestCount: 2 },
  { id: 'calc-continuity', label: 'Continuity', subject: 'Calculus', status: 'green', masteryScore: 88, retestCount: 1 },
  { id: 'calc-derivatives', label: 'Derivatives', subject: 'Calculus', status: 'green', masteryScore: 90, retestCount: 3 },
  { id: 'calc-power-rule', label: 'Power Rule', subject: 'Calculus', status: 'green', masteryScore: 95 },
  { id: 'calc-chain-rule', label: 'Chain Rule', subject: 'Calculus', status: 'amber', masteryScore: 55, engagedDaysAgo: 3 },
  {
    id: 'calc-product-quotient-rule',
    label: 'Product & Quotient Rule',
    subject: 'Calculus',
    status: 'amber',
    masteryScore: 48,
    engagedDaysAgo: 2,
  },
  {
    id: 'calc-implicit-differentiation',
    label: 'Implicit Differentiation',
    subject: 'Calculus',
    status: 'red',
    masteryScore: 10,
  },
  { id: 'calc-related-rates', label: 'Related Rates', subject: 'Calculus', status: 'red', masteryScore: 8 },
  { id: 'calc-optimization', label: 'Optimization', subject: 'Calculus', status: 'amber', masteryScore: 52, engagedDaysAgo: 1 },
  { id: 'calc-definite-integrals', label: 'Definite Integrals', subject: 'Calculus', status: 'red', masteryScore: 14 },
  {
    id: 'calc-fundamental-theorem',
    label: 'Fundamental Theorem of Calculus',
    subject: 'Calculus',
    status: 'red',
    masteryScore: 6,
  },
];

const PHYSICS_NODES: NodeSeed[] = [
  { id: 'phys-kinematics', label: 'Kinematics', subject: 'Physics', status: 'green', masteryScore: 89, retestCount: 2 },
  { id: 'phys-newtons-laws', label: "Newton's Laws", subject: 'Physics', status: 'amber', masteryScore: 58, engagedDaysAgo: 4 },
  { id: 'phys-forces', label: 'Forces', subject: 'Physics', status: 'amber', masteryScore: 46, engagedDaysAgo: 2 },
  { id: 'phys-work-energy', label: 'Work & Energy', subject: 'Physics', status: 'red', masteryScore: 15 },
  { id: 'phys-momentum', label: 'Momentum', subject: 'Physics', status: 'red', masteryScore: 9 },
  { id: 'phys-circular-motion', label: 'Circular Motion', subject: 'Physics', status: 'red', masteryScore: 11 },
  { id: 'phys-shm', label: 'Simple Harmonic Motion', subject: 'Physics', status: 'red', masteryScore: 5 },
];

export const mockNodes: Node[] = [...CALC_NODES, ...PHYSICS_NODES].map(makeNode);

interface EdgeSeed {
  id: string;
  source: string;
  target: string;
  type: RelationshipType;
  strength: number;
  discoveredBy?: string;
}

const EDGE_SEEDS: EdgeSeed[] = [
  { id: 'e-calc-1', source: 'calc-limits', target: 'calc-continuity', type: 'prerequisite', strength: 0.95 },
  { id: 'e-calc-2', source: 'calc-continuity', target: 'calc-derivatives', type: 'prerequisite', strength: 0.95 },
  { id: 'e-calc-3', source: 'calc-derivatives', target: 'calc-power-rule', type: 'prerequisite', strength: 0.9 },
  { id: 'e-calc-4', source: 'calc-power-rule', target: 'calc-chain-rule', type: 'prerequisite', strength: 0.85 },
  { id: 'e-calc-5', source: 'calc-chain-rule', target: 'calc-product-quotient-rule', type: 'related_topic', strength: 0.6 },
  { id: 'e-calc-6', source: 'calc-derivatives', target: 'calc-implicit-differentiation', type: 'prerequisite', strength: 0.8 },
  { id: 'e-calc-7', source: 'calc-chain-rule', target: 'calc-implicit-differentiation', type: 'prerequisite', strength: 0.75 },
  { id: 'e-calc-8', source: 'calc-implicit-differentiation', target: 'calc-related-rates', type: 'prerequisite', strength: 0.8 },
  { id: 'e-calc-9', source: 'calc-derivatives', target: 'calc-optimization', type: 'prerequisite', strength: 0.8 },
  { id: 'e-calc-10', source: 'calc-derivatives', target: 'calc-definite-integrals', type: 'related_topic', strength: 0.5 },
  { id: 'e-calc-11', source: 'calc-definite-integrals', target: 'calc-fundamental-theorem', type: 'prerequisite', strength: 0.9 },
  { id: 'e-phys-1', source: 'phys-kinematics', target: 'phys-newtons-laws', type: 'prerequisite', strength: 0.9 },
  { id: 'e-phys-2', source: 'phys-newtons-laws', target: 'phys-forces', type: 'prerequisite', strength: 0.9 },
  { id: 'e-phys-3', source: 'phys-forces', target: 'phys-work-energy', type: 'prerequisite', strength: 0.85 },
  { id: 'e-phys-4', source: 'phys-forces', target: 'phys-momentum', type: 'prerequisite', strength: 0.8 },
  { id: 'e-phys-5', source: 'phys-kinematics', target: 'phys-circular-motion', type: 'prerequisite', strength: 0.75 },
  { id: 'e-phys-6', source: 'phys-newtons-laws', target: 'phys-shm', type: 'prerequisite', strength: 0.7 },
  // Cross-subject: rates of change (Calculus) underpin kinematics (Physics).
  { id: 'e-cross-1', source: 'calc-derivatives', target: 'phys-kinematics', type: 'related_topic', strength: 0.55 },
];

export const mockEdges: Edge[] = EDGE_SEEDS.map((e) => ({
  id: e.id,
  student_id: STUDENT_ID,
  source_node_id: e.source,
  target_node_id: e.target,
  relationship_type: e.type,
  strength: e.strength,
  discovered_by: e.discoveredBy ?? 'seed',
  created_at: iso(20),
}));

export const mockGraph = { nodes: mockNodes, edges: mockEdges };
