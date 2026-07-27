import { useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Node, QuizResultSummary, Status } from '@zynth/shared';
import { masteryStreak, STATUS_COLORS } from '@zynth/shared';
import { engageNode } from '../lib/api';
import { StreakFlame } from './StreakFlame';

interface NodePanelProps {
  node: Node;
  onClose: () => void;
  patchNode: (nodeId: string, patch: Partial<Node>) => void;
  replaceNode: (node: Node) => void;
  onOpenScreen: (type: 'warroom' | 'explain' | 'quiz', nodeId: string) => void;
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-void)]';

/**
 * 108 = the panel's 84px top offset + a matching 24px bottom gutter, so it
 * never runs flush to the viewport edge on short screens. The body below the
 * header scrolls internally once the content exceeds this.
 */
const PANEL_MAX_HEIGHT = 'calc(100vh - 108px)';

const STATUS_LABEL: Record<Status, string> = {
  red: 'Unproven',
  amber: 'Engaged',
  green: 'Proven',
};

const STATUS_GLOW: Record<Status, string> = {
  red: 'var(--status-red-glow)',
  amber: 'var(--status-amber-glow)',
  green: 'var(--status-green-glow)',
};

type ActionType = 'warroom' | 'explain' | 'quiz';

/* -- Icons: 20px stroke glyphs. Emoji read as amateur at this size. -------- */

function WarRoomIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path
        d="M4 10.5v3M8 6.5v11M12 3.5v17M16 7.5v9M20 10.5v3"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ExplainIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path
        d="M3.5 6.5a3 3 0 0 1 3-3h11a3 3 0 0 1 3 3v7a3 3 0 0 1-3 3H10l-4.6 3.6V16.5H6.5a3 3 0 0 1-3-3z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path d="M8.4 10h7.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
      <path d="M8.4 13h4.2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

