import { motion } from 'motion/react';
import type { Workspace } from '../lib/api';
import { WorkspaceTabs } from './WorkspaceTabs';

interface TopBarProps {
  connected: boolean;
  onOpenAutopsy: () => void;
  /** Study-Plan Board — the route across the graph toward a stated goal. */
  onOpenPlan: () => void;
  /** Exam Simulator — a timed paper that reports back to specific nodes. */
  onOpenExam: () => void;
  /** Curriculum Time-Machine — the schedule against the syllabus. */
  onOpenTimeMachine: () => void;
  /** A different workspace was activated — the caller must refetch the graph. */
  onWorkspaceSwitched: (workspace: Workspace) => void;
  /** The tab strip's "+" — hands off to the newWorkspace onboarding flow. */
  onCreateWorkspace: () => void;
}

const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-void)]';

/** Three-node constellation — the app mark. Deliberately tiny and quiet. */
function ZynthMark() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path d="M5.6 7.4 12 4.2l6.4 3.2M5.6 7.4v9.2L12 19.8l6.4-3.2V7.4" stroke="var(--accent-violet)" strokeOpacity="0.5" strokeWidth="1" />
      <circle cx="12" cy="4.2" r="2.1" fill="var(--accent-cyan)" />
      <circle cx="5.6" cy="16.6" r="1.7" fill="var(--accent-violet)" />
      <circle cx="18.4" cy="16.6" r="1.7" fill="var(--accent-violet)" fillOpacity="0.65" />
    </svg>
  );
}

/** Scan brackets + a pulse line — reads as "post-mortem on your mistakes". */
function AutopsyIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <path
        d="M3.5 8.5v-3a2 2 0 0 1 2-2h3M20.5 8.5v-3a2 2 0 0 0-2-2h-3M3.5 15.5v3a2 2 0 0 0 2 2h3M20.5 15.5v3a2 2 0 0 1-2 2h-3"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <path d="M3.5 12h4l2-3.2 2.6 6.4L14.4 12h6.1" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/**
 * Premium app chrome: the wordmark, the realtime connection state, and the
 * Autopsy entry point. Nothing else — the graph is the product, this bar
 * exists to stay out of its way. A soft top scrim keeps the type legible over
 * bright nebula without introducing a hard bar edge.
 */
export function TopBar({
  connected,
  onOpenAutopsy,
  onOpenPlan,
  onOpenExam,
  onOpenTimeMachine,
  onWorkspaceSwitched,
  onCreateWorkspace,
}: TopBarProps) {
  const statusColor = connected ? 'var(--status-green)' : 'var(--text-muted)';
  const statusGlow = connected ? 'var(--status-green-glow)' : 'transparent';

  return (
    <motion.header
      initial={{ opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="pointer-events-none fixed inset-x-0 top-0 z-10"
    >
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-24"
        style={{ background: 'linear-gradient(180deg, rgba(3,3,8,0.72) 0%, rgba(3,3,8,0.28) 55%, rgba(3,3,8,0) 100%)' }}
      />

      <div className="relative flex items-center justify-between gap-3 px-4 py-4 sm:px-6 sm:py-5">
        <div className="pointer-events-auto flex min-w-0 items-center gap-2.5 sm:gap-3">
          <ZynthMark />
          <span className="text-wordmark" style={{ fontSize: 22 }}>
            Zynth
          </span>

          <span
            className="glass-chip inline-flex shrink-0 items-center gap-1.5 px-2.5 py-1"
            style={{ color: statusColor, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase' }}
            title={connected ? 'Realtime connection live' : 'Realtime connection offline'}
          >
            <span
              aria-hidden
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: statusColor, boxShadow: `0 0 8px ${statusGlow}, 0 0 2px ${statusGlow}` }}
            />
            <span className="sr-only">Connection status: </span>
            {connected ? 'Live' : 'Offline'}
          </span>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onOpenPlan}
            className={`glass-chip btn-chip pointer-events-auto hidden shrink-0 items-center gap-2 px-3 py-2 sm:flex sm:px-3.5 ${FOCUS_RING}`}
            style={{ fontSize: 12.5, fontWeight: 600 }}
          >
            Plan
          </button>
          <button
            type="button"
            onClick={onOpenTimeMachine}
            className={`glass-chip btn-chip pointer-events-auto hidden shrink-0 items-center gap-2 px-3 py-2 lg:flex sm:px-3.5 ${FOCUS_RING}`}
            style={{ fontSize: 12.5, fontWeight: 600 }}
          >
            Timeline
          </button>
          <button
            type="button"
            onClick={onOpenExam}
            className={`glass-chip btn-chip pointer-events-auto hidden shrink-0 items-center gap-2 px-3 py-2 sm:flex sm:px-3.5 ${FOCUS_RING}`}
            style={{ fontSize: 12.5, fontWeight: 600 }}
          >
            Exam
          </button>
          <button
            type="button"
            onClick={onOpenAutopsy}
            className={`glass-chip btn-chip pointer-events-auto flex shrink-0 items-center gap-2 px-3 py-2 sm:px-3.5 ${FOCUS_RING}`}
            style={{ fontSize: 12.5, fontWeight: 600 }}
          >
            <AutopsyIcon />
            Autopsy
          </button>
        </div>
      </div>

      {/* Workspace tabs — a quiet second row so the graph stays the hero.
          Renders nothing until at least one workspace loads. */}
      <div className="relative flex px-4 pb-3 sm:px-6">
        <WorkspaceTabs onWorkspaceSwitched={onWorkspaceSwitched} onCreateWorkspace={onCreateWorkspace} />
      </div>
    </motion.header>
  );
}
