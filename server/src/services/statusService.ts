/**
 * ============================================================================
 * THE SOLE WRITE-PATH FOR Node.status
 * ============================================================================
 * This module is the ONLY place in the entire codebase allowed to change
 * Node.status. There is no generic "setStatus(id, status)" function here or
 * anywhere else — every status change is the deliberate side-effect of one of
 * exactly two intent functions:
 *
 *   - engageNode(nodeId)        → red   → amber  (cause: 'engage')
 *   - applyQuizResult(session)  → amber → green  (cause: 'quiz_passed')
 *                                 green → amber  (cause: 'quiz_failed')
 *
 * Both functions persist through nodesRepo.updateStatusFields, which issues a
 * raw SQL UPDATE OF status — and that UPDATE is itself re-validated by the
 * nodes_status_guard BEFORE UPDATE trigger in db/schema.sql. So even a bug in
 * this file's logic cannot produce an illegal transition in the database: the
 * trigger is the backstop of last resort. Both writes are wrapped in a
 * db.transaction so the status write and its accompanying history/field
 * writes commit atomically.
 *
 * If you find yourself wanting a third way to change status — DON'T. Model it
 * as a new cause going through one of these two functions, and update the
 * legal transition table in @zynth/shared (isLegalStatusTransition) AND the
 * SQLite trigger together.
 * ============================================================================
 */
import {
  computeMasteryScore,
  type Node,
  type QuizSession,
  type StatusHistoryEntry,
} from '@zynth/shared';
import { db } from '../db/connection';
import { nodesRepo } from '../db/repositories';
import { emitNodeUpdated, emitStatusChanged } from '../socket';

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * red → amber on the first War Room/Explain interaction, ever. Idempotent:
 * calling this on an already-engaged (amber/green) node is a safe no-op and
 * NEVER throws — callers don't need to check status first.
 */
export function engageNode(nodeId: string): Node {
  const node = nodesRepo.getById(nodeId);
  if (!node) {
    throw new Error(`engageNode: no node with id ${nodeId}`);
  }

  // Already engaged (amber or green) — idempotent no-op.
  if (node.status !== 'red' || node.engaged_at !== null) {
    return node;
  }

  const now = nowIso();
  const historyEntry: StatusHistoryEntry = { timestamp: now, status: 'amber', cause: 'engage' };
  const newHistory = [...node.history, historyEntry];
  const masteryScore = computeMasteryScore({
    status: 'amber',
    last_quiz_result: node.last_quiz_result,
    engaged_at: now,
  });

  const previousStatus = node.status;

  const applyWrite = db.transaction(() => {
    nodesRepo.updateStatusFields(nodeId, {
      status: 'amber',
      mastery_score: masteryScore,
      engaged_at: now,
      last_quiz_passed_at: node.last_quiz_passed_at,
      last_quiz_result: node.last_quiz_result ? JSON.stringify(node.last_quiz_result) : null,
      retest_count: node.retest_count,
      history: JSON.stringify(newHistory),
      updated_at: now,
    });
  });
  applyWrite();

  const updated = nodesRepo.getById(nodeId);
  if (!updated) {
    throw new Error(`engageNode: node ${nodeId} vanished mid-transaction`);
  }

  emitStatusChanged(updated, 'engage', previousStatus);
  emitNodeUpdated(updated);

  return updated;
}

/**
 * Applies a completed QuizSession's pass/fail outcome to every node it
 * covered. This is the ONLY path by which a node can reach 'green', and the
 * ONLY path by which a 'green' node can fall back to 'amber' (a failed
 * retest). Never throws for an individual node — a red node simply can't
 * reach green yet (must be engaged first) and is left untouched.
 */
