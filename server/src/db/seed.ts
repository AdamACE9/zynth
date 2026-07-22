/**
 * Idempotent demo-data seeder. Run via `npm run seed` (or `npm run seed
 * --workspace @zynth/server` from the repo root). Safe to run repeatedly —
 * it clears the demo student's existing rows (in FK-safe order) and
 * reinserts a fresh, internally-consistent graph.
 *
 * IMPORTANT: every green/amber/red node built here is constructed to already
 * satisfy the Node.status invariants (green implies engaged_at + last_quiz_passed_at
 * + a passing last_quiz_result; amber implies engaged_at set; red implies
 * engaged_at NULL). The nodes_status_guard trigger only fires on UPDATE OF
 * status, so these initial INSERTs are unconstrained by it — but we still
 * hand-build them to be consistent because the rest of the app assumes it.
 */
import { pathToFileURL } from 'node:url';
import {
  computeMasteryScore,
  type Edge,
  type ErrorType,
  type MistakeRecord,
  type Node,
  type RelationshipType,
  type Status,
  type StatusHistoryEntry,
} from '@zynth/shared';
import { db, runMigrations } from './connection';
import { DEMO_STUDENT_ID } from '../config';
import { nodesRepo, edgesRepo, studentsRepo, agentConfigsRepo, mistakeRecordsRepo } from './repositories';
import { AGENT_CONFIGS } from '../agents/personas';

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString();
}

interface SeedNodeSpec {
  id: string;
  label: string;
  subject: 'Calculus' | 'Physics';
  status: Status;
  /** how many days ago the node was first engaged (War Room/Explain) */
  engagedDaysAgo?: number;
  /** the quiz result that most recently changed status, if any */
  quizResult?: { passed: boolean; score: number; daysAgo: number };
  /** an EARLIER passing quiz result, for nodes that went green then later failed a retest */
  priorPassDaysAgo?: number;
  retestCount?: number;
}

const NODE_SPECS: SeedNodeSpec[] = [
  // ---- Calculus (green: mastered fundamentals) ----
  { id: 'node_limits', label: 'Limits', subject: 'Calculus', status: 'green', engagedDaysAgo: 28, quizResult: { passed: true, score: 92, daysAgo: 26 } },
  { id: 'node_continuity', label: 'Continuity', subject: 'Calculus', status: 'green', engagedDaysAgo: 27, quizResult: { passed: true, score: 88, daysAgo: 24 } },
  { id: 'node_derivatives', label: 'Derivatives', subject: 'Calculus', status: 'green', engagedDaysAgo: 24, quizResult: { passed: true, score: 95, daysAgo: 21 } },
  { id: 'node_power_rule', label: 'Power Rule', subject: 'Calculus', status: 'green', engagedDaysAgo: 23, quizResult: { passed: true, score: 100, daysAgo: 20 } },

  // ---- Calculus (amber: engaged but not yet proven, or knocked down by a retest) ----
  { id: 'node_chain_rule', label: 'Chain Rule', subject: 'Calculus', status: 'amber', engagedDaysAgo: 12 },
  {
    id: 'node_product_quotient_rule',
    label: 'Product/Quotient Rule',
    subject: 'Calculus',
    status: 'amber',
    engagedDaysAgo: 18,
    priorPassDaysAgo: 15, // was green...
    quizResult: { passed: false, score: 58, daysAgo: 3 }, // ...then failed a retest -> back to amber
    retestCount: 1,
  },
  { id: 'node_implicit_differentiation', label: 'Implicit Differentiation', subject: 'Calculus', status: 'amber', engagedDaysAgo: 6 },
  { id: 'node_definite_integrals', label: 'Definite Integrals', subject: 'Calculus', status: 'amber', engagedDaysAgo: 4 },

  // ---- Calculus (red: not yet engaged) ----
  { id: 'node_related_rates', label: 'Related Rates', subject: 'Calculus', status: 'red' },
  { id: 'node_optimization', label: 'Optimization', subject: 'Calculus', status: 'red' },
  { id: 'node_fundamental_theorem', label: 'Fundamental Theorem', subject: 'Calculus', status: 'red' },

  // ---- Physics (green) ----
  { id: 'node_kinematics', label: 'Kinematics', subject: 'Physics', status: 'green', engagedDaysAgo: 22, quizResult: { passed: true, score: 90, daysAgo: 19 } },
  { id: 'node_newtons_laws', label: "Newton's Laws", subject: 'Physics', status: 'green', engagedDaysAgo: 20, quizResult: { passed: true, score: 84, daysAgo: 17 } },

  // ---- Physics (amber) ----
  { id: 'node_forces_fbd', label: 'Forces & Free-Body Diagrams', subject: 'Physics', status: 'amber', engagedDaysAgo: 10 },
  { id: 'node_work_energy', label: 'Work & Energy', subject: 'Physics', status: 'amber', engagedDaysAgo: 5 },

  // ---- Physics (red) ----
  { id: 'node_momentum', label: 'Momentum', subject: 'Physics', status: 'red' },
  { id: 'node_circular_motion', label: 'Circular Motion', subject: 'Physics', status: 'red' },
  { id: 'node_shm', label: 'Simple Harmonic Motion', subject: 'Physics', status: 'red' },
];

