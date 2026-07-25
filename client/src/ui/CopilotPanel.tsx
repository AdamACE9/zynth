import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { CopilotHeatCell, CopilotInsight } from '@zynth/shared';
import { getSocket } from '../lib/socket';

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
      className="cp-root"
      style={{ position: 'fixed', top: 100, right: 16, zIndex: 25, width: 272, maxWidth: 'calc(100vw - 32px)' } as CSSProperties}
    >
      <div
        className="overflow-hidden rounded-2xl border"
        style={{
          borderColor: 'var(--border-glass)',
          background: 'linear-gradient(180deg, rgba(14, 16, 28, 0.92) 0%, rgba(7, 8, 16, 0.95) 100%)',
          boxShadow: '0 20px 60px rgba(0, 0, 0, 0.5)',
          backdropFilter: 'blur(10px)',
          WebkitBackdropFilter: 'blur(10px)',
        }}
      >
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          className="flex w-full items-center justify-between px-4 py-3"
          style={{ borderBottom: collapsed ? 'none' : '1px solid var(--border-glass)' }}
          aria-expanded={!collapsed}
        >
          <span className="rm-eyebrow rm-eyebrow-accent">Live mastery</span>
          <span className="rm-micro" aria-hidden="true">
            {collapsed ? '▾' : '▴'}
          </span>
        </button>

        {!collapsed && (
          <div className="flex flex-col gap-4 px-4 py-3.5">
            {cells.map((cell) => (
              <div key={cell.node_id} className="flex flex-col gap-1.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="rm-wrap" style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                    {cell.label}
                  </span>
                  <span
                    className="rm-num flex-shrink-0"
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
                  <span className="rm-micro rm-num">
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

function InsightCard({ insight, onDismiss }: { insight: CopilotInsight; onDismiss: () => void }) {
  const actionLabel = insight.suggested_action === 'war_room' ? 'War Room' : insight.suggested_action === 'explain' ? 'Explain' : null;

  return (
    <motion.div
      initial={{ opacity: 0, x: 18, y: -4 }}
      animate={{ opacity: 1, x: 0, y: 0 }}
      exit={{ opacity: 0, x: 18 }}
      transition={{ type: 'spring', stiffness: 260, damping: 28 }}
      className="mt-3 rounded-2xl border p-4"
      style={{
        borderColor: 'var(--accent-cyan)',
        background: 'linear-gradient(180deg, rgba(82, 229, 232, 0.1) 0%, rgba(10, 12, 24, 0.95) 100%)',
        boxShadow: '0 20px 60px rgba(82, 229, 232, 0.16)',
      }}
      role="status"
      aria-live="polite"
    >
      <div className="flex items-start justify-between gap-3">
        <span className="rm-eyebrow rm-eyebrow-accent">Live Co-Pilot</span>
        <button
          type="button"
          onClick={onDismiss}
          className="rm-icon-btn flex-shrink-0"
          style={{ width: 22, height: 22 }}
          aria-label="Dismiss insight"
        >
          <span aria-hidden="true" style={{ fontSize: 11 }}>
            ✕
          </span>
        </button>
      </div>

      <p className="rm-wrap mt-2.5" style={{ fontSize: 14.5, fontWeight: 600, lineHeight: 1.35, color: 'var(--text-primary)' }}>
        {insight.headline}
      </p>

      <p className="rm-body rm-wrap mt-2" style={{ fontSize: 13 }}>
        {insight.diagnosis}
      </p>

      {insight.evidence.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {insight.evidence.map((item, i) => (
            <p
              key={i}
              className="rm-micro rm-wrap"
              style={{ paddingLeft: 10, borderLeft: '2px solid var(--border-glass-hover)' }}
            >
              &ldquo;{item}&rdquo;
            </p>
          ))}
        </div>
      )}

      {actionLabel && (
        <div className="mt-3">
          <span className="rm-tag" style={{ color: 'var(--accent-cyan)', borderColor: 'rgba(82, 229, 232, 0.4)' }}>
            Try: {actionLabel}
          </span>
        </div>
      )}
    </motion.div>
  );
}

export default CopilotPanel;
