import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import { STATUS_COLORS } from '@zynth/shared';
import type { Status } from '@zynth/shared';
import './rooms.css';

export interface TimeMachineProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Local duck-typed mirror of server/src/services/timeMachineService.ts —
// that file is server-only (not part of @zynth/shared), so the response
// shape is kept in sync here manually. Keep this block aligned with
// `TimeMachineResult` if the server contract ever changes.
// ---------------------------------------------------------------------------

type TimeMachineVerdict = 'ahead' | 'on_track' | 'behind';

interface TimeMachineNode {
  node_id: string;
  label: string;
  subject: string;
  status: Status;
  week: number;
  state: 'done' | 'current' | 'upcoming';
}

interface TimeMachineCheckpoint {
  week: number;
  date: string;
  should_be_green: number;
  actually_green: number;
  node_labels: string[];
  is_past: boolean;
}

interface TimeMachineReroute {
  moved: { node_id: string; label: string; from_week: number; to_week: number }[];
  dropped: { node_id: string; label: string }[];
  reasoning: string;
  new_weekly_load: number;
  baseline_weekly_load: number;
  used_gemini: boolean;
}

interface TimeMachineResult {
  id: string;
  goal: string | null;
  exam_date: string;
  created_at: string;
  nodes: TimeMachineNode[];
  checkpoints: TimeMachineCheckpoint[];
  verdict: TimeMachineVerdict;
  slip_days: number;
  summary: string;
  reroute: TimeMachineReroute | null;
  last_rerouted_at: string | null;
}

const VERDICT_META: Record<TimeMachineVerdict, { label: string; color: string }> = {
  ahead: { label: 'Ahead of schedule', color: 'var(--status-green)' },
  on_track: { label: 'On track', color: 'var(--accent-cyan)' },
  behind: { label: 'Behind schedule', color: 'var(--status-amber)' },
};

/** Live-poll interval — GET recomputes fully server-side, so a light poll is
 * enough to keep the verdict fresh without a dedicated socket event. */
const POLL_MS = 20000;

