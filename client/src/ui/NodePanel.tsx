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
}

const STATUS_LABEL: Record<Status, string> = {
  red: 'Unproven',
  amber: 'Engaged',
  green: 'Proven',
};

function formatTimestamp(value: string | null): string {
  if (!value) return '—';
  return new Date(value).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

/**
 * The click-to-expand interaction shell. War Room / Explain / Quiz are stubs
 * (Day 2 wires the real screens) — they surface a toast. "Engage (demo)" is
 * real: it POSTs /api/nodes/:id/engage and, if that fails because the
 * backend isn't running, falls back to an obvious local optimistic flip so
 * the red->amber transition is always demoable.
 */
export function NodePanel({ node, onClose, patchNode, replaceNode }: NodePanelProps) {
  const [toast, setToast] = useState<string | null>(null);
  const [engaging, setEngaging] = useState(false);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2200);
    return () => clearTimeout(timer);
  }, [toast]);

  function comingSoon(feature: string) {
    setToast(`${feature} — coming Day 2`);
  }

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
  const meterRadius = 26;
  const meterCircumference = 2 * Math.PI * meterRadius;
  const meterOffset = meterCircumference * (1 - node.mastery_score / 100);

  return (
    <motion.div
      initial={{ x: 60, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 60, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 260, damping: 30 }}
      className="pointer-events-auto fixed right-6 top-24 z-20 w-[22rem] rounded-2xl border border-white/10 bg-[#0b0d1acc] p-5 shadow-[0_8px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl"
    >
      <button
        onClick={onClose}
        className="absolute right-4 top-4 text-white/40 transition hover:text-white"
        aria-label="Close"
      >
        {'✕'}
      </button>

      <div className="text-[11px] uppercase tracking-[0.2em] text-white/40">{node.subject}</div>
      <h2 className="font-display mt-1 pr-6 text-xl font-semibold text-white">{node.label}</h2>

      <div className="mt-3 flex items-center gap-2">
        <span
          className="inline-flex items-center gap-1.5 rounded-full border border-white/10 px-2.5 py-1 text-xs font-medium"
          style={{ color: statusColor }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: statusColor, boxShadow: `0 0 8px ${statusColor}` }}
          />
          {STATUS_LABEL[node.status]}
        </span>
        {node.retest_count > 0 && <span className="text-xs text-white/40">retested {node.retest_count}×</span>}
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
            style={{ transition: 'stroke-dashoffset 0.6s ease, stroke 0.6s ease' }}
          />
        </svg>
        <div>
          <div className="text-2xl font-semibold text-white">
            {node.mastery_score}
            <span className="text-sm text-white/40">/100</span>
          </div>
          <div className="text-xs text-white/40">mastery score</div>
        </div>
      </div>

      <dl className="mt-5 grid grid-cols-2 gap-y-2 text-xs">
        <dt className="text-white/40">Engaged</dt>
        <dd className="text-right text-white/80">{formatTimestamp(node.engaged_at)}</dd>
        <dt className="text-white/40">Last quiz pass</dt>
        <dd className="text-right text-white/80">{formatTimestamp(node.last_quiz_passed_at)}</dd>
      </dl>

      <div className="mt-5 grid grid-cols-3 gap-2">
        <button
          onClick={() => comingSoon('War Room')}
          className="rounded-lg border border-cyan-400/20 bg-cyan-400/5 py-2 text-xs font-medium text-cyan-200 transition hover:bg-cyan-400/10"
        >
          War Room
        </button>
        <button
          onClick={() => comingSoon('Explain')}
          className="rounded-lg border border-violet-400/20 bg-violet-400/5 py-2 text-xs font-medium text-violet-200 transition hover:bg-violet-400/10"
        >
          Explain
        </button>
        <button
          onClick={() => comingSoon('Quiz')}
          className="rounded-lg border border-white/10 bg-white/5 py-2 text-xs font-medium text-white/80 transition hover:bg-white/10"
        >
          Quiz
        </button>
      </div>

      <button
        onClick={handleEngage}
        disabled={engaging}
        className="mt-3 w-full rounded-lg bg-gradient-to-r from-cyan-500/80 to-violet-500/80 py-2.5 text-sm font-medium text-white transition hover:from-cyan-500 hover:to-violet-500 disabled:opacity-50"
      >
        {engaging ? 'Engaging…' : 'Engage (demo)'}
      </button>

      {toast && (
        <motion.div
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          className="mt-3 rounded-md border border-white/10 bg-black/40 px-3 py-2 text-[11px] text-white/70"
        >
          {toast}
        </motion.div>
      )}
    </motion.div>
  );
}
