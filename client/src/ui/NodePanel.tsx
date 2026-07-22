import { useEffect, useState } from 'react';
import { motion } from 'motion/react';
import type { Node, Status } from '@zynth/shared';
import { STATUS_COLORS } from '@zynth/shared';
import { engageNode } from '../lib/api';

interface NodePanelProps {
  node: Node;
  onClose: () => void;
  patchNode: (nodeId: string, patch: Partial<Node>) => void;
  replaceNode: (node: Node) => void;
  onOpenScreen: (type: 'warroom' | 'explain' | 'quiz', nodeId: string) => void;
}

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

const ACTIONS: Array<{ type: 'warroom' | 'explain' | 'quiz'; label: string; icon: string; accent: string }> = [
  { type: 'warroom', label: 'War Room', icon: '⚔️', accent: 'var(--accent-cyan)' },
  { type: 'explain', label: 'Explain', icon: '💬', accent: 'var(--accent-violet)' },
  { type: 'quiz', label: 'Quiz', icon: '📝', accent: 'var(--text-muted)' },
];

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The click-to-expand interaction shell. War Room / Explain / Quiz open the
 * matching full-screen overlay via `onOpenScreen` (wired in App.tsx to the
 * component under client/src/screens/). "Engage (demo)" is real: it POSTs
 * /api/nodes/:id/engage and, if that fails because the backend isn't
 * running, falls back to an obvious local optimistic flip so the red->amber
 * transition is always demoable.
 */
export function NodePanel({ node, onClose, patchNode, replaceNode, onOpenScreen }: NodePanelProps) {
  const [toast, setToast] = useState<string | null>(null);
  const [engaging, setEngaging] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

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
      console.warn('[Zynth] engage endpoint unreachable, applying local demo flip:', err);
      patchNode(node.id, { status: 'amber', engaged_at: new Date().toISOString() });
      setToast('Demo mode — engaged locally (backend offline).');
    } finally {
      setEngaging(false);
    }
  }

  const statusColor = STATUS_COLORS[node.status];
  const statusGlow = STATUS_GLOW[node.status];
  const meterRadius = 26;
  const meterCircumference = 2 * Math.PI * meterRadius;
  const meterOffset = meterCircumference * (1 - node.mastery_score / 100);

  return (
    <motion.div
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0, transition: { duration: 0.18, ease: 'easeIn' } }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className="glass-panel glass-panel-strong pointer-events-auto fixed right-6 top-24 z-20 w-[22rem] p-5"
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 transition-colors duration-150"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
        onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        aria-label="Close"
      >
        {'✕'}
      </button>

      <div className="section-label">{node.subject}</div>
      <h2 className="font-display mt-1 pr-6 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
        {node.label}
      </h2>

      <div className="mt-3 flex items-center gap-2">
        <span
          className="glass-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium"
          style={{ color: statusColor }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: statusColor, boxShadow: `0 0 8px ${statusGlow}, 0 0 2px ${statusGlow}` }}
          />
          {STATUS_LABEL[node.status]}
        </span>
        {node.retest_count > 0 && (
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            retested {node.retest_count}×
          </span>
        )}
      </div>

      <div className="mt-5 flex items-center gap-4">
        <svg width="64" height="64" viewBox="0 0 64 64" className="-rotate-90">
          <circle cx="32" cy="32" r={meterRadius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
          <circle
            cx="32"
            cy="32"
            r={meterRadius}
            fill="none"
            stroke={statusColor}
            strokeWidth="6"
            strokeLinecap="round"
            strokeDasharray={meterCircumference}
            strokeDashoffset={meterOffset}
            style={{
              transition: 'stroke-dashoffset 0.6s ease, stroke 0.6s ease',
              filter: `drop-shadow(0 0 6px ${statusGlow})`,
            }}
          />
        </svg>
        <div>
          <div className="font-display tabular-nums text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {node.mastery_score}
            <span className="text-sm font-normal" style={{ color: 'var(--text-muted)' }}>
              /100
            </span>
          </div>
          <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
            mastery score
          </div>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-y-2 text-xs">
        <dt style={{ color: 'var(--text-muted)' }}>Engaged</dt>
        <dd className="text-right" style={{ color: 'var(--text-secondary)' }}>
          {formatTimestamp(node.engaged_at)}
        </dd>
        <dt style={{ color: 'var(--text-muted)' }}>Last quiz pass</dt>
        <dd className="text-right" style={{ color: 'var(--text-secondary)' }}>
          {formatTimestamp(node.last_quiz_passed_at)}
        </dd>
      </dl>

      <div className="mt-5 grid grid-cols-3 gap-2">
        {ACTIONS.map((action) => (
          <button
            key={action.type}
            onClick={() => onOpenScreen(action.type, node.id)}
            className="glass-chip btn-chip flex flex-col items-center gap-1 py-2 text-xs font-medium"
            style={{ borderLeft: `2px solid ${action.accent}` }}
          >
            <span aria-hidden="true" className="text-sm leading-none">
              {action.icon}
            </span>
            {action.label}
          </button>
        ))}
      </div>

      <button
        onClick={handleEngage}
        disabled={engaging}
        className="btn-primary mt-3 w-full py-2.5 text-sm font-semibold"
      >
        {engaging ? 'Engaging…' : 'Engage (demo)'}
      </button>

      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, transition: { duration: 0.18 } }}
          className="glass-chip mt-3 px-3 py-2 text-[11px]"
          style={{ color: 'var(--text-secondary)' }}
        >
          {toast}
        </motion.div>
      )}
    </motion.div>
  );
}
