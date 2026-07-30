import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'motion/react';
import type { CopilotHeatCell, CopilotInsight } from '@zynth/shared';
import { getSocket } from '../lib/socket';
import { EASE_OUT, revealFrom, REVEAL_IN } from './motion';
import './ui.css';

export interface CopilotPanelProps {
  /** The quiz_id returned by generateQuiz — also the Live Co-Pilot's session_id. Panel renders nothing until set. */
  sessionId: string | null;
}

const TREND_GLYPH: Record<CopilotHeatCell['trend'], string> = {
  rising: '↑',
  flat: '→',
  falling: '↓',
  collapsing: '⚠',
};

const TREND_LABEL: Record<CopilotHeatCell['trend'], string> = {
  rising: 'Rising',
  flat: 'Steady',
  falling: 'Falling',
  collapsing: 'Collapsing',
};

// Per-node live confidence during a quiz is a real-time read on mastery-in-
// progress — the same evidentiary use of red/amber/green as a node's status
// dot, just at a finer time grain. Not decoration.
function trendColor(trend: CopilotHeatCell['trend']): string {
  if (trend === 'rising') return 'var(--status-green)';
  if (trend === 'collapsing') return 'var(--status-red)';
  if (trend === 'falling') return 'var(--status-amber)';
  return 'var(--text-muted)';
}

function confidenceColor(confidence: number): string {
  if (confidence >= 70) return 'var(--status-green)';
  if (confidence >= 40) return 'var(--status-amber)';
  return 'var(--status-red)';
}

/**
 * Live per-node mastery heatmap + the (rare, unprompted) diagnosis card.
 * Subscribes to `copilot:heatmap` / `copilot:insight`, filtered to this
 * quiz's session_id — every other quiz session's traffic on the same socket
 * is ignored. Purely a display: it never writes anything back, and the
 * suggested-action badge is inert (Quiz.tsx has no router to send it to).
 */