function buildNode(spec: SeedNodeSpec): Node {
  const engagedAt = spec.engagedDaysAgo !== undefined ? daysAgo(spec.engagedDaysAgo) : null;
  const quizResult = spec.quizResult
    ? { passed: spec.quizResult.passed, score: spec.quizResult.score, at: daysAgo(spec.quizResult.daysAgo) }
    : null;

  // last_quiz_passed_at reflects the most recent PASSING quiz, which may be
  // earlier than the most recent quiz result (a node that went green then
  // later failed a retest still "last passed" at the earlier date).
  let lastQuizPassedAt: string | null = null;
  if (spec.status === 'green' && quizResult?.passed) {
    lastQuizPassedAt = quizResult.at;
  } else if (spec.priorPassDaysAgo !== undefined) {
    lastQuizPassedAt = daysAgo(spec.priorPassDaysAgo);
  }

  const history: StatusHistoryEntry[] = [];
  if (engagedAt) {
    history.push({ timestamp: engagedAt, status: 'amber', cause: 'engage' });
  }
  if (spec.priorPassDaysAgo !== undefined) {
    history.push({ timestamp: daysAgo(spec.priorPassDaysAgo), status: 'green', cause: 'quiz_passed' });
  }
  if (quizResult) {
    if (quizResult.passed && spec.status === 'green') {
      // first-time pass with no prior retest history already covers this via the block above only if priorPassDaysAgo set;
      // for the common case (straight amber -> green) push it here.
      if (spec.priorPassDaysAgo === undefined) {
        history.push({ timestamp: quizResult.at, status: 'green', cause: 'quiz_passed' });
      }
    } else if (!quizResult.passed && spec.status === 'amber' && spec.priorPassDaysAgo !== undefined) {
      // green -> amber failed retest
      history.push({ timestamp: quizResult.at, status: 'amber', cause: 'quiz_failed' });
    }
  }

  const now = daysAgo(0);
  const createdAt = daysAgo(30);

  const node: Node = {
    id: spec.id,
    student_id: DEMO_STUDENT_ID,
    label: spec.label,
    subject: spec.subject,
    cluster: spec.subject,
    status: spec.status,
    mastery_score: 0, // recomputed below
    engaged_at: engagedAt,
    last_quiz_passed_at: lastQuizPassedAt,
    last_quiz_result: quizResult,
    retest_count: spec.retestCount ?? 0,
    history,
    x: null,
    y: null,
    z: null,
    created_at: createdAt,
    updated_at: now,
  };
  node.mastery_score = computeMasteryScore(node);
  return node;
}

interface SeedEdgeSpec {
  source: string;
  target: string;
  type: RelationshipType;
  strength: number;
}

