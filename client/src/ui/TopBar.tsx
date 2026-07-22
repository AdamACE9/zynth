import { motion } from 'motion/react';

interface TopBarProps {
  connected: boolean;
}

/** Minimal, glassy chrome — the wordmark, tagline, and a small live/demo indicator. */
export function TopBar({ connected }: TopBarProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="pointer-events-none fixed inset-x-0 top-0 z-10 flex items-start justify-between px-6 py-5"
    >
      <div className="pointer-events-auto">
        <div className="flex items-center gap-3">
          <span className="font-display bg-gradient-to-r from-cyan-300 via-sky-300 to-violet-400 bg-clip-text text-2xl font-bold tracking-tight text-transparent">
            Zynth
          </span>
          <span
            className="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider"
            style={
              connected
                ? { borderColor: 'rgba(40,224,160,0.35)', color: '#28e0a0' }
                : { borderColor: 'rgba(255,255,255,0.15)', color: 'rgba(255,255,255,0.4)' }
            }
          >
            {connected ? 'Live' : 'Demo'}
          </span>
        </div>
        <p className="mt-1 text-xs text-white/40">The truth about what you actually know.</p>
      </div>
    </motion.div>
  );
}