export function CopilotPanel({ sessionId }: CopilotPanelProps) {
  const [cells, setCells] = useState<CopilotHeatCell[]>([]);
  const [insight, setInsight] = useState<CopilotInsight | null>(null);
  const [collapsed, setCollapsed] = useState(false);

  useEffect(() => {
    setCells([]);
    setInsight(null);
    if (!sessionId) return undefined;

    const socket = getSocket();

    const onHeatmap = (payload: { session_id: string; cells: CopilotHeatCell[] }) => {
      if (payload.session_id !== sessionId) return;
      setCells(payload.cells);
    };
    const onInsight = (payload: CopilotInsight) => {
      if (payload.session_id !== sessionId) return;
      setInsight(payload);
    };

    socket.on('copilot:heatmap', onHeatmap);
    socket.on('copilot:insight', onInsight);

    // Snapshot fetch so the panel isn't blank before the first socket push
    // (registerQuizSession's initializeCopilotSession already emits one, but
    // this covers the case where the panel mounts after that first beat).
    fetch(`/api/copilot/${encodeURIComponent(sessionId)}/heatmap`)
      .then((res) => (res.ok ? (res.json() as Promise<{ cells?: CopilotHeatCell[] }>) : null))
      .then((data) => {
        if (data?.cells) setCells((prev) => (prev.length > 0 ? prev : (data.cells as CopilotHeatCell[])));
      })
      .catch(() => {
        // Best-effort only — the socket push is the real source of truth.
      });

    return () => {
      socket.off('copilot:heatmap', onHeatmap);
      socket.off('copilot:insight', onInsight);
    };
  }, [sessionId]);

  if (!sessionId || cells.length === 0) return null;

  return (
    <div
      style={{ position: 'fixed', top: 100, right: 16, zIndex: 25, width: 272, maxWidth: 'calc(100vw - 32px)' } as CSSProperties}
    >
      <div
        className="glass-panel glass-panel-strong overflow-hidden"
        style={{ borderRadius: 'var(--radius-lg)' }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center justify-between px-4 py-3"
          style={{ borderBottom: collapsed ? 'none' : '1px solid var(--border-glass)' }}
          aria-expanded={!collapsed}
        >
          <span className="zc-mono" style={{ color: 'var(--accent-cyan)' }}>
            Live mastery
          </span>
          <span aria-hidden="true" style={{ color: 'var(--text-muted)', fontSize: 11 }}>
            {collapsed ? '▾' : '▴'}
          </span>
        </button>

        {!collapsed && (
          <div className="flex flex-col gap-4 px-4 py-3.5">
            {cells.map((cell) => (
              <div key={cell.node_id} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="zc-wrap" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {cell.label}
                  </span>
                  <span
                    className="tabular-nums flex-shrink-0"
                    style={{ fontSize: 11.5, color: trendColor(cell.trend), display: 'inline-flex', alignItems: 'center', gap: 3 }}
                    title={TREND_LABEL[cell.trend]}
                  >
                    {cell.confidence}
                    <span aria-hidden="true">{TREND_GLYPH[cell.trend]}</span>
                  </span>
                </div>
                <div style={{ height: 5, borderRadius: 999, background: 'rgba(255, 255, 255, 0.08)', overflow: 'hidden' }}>
                  <div
                    style={{
                      height: '100%',
                      width: `${cell.confidence}%`,
                      background: confidenceColor(cell.confidence),
                      transition: 'width 600ms cubic-bezier(0.16, 1, 0.3, 1)',
                    }}
                  />
                </div>
                {cell.answered > 0 && (
                  <span className="tabular-nums" style={{ fontSize: 11.5, color: 'var(--text-muted)' }}>
                    {cell.correct}/{cell.answered} correct this session
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </div>

      <AnimatePresence>{insight && <InsightCard insight={insight} onDismiss={() => setInsight(null)} />}</AnimatePresence>
    </div>
  );
}

/**
 * The (rare) unprompted diagnosis. This interrupts a live quiz, so it must
 * read as an instrument surfacing a finding — not a toast or an achievement
 * popup: no colour wash, no spring/bounce, just the standard reveal (opacity
 * + 24px rise + 6px unblur, ease-out) and a single hairline in the chrome
 * accent to mark it as the system speaking.
 */
function InsightCard({ insight, onDismiss }: { insight: CopilotInsight; onDismiss: () => void }) {
  const reduceMotion = useReducedMotion();
  const actionLabel = insight.suggested_action === 'war_room' ? 'Intuition' : insight.suggested_action === 'explain' ? 'Explain' : null;

  return (
    <motion.div
      initial={reduceMotion ? false : revealFrom(16, 5)}
      animate={REVEAL_IN}
      exit={{ opacity: 0, transition: { duration: reduceMotion ? 0 : 0.16 } }}
      transition={{ duration: reduceMotion ? 0 : 0.38, ease: EASE_OUT }}
      className="glass-panel glass-panel-strong mt-3 p-4"
      style={{ borderTop: '2px solid var(--accent-cyan)', borderTopLeftRadius: 'var(--radius-lg)', borderTopRightRadius: 'var(--radius-lg)' }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="zc-mono" style={{ color: 'var(--accent-cyan)' }}>
          Diagnosis
        </span>
        <button type="button" onClick={onDismiss} className="zc-cp-icon-btn flex-shrink-0" aria-label="Dismiss diagnosis">
          <span aria-hidden="true" style={{ fontSize: 11 }}>
            ✕
          </span>
        </button>
      </div>

      <p className="zc-duo zc-wrap mt-3" style={{ fontSize: 13.5 }}>
        <b>{insight.headline}</b> {insight.diagnosis}
      </p>

      {insight.evidence.length > 0 && (
        <div className="mt-3.5">
          <span className="zc-mono" style={{ fontSize: 9.5 }}>
            Evidence
          </span>
          <div className="mt-1.5 flex flex-col gap-1.5">
            {insight.evidence.map((item, i) => (
              <p
                key={i}
                className="zc-wrap"
                style={{
                  paddingLeft: 10,
                  borderLeft: '2px solid var(--border-glass-hover)',
                  fontSize: 11.5,
                  lineHeight: 1.5,
                  color: 'var(--text-muted)',
                }}
              >
                &ldquo;{item}&rdquo;
              </p>
            ))}
          </div>
        </div>
      )}

      {actionLabel && (
        <div className="mt-3.5">
          <span className="zc-cp-tag" style={{ color: 'var(--accent-cyan)' }}>
            Try: {actionLabel}
          </span>
        </div>
      )}
    </motion.div>
  );
}

export default CopilotPanel;