export function applyQuizResult(session: QuizSession): { updated: Node[] } {
  const updated: Node[] = [];

  for (const nodeId of session.node_ids) {
    const node = nodesRepo.getById(nodeId);
    if (!node) continue; // unknown node id — nothing to apply

    const now = nowIso();
    const previousStatus = node.status;

    if (node.status === 'red') {
      // Cannot reach green without engaging first. Leave unchanged, no throw.
      continue;
    }

    if (node.status === 'amber') {
      if (session.passed) {
        // amber -> green
        const historyEntry: StatusHistoryEntry = { timestamp: now, status: 'green', cause: 'quiz_passed' };
        const newHistory = [...node.history, historyEntry];
        const lastQuizResult = { passed: true, score: session.score, at: now };
        const masteryScore = computeMasteryScore({
          status: 'green',
          last_quiz_result: lastQuizResult,
          engaged_at: node.engaged_at,
        });

        const applyWrite = db.transaction(() => {
          nodesRepo.updateStatusFields(nodeId, {
            status: 'green',
            mastery_score: masteryScore,
            engaged_at: node.engaged_at,
            last_quiz_passed_at: now,
            last_quiz_result: JSON.stringify(lastQuizResult),
            retest_count: node.retest_count,
            history: JSON.stringify(newHistory),
            updated_at: now,
          });
        });
        applyWrite();

        const fresh = nodesRepo.getById(nodeId)!;
        emitStatusChanged(fresh, 'quiz_passed', previousStatus);
        emitNodeUpdated(fresh);
        updated.push(fresh);
      } else {
        // amber stays amber — record the failed attempt, no status change.
        const lastQuizResult = { passed: false, score: session.score, at: now };
        const masteryScore = computeMasteryScore({
          status: 'amber',
          last_quiz_result: lastQuizResult,
          engaged_at: node.engaged_at,
        });

        const applyWrite = db.transaction(() => {
          nodesRepo.updateStatusFields(nodeId, {
            status: 'amber',
            mastery_score: masteryScore,
            engaged_at: node.engaged_at,
            last_quiz_passed_at: node.last_quiz_passed_at,
            last_quiz_result: JSON.stringify(lastQuizResult),
            retest_count: node.retest_count,
            history: JSON.stringify(node.history), // no transition => no new history entry
            updated_at: now,
          });
        });
        applyWrite();

        const fresh = nodesRepo.getById(nodeId)!;
        emitNodeUpdated(fresh);
        updated.push(fresh);
      }
      continue;
    }

    if (node.status === 'green') {
      // Any quiz against an already-green node is a retest.
      const newRetestCount = node.retest_count + 1;

      if (session.passed) {
        // green stays green — re-affirm mastery.
        const lastQuizResult = { passed: true, score: session.score, at: now };
        const masteryScore = computeMasteryScore({
          status: 'green',
          last_quiz_result: lastQuizResult,
          engaged_at: node.engaged_at,
        });

        const applyWrite = db.transaction(() => {
          nodesRepo.updateStatusFields(nodeId, {
            status: 'green',
            mastery_score: masteryScore,
            engaged_at: node.engaged_at,
            last_quiz_passed_at: now,
            last_quiz_result: JSON.stringify(lastQuizResult),
            retest_count: newRetestCount,
            history: JSON.stringify(node.history),
            updated_at: now,
          });
        });
        applyWrite();

        const fresh = nodesRepo.getById(nodeId)!;
        emitNodeUpdated(fresh);
        updated.push(fresh);
      } else {
        // green -> amber: a failed retest. retest_count increment is what
        // makes the DB trigger allow this specific downgrade.
        const historyEntry: StatusHistoryEntry = { timestamp: now, status: 'amber', cause: 'quiz_failed' };
        const newHistory = [...node.history, historyEntry];
        const lastQuizResult = { passed: false, score: session.score, at: now };
        const masteryScore = computeMasteryScore({
          status: 'amber',
          last_quiz_result: lastQuizResult,
          engaged_at: node.engaged_at,
        });

        const applyWrite = db.transaction(() => {
          nodesRepo.updateStatusFields(nodeId, {
            status: 'amber',
            mastery_score: masteryScore,
            engaged_at: node.engaged_at,
            last_quiz_passed_at: node.last_quiz_passed_at,
            last_quiz_result: JSON.stringify(lastQuizResult),
            retest_count: newRetestCount,
            history: JSON.stringify(newHistory),
            updated_at: now,
          });
        });
        applyWrite();

        const fresh = nodesRepo.getById(nodeId)!;
        emitStatusChanged(fresh, 'quiz_failed', previousStatus);
        emitNodeUpdated(fresh);
        updated.push(fresh);
      }
    }
  }

  return { updated };
}