function todayPlus(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

async function fetchCurrent(): Promise<TimeMachineResult | null> {
  const res = await fetch('/api/timemachine');
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET /api/timemachine responded ${res.status}`);
  return (await res.json()) as TimeMachineResult;
}

async function postSchedule(examDate: string, goal: string): Promise<TimeMachineResult> {
  const res = await fetch('/api/timemachine', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      exam_date: examDate ? new Date(examDate).toISOString() : undefined,
      goal: goal.trim() || undefined,
    }),
  });
  if (!res.ok) throw new Error(`POST /api/timemachine responded ${res.status}`);
  return (await res.json()) as TimeMachineResult;
}

/**
 * Curriculum Time-Machine (Day 4 Tier 2). Sibling of the Study Plan Board on
 * the TIME axis: the Plan says "what order", this says "am I on schedule,
 * and what changes if not". Set an exam date (and optionally a goal), Zynth
 * schedules every not-yet-green concept across weekly checkpoints, and
 * reports whether you're ahead / on track / behind — with a live reroute
 * (raised pace, deferred concepts) the moment you fall behind.
 */
export function TimeMachine({ onClose }: TimeMachineProps) {
  const [examDateInput, setExamDateInput] = useState(todayPlus(21));
  const [goalInput, setGoalInput] = useState('');
  const [result, setResult] = useState<TimeMachineResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [building, setBuilding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchCurrent()
      .then((r) => {
        if (!cancelled) setResult(r);
      })
      .catch((err) => {
        console.warn('[Zynth] failed to load time-machine schedule:', err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Live-poll while a schedule exists — the server recomputes the verdict
  // fresh on every GET, so this is how the "am I still on track" state stays
  // current without a dedicated socket event for this feature.
  useEffect(() => {
    if (!result) return;
    const timer = window.setInterval(() => {
      fetchCurrent()
        .then((r) => setResult(r))
        .catch(() => {
          /* silent — next tick tries again */
        });
    }, POLL_MS);
    return () => window.clearInterval(timer);
  }, [result?.id]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleBuild() {
    if (building) return;
    setBuilding(true);
    setError(null);
    try {
      const r = await postSchedule(examDateInput, goalInput);
      setResult(r);
    } catch (err) {
      console.warn('[Zynth] failed to build time-machine schedule:', err);
      setError('Could not build a schedule — the backend may be offline. Try again.');
    } finally {
      setBuilding(false);
    }
  }

  const verdictMeta = result ? VERDICT_META[result.verdict] : null;

  const nodesByWeek = useMemo(() => {
    const map = new Map<number, TimeMachineNode[]>();
    if (!result) return map;
    for (const n of result.nodes) {
      const arr = map.get(n.week) ?? [];
      arr.push(n);
      map.set(n.week, arr);
    }
    return map;
  }, [result]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="rm-scrim rm-page flex flex-col"
      style={{ '--rm-accent': 'var(--accent-cyan)' } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="Curriculum Time-Machine"
    >
      {/* ---- Header --------------------------------------------------------- */}
      <header className="rm-rule-b flex-shrink-0">
        <div className="rm-pad rm-band-sm mx-auto flex w-full max-w-3xl items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="rm-eyebrow">GPS for the calendar</div>
            <h1 className="rm-title mt-1.5">Curriculum Time-Machine</h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="rm-micro hidden sm:inline">Esc</span>
            <button type="button" onClick={onClose} className="rm-icon-btn" aria-label="Close time-machine">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>
      </header>

      {/* ---- Body ----------------------------------------------------------- */}
      <div className="rm-scroll flex-1">
        <div className="rm-pad mx-auto flex w-full max-w-3xl flex-col gap-10 py-8 sm:gap-12 sm:py-12">
          {!result && !loading && (
            <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <h2 className="rm-display max-w-2xl">When&apos;s your exam, and are you going to make it?</h2>
              <p className="rm-lead mt-4 max-w-xl">
                Zynth schedules every concept you haven&apos;t mastered yet across the weeks between now and your
                exam date, respecting prerequisites — then tells you plainly whether you&apos;re ahead, on track, or
                behind, and reroutes the run-up itself the moment you fall behind.
              </p>
            </motion.section>
          )}

          {/* ---- Inputs --------------------------------------------------- */}
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="rm-eyebrow rm-eyebrow-accent">{result ? 'Set a new exam date' : 'Step 01 · Exam date'}</div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                type="date"
                value={examDateInput}
                onChange={(e) => setExamDateInput(e.target.value)}
                disabled={building}
                className="rm-field sm:max-w-[220px]"
                aria-label="Exam date"
              />
              <input
                type="text"
                value={goalInput}
                onChange={(e) => setGoalInput(e.target.value)}
                disabled={building}
                placeholder="Optional goal, e.g. Ace the derivatives unit"
                className="rm-field"
                aria-label="Goal (optional)"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleBuild();
                }}
              />
              <button
                type="button"
                onClick={handleBuild}
                disabled={building}
                className="rm-btn rm-btn-solid flex-shrink-0"
              >
                {building ? 'Scheduling…' : 'Build schedule'}
              </button>
            </div>
          </motion.section>

          {error && (
            <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--status-amber)' }} role="alert">
              <span className="rm-micro" style={{ color: 'var(--status-amber)' }}>
                {error}
              </span>
            </div>
          )}

          {loading && !result && (
            <div className="flex items-center gap-3">
              <div className="rm-spinner h-4 w-4" aria-hidden="true" />
              <span className="rm-micro">Loading your schedule…</span>
            </div>
          )}

          {/* ---- Schedule --------------------------------------------------- */}
          {result && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rm-rule-t flex flex-col gap-8 pt-10"
              aria-live="polite"
            >
              <div>
                <div className="rm-eyebrow rm-eyebrow-accent">Exam</div>
                <h3 className="rm-subtitle mt-2">
                  {formatDate(result.exam_date)}
                  {result.goal ? ` · ${result.goal}` : ''}
                </h3>
              </div>

              {/* Verdict */}
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
                      {result.summary}
                    </div>
                  </div>
                </div>
                {result.verdict === 'behind' && (
                  <div className="rm-micro rm-num" style={{ color: 'var(--status-amber)' }}>
                    Slip: {result.slip_days} day{result.slip_days === 1 ? '' : 's'}
                  </div>
                )}
              </div>

              {/* Reroute */}
              {result.reroute && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rounded-xl px-4 py-3"
                  style={{ border: '1px solid rgba(255, 176, 32, 0.35)', background: 'rgba(255, 176, 32, 0.08)' }}
                >
                  <div className="rm-eyebrow" style={{ color: 'var(--status-amber)' }}>
                    Rerouted — what changed
                  </div>
                  <div className="rm-body mt-1.5">{result.reroute.reasoning}</div>
                  <div className="rm-micro mt-2">
                    Weekly load raised from {result.reroute.baseline_weekly_load} to {result.reroute.new_weekly_load}{' '}
                    concept{result.reroute.new_weekly_load === 1 ? '' : 's'}/week
                    {result.reroute.used_gemini ? ' · deferrals chosen by Gemini' : ''}.
                  </div>
                </motion.div>
              )}

              {/* Checkpoint timeline */}
              <div>
                <div className="rm-eyebrow">Checkpoint timeline</div>
                <div className="mt-4 flex flex-col gap-3">
                  {result.checkpoints.length === 0 ? (
                    <p className="rm-body">Every concept is already green — goal achieved.</p>
                  ) : (
                    result.checkpoints.map((cp) => (
                      <CheckpointRow key={cp.week} checkpoint={cp} nodes={nodesByWeek.get(cp.week) ?? []} />
                    ))
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

function CheckpointRow({ checkpoint, nodes }: { checkpoint: TimeMachineCheckpoint; nodes: TimeMachineNode[] }) {
  const onPace = checkpoint.actually_green >= checkpoint.should_be_green;
  return (
    <div
      className="flex flex-col gap-3 rounded-xl px-4 py-3"
      style={{
        border: '1px solid var(--border-glass)',
        background: checkpoint.is_past ? 'rgba(255,255,255,0.02)' : 'rgba(82, 229, 232, 0.04)',
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3">
          <span className="rm-num" style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            Week {checkpoint.week}
          </span>
          <span className="rm-micro">{formatDate(checkpoint.date)}</span>
        </div>
        <span
          className="rm-micro rm-num"
          style={{ color: checkpoint.is_past ? (onPace ? 'var(--status-green)' : 'var(--status-amber)') : 'var(--text-muted)' }}
        >
          {checkpoint.actually_green}/{checkpoint.should_be_green} green
          {checkpoint.is_past ? '' : ' (due)'}
        </span>
      </div>
      {nodes.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {nodes.map((n) => (
            <span key={n.node_id} className="rm-tag" style={{ borderColor: `${STATUS_COLORS[n.status]}55` }}>
              <span className="rm-dot" style={{ width: 6, height: 6, background: STATUS_COLORS[n.status] }} />
              {n.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default TimeMachine;
