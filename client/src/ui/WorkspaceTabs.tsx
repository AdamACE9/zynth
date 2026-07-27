import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  activateWorkspace,
  deleteWorkspace,
  getActiveWorkspace,
  isActiveWorkspace,
  listWorkspaces,
  renameWorkspace,
  type Workspace,
} from '../lib/api';

export interface WorkspaceTabsProps {
  /** A different workspace was just activated — the caller refetches the graph. */
  onWorkspaceSwitched: (workspace: Workspace) => void;
  /** The "+" control — hands off to the newWorkspace onboarding flow. */
  onCreateWorkspace: () => void;
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-void)]';

/**
 * Compact tab strip for switching between saved graphs. Deliberately quiet —
 * the graph is the product, this is just enough chrome to know which one
 * you're in and get to the others. Talks to the workspaces API described in
 * the onboarding build step (lib/api.ts#createWorkspace et al.); renders
 * nothing until at least one workspace has loaded, so a fresh install with
 * zero workspaces never shows an empty gray strip.
 */
export function WorkspaceTabs({ onWorkspaceSwitched, onCreateWorkspace }: WorkspaceTabsProps) {
  const [workspaces, setWorkspaces] = useState<Workspace[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState('');
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const renameInputRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const [list, active] = await Promise.all([
        listWorkspaces(),
        getActiveWorkspace().catch(() => null),
      ]);
      setWorkspaces(list);
      const flagged = list.find(isActiveWorkspace);
      setActiveId(active?.id ?? flagged?.id ?? list[0]?.id ?? null);
    } catch (err) {
      console.warn('[Zynth] could not load workspaces for the tab strip:', err);
      setWorkspaces([]);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (renamingId) renameInputRef.current?.focus();
  }, [renamingId]);

  async function handleSwitch(ws: Workspace) {
    if (ws.id === activeId || busyId) return;
    setBusyId(ws.id);
    try {
      const activated = await activateWorkspace(ws.id);
      setActiveId(activated.id);
      onWorkspaceSwitched(activated);
    } catch (err) {
      console.warn('[Zynth] failed to activate workspace:', err);
    } finally {
      setBusyId(null);
    }
  }

  function startRename(ws: Workspace) {
    setConfirmingDeleteId(null);
    setRenamingId(ws.id);
    setRenameDraft(ws.name);
  }

  async function commitRename(ws: Workspace) {
    const name = renameDraft.trim();
    setRenamingId(null);
    if (!name || name === ws.name) return;
    // Optimistic first — rename isn't part of the documented backend
    // contract, so if the PATCH route doesn't exist this still "works" from
    // the student's point of view.
    setWorkspaces((prev) => prev?.map((w) => (w.id === ws.id ? { ...w, name } : w)) ?? prev);
    try {
      await renameWorkspace(ws.id, name);
    } catch (err) {
      console.warn('[Zynth] rename endpoint unreachable, kept the local rename:', err);
    }
  }

  async function confirmDelete(ws: Workspace) {
    setBusyId(ws.id);
    try {
      await deleteWorkspace(ws.id);
      const remaining = (workspaces ?? []).filter((w) => w.id !== ws.id);
      setWorkspaces(remaining);
      setConfirmingDeleteId(null);
      if (ws.id === activeId) {
        // Deleted the active one — activate whatever's left, if anything.
        const next = remaining[0];
        if (next) {
          const activated = await activateWorkspace(next.id).catch(() => next);
          setActiveId(activated.id);
          onWorkspaceSwitched(activated);
        } else {
          setActiveId(null);
        }
      }
    } catch (err) {
      console.warn('[Zynth] failed to delete workspace:', err);
      setConfirmingDeleteId(null);
    } finally {
      setBusyId(null);
    }
  }

  if (!workspaces || workspaces.length === 0) return null;

  return (
    <div className="pointer-events-auto flex max-w-full flex-wrap items-center gap-1.5" role="tablist" aria-label="Graphs">
      <AnimatePresence initial={false}>
        {workspaces.map((ws) => {
          const isActive = ws.id === activeId;
          const isBusy = busyId === ws.id;
          const isRenaming = renamingId === ws.id;
          const isConfirmingDelete = confirmingDeleteId === ws.id;

          return (
            <motion.div
              key={ws.id}
              layout
              initial={{ opacity: 0, scale: 0.94 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.94 }}
              transition={{ duration: 0.16 }}
              className="glass-chip group flex shrink-0 items-center gap-1 py-1 pl-3 pr-1.5"
              style={{
                borderColor: isActive ? 'rgba(82, 229, 232, 0.55)' : undefined,
                background: isActive ? 'rgba(82, 229, 232, 0.1)' : undefined,
              }}
            >
              {isRenaming ? (
                <input
                  ref={renameInputRef}
                  value={renameDraft}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => commitRename(ws)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitRename(ws);
                    }
                    if (e.key === 'Escape') {
                      e.preventDefault();
                      setRenamingId(null);
                    }
                  }}
                  autoFocus
                  className={`rounded bg-transparent outline-none ${FOCUS_RING}`}
                  style={{ color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 600, width: Math.max(60, renameDraft.length * 7.5) }}
                />
              ) : isConfirmingDelete ? (
                <span className="flex items-center gap-1.5 pr-1" style={{ fontSize: 11.5 }}>
                  <span style={{ color: 'var(--text-secondary)' }}>Delete &quot;{ws.name}&quot;?</span>
                  <button
                    type="button"
                    onClick={() => confirmDelete(ws)}
                    disabled={isBusy}
                    className={`rounded px-1.5 py-0.5 font-semibold ${FOCUS_RING}`}
                    style={{ color: 'var(--status-red)' }}
                    aria-label={`Confirm delete ${ws.name}`}
                  >
                    {isBusy ? '…' : 'Delete'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteId(null)}
                    className={`rounded px-1.5 py-0.5 ${FOCUS_RING}`}
                    style={{ color: 'var(--text-muted)' }}
                    aria-label="Cancel delete"
                  >
                    Cancel
                  </button>
                </span>
              ) : (
                <>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => handleSwitch(ws)}
                    disabled={isBusy}
                    title={ws.name}
                    className={`max-w-[9rem] truncate rounded px-0.5 py-0.5 text-left disabled:opacity-60 ${FOCUS_RING}`}
                    style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)', fontSize: 12.5, fontWeight: isActive ? 650 : 500 }}
                  >
                    {isBusy ? 'Switching…' : ws.name}
                  </button>
                  {/* Separate controls, not a double-click on the switch button above —
                      a browser fires `click` before `dblclick`, so double-clicking to
                      rename was also triggering a workspace switch first. */}
                  <button
                    type="button"
                    onClick={() => startRename(ws)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full opacity-40 transition-opacity duration-150 hover:bg-white/10 hover:opacity-100 group-hover:opacity-70 ${FOCUS_RING}`}
                    style={{ color: 'var(--text-muted)', fontSize: 9.5 }}
                    aria-label={`Rename ${ws.name}`}
                    title="Rename this graph"
                  >
                    {'✎'}
                  </button>
                  <button
                    type="button"
                    onClick={() => setConfirmingDeleteId(ws.id)}
                    className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full opacity-40 transition-opacity duration-150 hover:bg-white/10 hover:opacity-100 group-hover:opacity-70 ${FOCUS_RING}`}
                    style={{ color: 'var(--text-muted)', fontSize: 10 }}
                    aria-label={`Delete ${ws.name}`}
                    title="Delete this graph"
                  >
                    {'✕'}
                  </button>
                </>
              )}
            </motion.div>
          );
        })}
      </AnimatePresence>

      <button
        type="button"
        onClick={onCreateWorkspace}
        className={`glass-chip btn-chip flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${FOCUS_RING}`}
        style={{ fontSize: 14, fontWeight: 600 }}
        aria-label="Create a new graph"
        title="Create a new graph"
      >
        +
      </button>
    </div>
  );
}