function QuizIcon() {
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4.4" stroke="currentColor" strokeWidth="1.6" />
      <path d="m7.8 12.2 2.9 2.9 5.5-5.9" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const ACTIONS: Array<{ type: ActionType; label: string; description: string; icon: ReactNode; accent: string }> = [
  { type: 'warroom', label: 'War Room', description: 'Five AI minds debate it live', icon: <WarRoomIcon />, accent: 'var(--accent-cyan)' },
  { type: 'explain', label: 'Explain', description: 'A calm 1:1 tutor session', icon: <ExplainIcon />, accent: 'var(--accent-violet)' },
  { type: 'quiz', label: 'Quiz', description: 'Prove it — the only path to green', icon: <QuizIcon />, accent: '#eef1fb' },
];

/** A single "what to do next" recommendation, driven purely by node.status. */
const RECOMMENDATION: Record<Status, { text: string; action: ActionType }> = {
  red: { text: 'Nothing proven here yet. Engage it in the War Room or with Explain to move it to amber.', action: 'warroom' },
  amber: { text: "You've engaged it but not proven it. Pass a quiz — that's the only way to green.", action: 'quiz' },
  green: { text: 'Proven. Retest now and then to keep it green; a failed retest drops it back to amber.', action: 'quiz' },
};

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function formatQuizResult(result: QuizResultSummary | null): { text: string; color: string } {
  if (!result) return { text: 'Not taken', color: 'var(--text-muted)' };
  return {
    text: `${result.score}/100 · ${result.passed ? 'Passed' : 'Failed'}`,
    color: result.passed ? 'var(--status-green)' : 'var(--status-red)',
  };
}

/**
 * One row of the fact list — hairline-separated, label left, tabular value
 * right. `dl > div > (dt, dd)` is the spec-sanctioned grouping wrapper, so the
 * rule lives on this div rather than a second nested one.
 */
function Fact({ label, value, color, rule = true }: { label: string; value: string; color?: string; rule?: boolean }) {
  return (
    <div
      className="flex items-baseline justify-between gap-3 py-2"
      style={rule ? { borderBottom: '1px solid var(--border-glass)' } : undefined}
    >
      <dt style={{ color: 'var(--text-muted)', fontSize: 12 }}>{label}</dt>
      <dd
        className="tabular-nums truncate text-right"
        style={{ color: color ?? 'var(--text-secondary)', fontSize: 12.5, fontWeight: 500 }}
      >
        {value}
      </dd>
    </div>
  );
}

/**
 * The click-to-expand interaction shell — the launchpad for every room. It has
 * one job: answer "what is this concept, how am I doing, and what do I do
 * next?" in a single glance, in that order.
 *
 * War Room / Explain / Quiz open the matching full-screen overlay via
 * `onOpenScreen` (wired in App.tsx to the component under
 * client/src/screens/). "Mark as engaged" is real: it POSTs
 * /api/nodes/:id/engage and, if that fails because the backend isn't running,
 * falls back to an obvious local optimistic flip so the red->amber transition
 * still works offline.
 */
export function NodePanel({ node, onClose, patchNode, replaceNode, onOpenScreen }: NodePanelProps) {
  const [toast, setToast] = useState<string | null>(null);
  const [engaging, setEngaging] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleEngage() {
    if (node.status !== 'red') {
      setToast('Already engaged or proven.');
      return;
    }
    setEngaging(true);
    try {
      const updated = await engageNode(node.id);
      replaceNode(updated);
      setToast('Engaged — status live from server.');
    } catch (err) {
      console.warn('[Zynth] engage endpoint unreachable, applying local optimistic flip:', err);
      patchNode(node.id, { status: 'amber', engaged_at: new Date().toISOString() });
      setToast('Engaged locally — backend offline.');
    } finally {
      setEngaging(false);
    }
  }

  const statusColor = STATUS_COLORS[node.status];
  const statusGlow = STATUS_GLOW[node.status];
  const recommendation = RECOMMENDATION[node.status];
  const quizResult = formatQuizResult(node.last_quiz_result);
  const scorePct = Math.max(0, Math.min(100, node.mastery_score));
  const streak = masteryStreak(node);

  return (
    <motion.aside
      aria-label={`${node.label} — concept detail`}
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0, transition: { duration: 0.18, ease: 'easeIn' } }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className="glass-panel glass-panel-strong pointer-events-auto fixed right-3 top-[72px] z-20 flex w-[25rem] max-w-[92vw] flex-col p-5 sm:right-6 sm:top-[84px] sm:p-6"
      style={{ maxHeight: PANEL_MAX_HEIGHT }}
    >
      {/* Header — subject eyebrow, concept name, close. Stays put while the
          body below scrolls on short viewports. */}
      <div className="flex shrink-0 items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="section-label truncate" style={{ fontSize: 10 }}>
            {node.subject}
          </div>
          <h2
            className="font-display mt-1.5"
            style={{ color: 'var(--text-primary)', fontSize: 22, lineHeight: 1.2, letterSpacing: '-0.022em', fontWeight: 700 }}
          >
            {node.label}
          </h2>
        </div>
        <button
          type="button"
          onClick={onClose}
          className={`glass-chip btn-chip flex h-8 w-8 shrink-0 items-center justify-center ${FOCUS_RING}`}
          style={{ fontSize: 13 }}
          aria-label="Close node panel (Escape)"
          title="Close — Esc"
        >
          {'✕'}
        </button>
      </div>

      <div className="mt-5 min-h-0 flex-1 overflow-y-auto pr-1 -mr-1">
        {/* ---- How am I doing -------------------------------------------- */}
        <section aria-label="Mastery">
          <div className="flex items-end justify-between gap-3">
            <div className="flex items-baseline gap-1.5">
              <span
                className="font-display tabular-nums"
                style={{ color: 'var(--text-primary)', fontSize: 40, lineHeight: 1, fontWeight: 700, letterSpacing: '-0.03em' }}
              >
                {node.mastery_score}
              </span>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>/100</span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <StreakFlame count={streak} />
              <span
                className="glass-chip inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1"
                style={{ color: statusColor, fontSize: 11, fontWeight: 700, letterSpacing: '0.06em' }}
              >
                <span
                  aria-hidden
                  className="h-1.5 w-1.5 rounded-full"
                  style={{ backgroundColor: statusColor, boxShadow: `0 0 8px ${statusGlow}, 0 0 2px ${statusGlow}` }}
                />
                {STATUS_LABEL[node.status]}
              </span>
            </div>
          </div>

          <div className="mt-3 h-1.5 w-full overflow-hidden rounded-full" style={{ background: 'rgba(255,255,255,0.09)' }}>
            <div
              className="h-full rounded-full"
              style={{
                width: `${scorePct}%`,
                background: statusColor,
                boxShadow: `0 0 12px ${statusGlow}`,
                transition: 'width 600ms ease, background-color 600ms ease',
              }}
            />
          </div>
          <div className="section-label mt-2" style={{ fontSize: 10 }}>
            Mastery score
          </div>
        </section>

        {/* ---- The record ------------------------------------------------- */}
        <dl className="mt-5" style={{ borderTop: '1px solid var(--border-glass)' }}>
          <Fact label="Engaged" value={formatTimestamp(node.engaged_at)} />
          <Fact label="Last quiz" value={quizResult.text} color={quizResult.color} />
          <Fact label="Retests" value={`${node.retest_count}×`} rule={false} />
        </dl>

        {/* ---- What do I do next ------------------------------------------ */}
        <section className="mt-6" aria-label="Next step">
          <div className="flex items-baseline gap-2">
            <span aria-hidden style={{ color: statusColor, fontSize: 11 }}>
              {'▍'}
            </span>
            <span className="section-label" style={{ fontSize: 10, color: statusColor }}>
              Do this next
            </span>
          </div>
          <p className="mt-2" style={{ color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.55 }}>
            {recommendation.text}
          </p>

          <div className="mt-3.5 flex flex-col gap-2">
            {ACTIONS.map((action) => {
              const isPrimary = action.type === recommendation.action;
              const rowStyle = {
                '--row-bg': isPrimary ? 'rgba(255,255,255,0.065)' : 'var(--surface-glass-chip)',
                '--row-bg-hover': isPrimary ? 'rgba(255,255,255,0.1)' : 'rgba(255,255,255,0.06)',
                '--row-bd': isPrimary ? action.accent : 'var(--border-glass)',
                '--row-bd-hover': isPrimary ? action.accent : 'var(--border-glass-hover)',
                boxShadow: isPrimary
                  ? `0 8px 34px rgba(0,0,0,0.45), inset 0 1px 0 var(--border-inner-highlight), 0 0 26px ${action.accent}2e`
                  : '0 6px 24px rgba(0,0,0,0.35), inset 0 1px 0 var(--border-inner-highlight)',
              } as CSSProperties;

              return (
                <button
                  key={action.type}
                  type="button"
                  onClick={() => onOpenScreen(action.type, node.id)}
                  style={rowStyle}
                  className={`flex w-full items-center gap-3 rounded-[var(--radius-sm)] border bg-[var(--row-bg)] px-3.5 py-3 text-left transition-colors duration-150 border-[var(--row-bd)] hover:bg-[var(--row-bg-hover)] hover:border-[var(--row-bd-hover)] ${FOCUS_RING}`}
                >
                  <span
                    aria-hidden
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full"
                    style={{
                      background: isPrimary ? `${action.accent}1f` : 'rgba(255,255,255,0.055)',
                      color: isPrimary ? action.accent : 'var(--text-secondary)',
                    }}
                  >
                    {action.icon}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span style={{ color: 'var(--text-primary)', fontSize: 14, fontWeight: 650, letterSpacing: '-0.01em' }}>
                        {action.label}
                      </span>
                      {isPrimary && (
                        <span
                          className="rounded-full px-1.5 py-0.5"
                          style={{
                            color: action.accent,
                            background: 'rgba(255,255,255,0.08)',
                            fontSize: 8.5,
                            fontWeight: 700,
                            letterSpacing: '0.14em',
                            textTransform: 'uppercase',
                          }}
                        >
                          Start here
                        </span>
                      )}
                    </span>
                    <span className="mt-0.5 block" style={{ color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.4 }}>
                      {action.description}
                    </span>
                  </span>
                  <span aria-hidden className="shrink-0" style={{ color: 'var(--text-muted)', fontSize: 15 }}>
                    {'›'}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        {/* ---- Quick engage shortcut --------------------------------------- */}
        {node.status === 'red' && (
          <div className="mt-5 pt-4" style={{ borderTop: '1px solid var(--border-glass)' }}>
            <button
              type="button"
              onClick={handleEngage}
              disabled={engaging}
              className={`btn-chip w-full rounded-[var(--radius-sm)] py-2 disabled:opacity-50 ${FOCUS_RING}`}
              style={{ fontSize: 12, fontWeight: 600 }}
            >
              {engaging ? 'Engaging…' : 'Mark as engaged'}
            </button>
            <p className="mt-1.5 text-center" style={{ color: 'var(--text-muted)', fontSize: 10.5, lineHeight: 1.45 }}>
              Shortcut for red → amber without a full War Room or Explain session.
            </p>
          </div>
        )}

        <AnimatePresence>
          {toast && (
            <motion.div
              key="node-panel-toast"
              role="status"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, transition: { duration: 0.18 } }}
              className="glass-chip mt-3 px-3 py-2"
              style={{ color: 'var(--text-secondary)', fontSize: 11.5 }}
            >
              {toast}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.aside>
  );
}