const EDGE_SPECS: SeedEdgeSpec[] = [
  // Calculus prerequisite chain: Limits -> Derivatives -> Chain Rule -> Implicit Differentiation -> Related Rates
  { source: 'node_limits', target: 'node_continuity', type: 'prerequisite', strength: 0.9 },
  { source: 'node_limits', target: 'node_derivatives', type: 'prerequisite', strength: 1.0 },
  { source: 'node_derivatives', target: 'node_power_rule', type: 'prerequisite', strength: 1.0 },
  { source: 'node_derivatives', target: 'node_chain_rule', type: 'prerequisite', strength: 1.0 },
  { source: 'node_power_rule', target: 'node_product_quotient_rule', type: 'prerequisite', strength: 0.85 },
  { source: 'node_chain_rule', target: 'node_implicit_differentiation', type: 'prerequisite', strength: 0.9 },
  { source: 'node_implicit_differentiation', target: 'node_related_rates', type: 'prerequisite', strength: 0.9 },
  { source: 'node_derivatives', target: 'node_optimization', type: 'prerequisite', strength: 0.8 },
  { source: 'node_definite_integrals', target: 'node_fundamental_theorem', type: 'prerequisite', strength: 1.0 },
  { source: 'node_derivatives', target: 'node_fundamental_theorem', type: 'related_topic', strength: 0.6 },

  // Physics prerequisite chain: Kinematics -> Newton's Laws -> Forces & FBD -> Work & Energy
  { source: 'node_kinematics', target: 'node_newtons_laws', type: 'prerequisite', strength: 1.0 },
  { source: 'node_newtons_laws', target: 'node_forces_fbd', type: 'prerequisite', strength: 1.0 },
  { source: 'node_forces_fbd', target: 'node_work_energy', type: 'prerequisite', strength: 0.9 },
  { source: 'node_newtons_laws', target: 'node_momentum', type: 'prerequisite', strength: 0.85 },
  { source: 'node_forces_fbd', target: 'node_circular_motion', type: 'prerequisite', strength: 0.8 },
  { source: 'node_newtons_laws', target: 'node_shm', type: 'prerequisite', strength: 0.75 },

  // A couple of related_topic edges
  { source: 'node_momentum', target: 'node_work_energy', type: 'related_topic', strength: 0.6 },
  { source: 'node_circular_motion', target: 'node_shm', type: 'related_topic', strength: 0.55 },

  // The one cross-subject link: velocity is a derivative.
  { source: 'node_derivatives', target: 'node_kinematics', type: 'related_topic', strength: 0.7 },
];

// ---------------------------------------------------------------------------
// mistake records — a DELIBERATE cross-concept thread for the Autopsy Board
// demo: sign-flip / dropped-negative errors recurring across three otherwise
// unrelated-looking Calculus nodes (Chain Rule, Implicit Differentiation,
// Related Rates), mostly concept_gap, plus a couple of one-off mistakes for
// variety so the clustering isn't trivially "everything is one cluster."
// ---------------------------------------------------------------------------

interface SeedMistakeSpec {
  id: string;
  nodeId: string;
  excerpt: string;
  errorType: ErrorType;
  daysAgo: number;
}

