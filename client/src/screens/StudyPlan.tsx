import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import type { GhostPath, GhostVerdict, PlanStep } from '@zynth/shared';
import { STATUS_COLORS } from '@zynth/shared';
import { getSocket } from '../lib/socket';
import './rooms.css';

export interface StudyPlanProps {
  onClose: () => void;
}

const EXAMPLE_GOALS = [
  'Be ready for the unit test on derivatives',
  'Master Related Rates before Friday',
  'Get the Physics midterm topics solid',
];

const VERDICT_META: Record<GhostVerdict, { label: string; color: string }> = {
  ahead: { label: 'Ahead of schedule', color: 'var(--status-green)' },
  on_track: { label: 'On track', color: 'var(--accent-cyan)' },
  behind: { label: 'Behind schedule', color: 'var(--status-amber)' },
};

const STATE_META: Record<PlanStep['state'], { label: string; opacity: number }> = {
  done: { label: 'Done', opacity: 0.6 },
  current: { label: 'Up next', opacity: 1 },
  upcoming: { label: 'Upcoming', opacity: 0.42 },
};

async function fetchCurrentPlan(): Promise<GhostPath | null> {
  const res = await fetch('/api/plan');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /api/plan responded ${res.status}`);
  return (await res.json()) as GhostPath;
}

async function postNewPlan(goal: string): Promise<GhostPath> {
  const res = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal }),
  });
  if (!res.ok) throw new Error(`POST /api/plan responded ${res.status}`);
  return (await res.json()) as GhostPath;
}

/**
 * Full-screen Study-Plan Board. Set a goal, Zynth builds an ordered route of
 * concept nodes toward it (respecting prerequisites, skipping what's already
 * mastered), then the route quietly re-plans itself — no refresh button —
 * the instant any node's mastery status changes anywhere else in the app.
 * The live update arrives over 'plan:updated'; `replanned_because` always
 * comes straight from the server, never invented here.
 */
export function StudyPlan({ onClose }: StudyPlanProps) {
  const [goalInput, setGoalInput] = useState('');
  const [ghost, setGhost] = useState<GhostPath | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justReplanned, setJustReplanned] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchCurrentPlan()
      .then((g) => {
        if (!cancelled) setGhost(g);
      })
      .catch((err) => {
        console.warn('[Zynth] failed to load current plan:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    function handlePlanUpdated(payload: { ghost: GhostPath; because: string }) {
      setGhost(payload.ghost);
      setJustReplanned(true);
      window.setTimeout(() => setJustReplanned(false), 4000);
    }
    socket.on('plan:updated', handlePlanUpdated);
    return () => {
      socket.off('plan:updated', handlePlanUpdated);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleBuild() {
    const goal = goalInput.trim();
    if (!goal || building) return;
    setBuilding(true);
    setError(null);
    try {
      const result = await postNewPlan(goal);
      setGhost(result);
    } catch (err) {
      console.warn('[Zynth] failed to build study plan:', err);
      setError('Could not build a route — the backend may be offline. Try again.');
    } finally {
      setBuilding(false);
    }
  }

  const verdictMeta = ghost ? VERDICT_META[ghost.verdict] : null;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="rm-scrim rm-page flex flex-col"
      style={{ '--rm-accent': 'var(--accent-violet)' } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="Study Plan Board"
    >
      {/* ---- Header --------------------------------------------------------- */}
      <header className="rm-rule-b flex-shrink-0">
        <div className="rm-pad rm-band-sm mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="rm-eyebrow">GPS for your syllabus</div>
            <h1 className="rm-title mt-1.5">Study Plan Board</h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="rm-micro hidden sm:inline">Esc</span>
            <button type="button" onClick={onClose} className="rm-icon-btn" aria-label="Close study plan board">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>
      </header>

      {/* ---- Body ----------------------------------------------------------- */}
      <div className="rm-scroll flex-1">
        <div className="rm-pad mx-auto flex w-full max-w-3xl flex-col gap-10 py-8 sm:gap-12 sm:py-12">
          {!ghost && !loading && (
            <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <h2 className="rm-display max-w-2xl">Tell Zynth what you&apos;re aiming for.</h2>
              <p className="rm-lead mt-4 max-w-xl">
                Say what you&apos;re working toward and Zynth builds an ordered route through your graph —
                respecting prerequisites, skipping what you&apos;ve already mastered — then silently reroutes
                itself the moment your mastery changes, with no refresh needed.
              </p>
            </motion.section>
          )}

          {/* ---- Goal input --------------------------------------------------- */}
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="rm-eyebrow rm-eyebrow-accent">{ghost ? 'Set a new goal' : 'Step 01 · Set a goal'}</div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="text"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                disabled={building}
                placeholder="e.g. Be ready for the unit test on derivatives"
                className="rm-field"
                aria-label="Study goal"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleBuild();
                }}
              />
              <button
                type="button"
                onClick={handleBuild}
                disabled={!goalInput.trim() || building}
                className="rm-btn rm-btn-solid flex-shrink-0"
              >
                {building ? 'Building route…' : 'Build my route'}
              </button>
            </div>
            <div className="mt-4 flex flex-wrap gap-2">
              {EXAMPLE_GOALS.map((g) => (
                <button
                  key={g}
                  type="button"
                  onClick={() => setGoalInput(g)}
                  disabled={building}
                  className="glass-chip btn-chip px-3 py-1.5 text-xs"
                >
                  {g}
                </button>
              ))}
            </div>
          </motion.section>

          {error && (
            <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--status-amber)' }} role="alert">
              <span className="rm-micro" style={{ color: 'var(--status-amber)' }}>
                {error}
              </span>
            </div>
          )}

          {loading && !ghost && (
            <div className="flex items-center gap-3">
              <div className="rm-spinner h-4 w-4" aria-hidden="true" />
              <span className="rm-micro">Loading your route…</span>
            </div>
          )}

          {/* ---- Route ---------------------------------------------------- */}
          {ghost && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rm-rule-t flex flex-col gap-8 pt-10"
              aria-live="polite"
            >
              <div>
                <div className="rm-eyebrow rm-eyebrow-accent">Route toward</div>
                <h3 className="rm-subtitle mt-2">{ghost.goal}</h3>
              </div>

              <div
                className="flex flex-wrap items-center justify-between gap-4 rounded-2xl px-5 py-4"
                style={{ border: `1px solid ${verdictMeta?.color}55`, background: 'rgba(255,255,255,0.03)' }}
              >
                <div className="flex items-center gap-3">
                  <span className="rm-dot" style={{ width: 10, height: 10, background: verdictMeta?.color }} />
                  <div>
                    <div className="rm-eyebrow" style={{ color: verdictMeta?.color, letterSpacing: '0.14em' }}>
                      {verdictMeta?.label}
                    </div>
                    <div className="rm-body mt-1" style={{ color: 'var(--text-primary)' }}>
                      {ghost.summary}
                    </div>
                  </div>
                </div>
                <div className="rm-micro rm-num">
                  Step {Math.min(ghost.actual_position + 1, Math.max(ghost.steps.length, 1))} of {ghost.steps.length}
                </div>
              </div>

              {ghost.replanned_because && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl px-4 py-3"
                  style={{
                    border: '1px solid rgba(155, 123, 255, 0.35)',
                    background: justReplanned ? 'rgba(155, 123, 255, 0.14)' : 'rgba(155, 123, 255, 0.06)',
                    transition: 'background-color 600ms ease',
                  }}
                >
                  <div className="rm-eyebrow" style={{ color: 'var(--accent-violet)' }}>
                    {justReplanned ? 'Rerouted just now' : 'Last rerouted because'}
                  </div>
                  <div className="rm-body mt-1.5">{ghost.replanned_because}</div>
                </motion.div>
              )}

              <div>
                <div className="rm-eyebrow">The route</div>
                <div className="mt-4 flex flex-col gap-2">
                  {ghost.steps.length === 0 ? (
                    <p className="rm-body">Every concept on this route is already green — goal achieved.</p>
                  ) : (
                    ghost.steps.map((step) => <StepRow key={step.node_id} step={step} />)
                  )}
                </div>
              </div>

              <div className="rm-rule-t flex items-start pt-8">
                <button type="button" onClick={onClose} className="rm-btn rm-btn-ghost">
                  <span aria-hidden="true">←</span> Back to graph
                </button>
              </div>
            </motion.section>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function StepRow({ step }: { step: PlanStep }) {
  const meta = STATE_META[step.state];
  const statusColor = STATUS_COLORS[step.status];
  return (
    <div
      className="flex items-center gap-4 rounded-xl px-4 py-3"
      style={{
        border: '1px solid var(--border-glass)',
        background: step.state === 'current' ? 'rgba(82, 229, 232, 0.06)' : 'rgba(255,255,255,0.02)',
        opacity: meta.opacity,
      }}
    >
      <span className="rm-num flex-shrink-0" style={{ fontSize: 12, color: 'var(--text-muted)', width: 22 }}>
        {String(step.index + 1).padStart(2, '0')}
      </span>
      <span className="rm-dot flex-shrink-0" style={{ width: 8, height: 8, background: statusColor }} />
      <span className="rm-body flex-1 min-w-0" style={{ color: 'var(--text-primary)' }}>
        {step.label}
      </span>
      <span className="rm-eyebrow flex-shrink-0" style={{ fontSize: 10 }}>
        {meta.label}
      </span>
    </div>
  );
}

export default StudyPlan;
