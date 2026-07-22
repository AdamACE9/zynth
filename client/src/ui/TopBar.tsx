import { motion } from 'motion/react';

interface TopBarProps {
  connected: boolean;
  onOpenAutopsy: () => void;
}

/** Minimal, glassy chrome — the wordmark, tagline, live/demo indicator, and the Autopsy entry point. */
export function TopBar({ connected, onOpenAutopsy }: TopBarProps) {
  const statusColor = connected ? 'var(--status-green)' : 'var(--text-muted)';
  const statusGlow = connected ? 'var(--status-green-glow)' : 'transparent';

  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="pointer-events-none fixed inset-x-0 top-0 z-10 flex items-start justify-between px-6 py-5"
    >
      <div className="pointer-events-auto">
        <div className="flex items-center gap-3">
          <span className="text-wordmark">Zynth</span>
          <span
            className="glass-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider"
            style={{ color: statusColor }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{
                backgroundColor: statusColor,
                boxShadow: `0 0 8px ${statusGlow}, 0 0 2px ${statusGlow}`,
              }}
            />
            {connected ? 'Live' : 'Demo'}
          </span>
        </div>
        <p className="mt-1.5 text-xs" style={{ color: 'var(--text-secondary)' }}>
          The truth about what you actually know.
        </p>
      </div>

      <button
        onClick={onOpenAutopsy}
        className="glass-chip btn-chip pointer-events-auto flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium"
      >
        <span aria-hidden="true">🩻</span>
        Autopsy
      </button>
    </motion.div>
  );
}
