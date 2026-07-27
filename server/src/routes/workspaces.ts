/**
 * Workspace (= multiple saved graphs) API. See server/src/services/workspaceService.ts
 * for the generation pipeline and TASKBRIEFING's rationale.
 *
 * API surface:
 *   GET    /api/workspaces           -> Workspace[] (each with is_active)  (newest first)
 *   GET    /api/workspaces/active    -> { active_student_id, workspace: Workspace | null }
 *   POST   /api/workspaces           -> { workspace, node_count, edge_count, nodes_per_subject }
 *   POST   /api/workspaces/:id/activate -> { active_student_id, workspace }
 *   PATCH  /api/workspaces/:id       -> { workspace }  (rename only — { name: string })
 *   DELETE /api/workspaces/:id       -> { deleted: true, id: string }
 */
import { Router } from 'express';
import { getActiveStudentId, setActiveStudentId, DEMO_STUDENT_ID } from '../config';
import {
  listWorkspaces,
  getWorkspace,
  touchWorkspaceOpened,
  deleteWorkspace,
  createWorkspace,
  renameWorkspace,
  type Workspace,
  type WorkspaceDepth,
} from '../services/workspaceService';

export const workspacesRouter = Router();

/** Adds `is_active` (computed against the current active student_id) — the
 * client's Workspace type reads `is_active ?? active` defensively for this. */
function withActiveFlag(ws: Workspace, activeId: string): Workspace & { is_active: boolean } {
  return { ...ws, is_active: ws.id === activeId };
}

workspacesRouter.get('/workspaces', (_req, res) => {
  const activeId = getActiveStudentId();
  res.json(listWorkspaces().map((ws) => withActiveFlag(ws, activeId)));
});

workspacesRouter.get('/workspaces/active', (_req, res) => {
  const activeId = getActiveStudentId();
  const workspace = getWorkspace(activeId);
  res.json({ active_student_id: activeId, workspace: workspace ? withActiveFlag(workspace, activeId) : null });
});

const VALID_DEPTHS: WorkspaceDepth[] = ['light', 'standard', 'deep'];

workspacesRouter.post('/workspaces', async (req, res) => {
  const body = req.body ?? {};
  const { name, subjects, goal, depth } = body as {
    name?: unknown;
    subjects?: unknown;
    goal?: unknown;
    depth?: unknown;
  };

  if (!Array.isArray(subjects) || subjects.length === 0 || !subjects.every((s) => typeof s === 'string')) {
    res.status(400).json({ error: 'subjects must be a non-empty string[]' });
    return;
  }
  const resolvedDepth: WorkspaceDepth | undefined =
    typeof depth === 'string' && VALID_DEPTHS.includes(depth as WorkspaceDepth)
      ? (depth as WorkspaceDepth)
      : undefined;

  try {
    const result = await createWorkspace({
      name: typeof name === 'string' ? name : subjects.join(' & '),
      subjects,
      goal: typeof goal === 'string' ? goal : undefined,
      depth: resolvedDepth,
    });
    res.status(201).json(result);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[routes/workspaces] createWorkspace failed:', err);
    res.status(500).json({ error: 'Failed to create workspace' });
  }
});

workspacesRouter.post('/workspaces/:id/activate', (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) {
    res.status(404).json({ error: `No workspace with id ${req.params.id}` });
    return;
  }
  setActiveStudentId(workspace.id);
  touchWorkspaceOpened(workspace.id);
  res.json({ active_student_id: workspace.id, workspace: withActiveFlag(workspace, workspace.id) });
});

workspacesRouter.patch('/workspaces/:id', (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) {
    res.status(404).json({ error: `No workspace with id ${req.params.id}` });
    return;
  }
  const { name } = (req.body ?? {}) as { name?: unknown };
  if (typeof name !== 'string' || name.trim().length === 0) {
    res.status(400).json({ error: 'name must be a non-empty string' });
    return;
  }
  const updated = renameWorkspace(req.params.id, name.trim());
  if (!updated) {
    res.status(404).json({ error: `No workspace with id ${req.params.id}` });
    return;
  }
  res.json({ workspace: withActiveFlag(updated, getActiveStudentId()) });
});

workspacesRouter.delete('/workspaces/:id', (req, res) => {
  const workspace = getWorkspace(req.params.id);
  if (!workspace) {
    res.status(404).json({ error: `No workspace with id ${req.params.id}` });
    return;
  }
  deleteWorkspace(req.params.id);

  // If the deleted workspace was active, fall back to another one (or the
  // original demo student id) so getActiveStudentId() never points at a
  // workspace that no longer exists.
  if (getActiveStudentId() === req.params.id) {
    const remaining = listWorkspaces();
    setActiveStudentId(remaining[0]?.id ?? DEMO_STUDENT_ID);
  }

  res.json({ deleted: true, id: req.params.id });
});