const MISTAKE_SPECS: SeedMistakeSpec[] = [
  // -- The sign-flip / dropped-negative thread (spans 3 nodes) --
  {
    id: 'mistake_seed_chain_01',
    nodeId: 'node_chain_rule',
    excerpt:
      "Differentiated cos(3x) as -3sin(3x) but wrote the final answer as 3sin(3x), dropping the negative that comes from the chain rule's inner derivative.",
    errorType: 'concept_gap',
    daysAgo: 9,
  },
  {
    id: 'mistake_seed_chain_02',
    nodeId: 'node_chain_rule',
    excerpt:
      "For d/dx[e^(-x^2)], forgot the negative sign from the derivative of -x^2, writing 2x*e^(-x^2) instead of -2x*e^(-x^2).",
    errorType: 'concept_gap',
    daysAgo: 8,
  },
  {
    id: 'mistake_seed_implicit_01',
    nodeId: 'node_implicit_differentiation',
    excerpt:
      "Differentiating x^2 + y^2 = 25 implicitly, wrote dy/dx = x/y instead of dy/dx = -x/y — the sign flipped while isolating dy/dx.",
    errorType: 'concept_gap',
    daysAgo: 6,
  },
  {
    id: 'mistake_seed_implicit_02',
    nodeId: 'node_implicit_differentiation',
    excerpt:
      "While implicitly differentiating xy + y^2 = 7, dropped the negative when moving the x*(dy/dx) term across the equals sign.",
    errorType: 'concept_gap',
    daysAgo: 5,
  },
  {
    id: 'mistake_seed_related_01',
    nodeId: 'node_related_rates',
    excerpt:
      "In the ladder-sliding-down-a-wall problem, wrote dx/dt = (y/x)(dy/dt) without a negative, even though the ladder's height is decreasing so dy/dt should be negative.",
    errorType: 'concept_gap',
    daysAgo: 3,
  },
  {
    id: 'mistake_seed_related_02',
    nodeId: 'node_related_rates',
    excerpt:
      "For the shrinking-circle problem, set up dA/dt = 2*pi*r*(dr/dt) but plugged in a positive dr/dt even though the radius is decreasing — sign error carried through to the final rate.",
    errorType: 'concept_gap',
    daysAgo: 2,
  },
  // -- One-off variety, so clustering has to actually discriminate --
  {
    id: 'mistake_seed_chain_03',
    nodeId: 'node_chain_rule',
    excerpt:
      "Correctly set up d/dx[(2x+1)^3] as 3(2x+1)^2 * 2 but then multiplied it out to 5(2x+1)^2 instead of 6(2x+1)^2 — an arithmetic slip, not a setup error.",
    errorType: 'careless_slip',
    daysAgo: 7,
  },
  {
    id: 'mistake_seed_product_quotient_01',
    nodeId: 'node_product_quotient_rule',
    excerpt:
      "Applied the quotient rule to x/(x+1) but swapped the numerator terms in the formula — doesn't yet have the quotient rule's structure memorized correctly.",
    errorType: 'concept_gap',
    daysAgo: 4,
  },
  {
    id: 'mistake_seed_implicit_03',
    nodeId: 'node_implicit_differentiation',
    excerpt:
      "Couldn't finish isolating dy/dx after implicit differentiation because factoring an expression with dy/dx in two terms wasn't solid — a prerequisite algebra gap, not the differentiation itself.",
    errorType: 'prerequisite_gap',
    daysAgo: 1,
  },
];

function clearDemoStudentData(): void {
  const clearOrder = [
    'mistake_records',
    'quiz_sessions',
    'war_room_sessions',
    'explain_sessions',
    'exam_sim_sessions',
    'plan_paths',
    'edges',
    'nodes',
  ];
  const clear = db.transaction(() => {
    for (const table of clearOrder) {
      db.prepare(`DELETE FROM ${table} WHERE student_id = ?`).run(DEMO_STUDENT_ID);
    }
  });
  clear();
}

export function seed(): void {
  runMigrations();

  studentsRepo.upsert(DEMO_STUDENT_ID, 'Demo Student');

  for (const cfg of AGENT_CONFIGS) {
    agentConfigsRepo.upsert(cfg);
  }

  clearDemoStudentData();

  const insertAll = db.transaction(() => {
    for (const spec of NODE_SPECS) {
      nodesRepo.insert(buildNode(spec));
    }

    for (const e of EDGE_SPECS) {
      const edge: Edge = {
        id: `edge_${e.source}__${e.target}`,
        student_id: DEMO_STUDENT_ID,
        source_node_id: e.source,
        target_node_id: e.target,
        relationship_type: e.type,
        strength: e.strength,
        discovered_by: 'seed',
        created_at: daysAgo(0),
      };
      edgesRepo.insert(edge);
    }

    for (const spec of MISTAKE_SPECS) {
      const record: MistakeRecord = {
        id: spec.id,
        student_id: DEMO_STUDENT_ID,
        node_id: spec.nodeId,
        source: 'uploaded_homework',
        raw_excerpt: spec.excerpt,
        error_type: spec.errorType,
        created_at: daysAgo(spec.daysAgo),
      };
      mistakeRecordsRepo.insert(record);
    }
  });
  insertAll();

  // eslint-disable-next-line no-console
  console.log(
    `[seed] Seeded ${NODE_SPECS.length} nodes, ${EDGE_SPECS.length} edges, and ${MISTAKE_SPECS.length} mistake ` +
      `records for ${DEMO_STUDENT_ID}, ${AGENT_CONFIGS.length} agent configs.`,
  );
}

// Allow running directly via `tsx src/db/seed.ts` / `npm run seed`.
const isMainModule = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMainModule) {
  seed();
}
