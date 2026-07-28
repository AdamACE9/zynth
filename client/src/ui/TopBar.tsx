import { useEffect, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { Workspace } from '../lib/api';
import { apiUrl } from '../lib/api';
import { WorkspaceTabs } from './WorkspaceTabs';
import { EASE_OUT } from './motion';
import './ui.css';

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

/** Concentric rings + a centre mark — a bearing toward a stated goal. */
function PlanIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <circle cx="12" cy="12" r="8.3" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="4" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="12" cy="12" r="1.1" fill="currentColor" />
    </svg>
  );
}

/** Clock face with its hand mid-sweep — the schedule against the syllabus. */
function TimeMachineIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <circle cx="12" cy="12.6" r="7.9" stroke="currentColor" strokeWidth="1.5" />
      <path d="M12 8.3v4.6l3 1.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.1 3.1h5.8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/** A checked clipboard — a timed paper reporting back to specific nodes. */
function ExamIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden focusable="false">
      <rect x="5" y="3.6" width="14" height="16.8" rx="2.2" stroke="currentColor" strokeWidth="1.5" />
      <path d="M9 3.6V3a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v.6" stroke="currentColor" strokeWidth="1.5" />
      <path d="m8.6 12.3 2 2 4.4-4.6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8.4 16.3h6.4" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" />
    </svg>
  );
}

interface HealthResponse {
  ok?: boolean;
  stubMode?: boolean;
}

/**
 * Polls GET /api/health once on mount and again whenever the socket
 * (re)connects, so the badge stays accurate across a backend redeploy without
 * a page reload. `null` (unknown) renders nothing — the badge only ever
 * asserts something it has actually confirmed.
 */
function useStubMode(connected: boolean): boolean | null {
  const [stubMode, setStubMode] = useState<boolean | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(apiUrl('/api/health'))
      .then((res) => (res.ok ? (res.json() as Promise<HealthResponse>) : null))
      .then((data) => {
        if (!cancelled && data && typeof data.stubMode === 'boolean') setStubMode(data.stubMode);
      })
      .catch(() => {
        // Health endpoint unreachable — the badge just stays hidden rather
        // than asserting a mode it couldn't confirm.
      });
    return () => {
      cancelled = true;
    };
  }, [connected]);

  return stubMode;
}

/**
 * Premium app chrome: the wordmark, a genuinely informative connection
 * readout, and the segmented instrument strip that opens Plan / Timeline /
 * Exam / Autopsy. Nothing else — the graph is the product, this bar exists to
 * stay out of its way. A soft top scrim keeps the type legible over bright
 * nebula without introducing a hard bar edge.
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
  const reduceMotion = useReducedMotion();
  const stubMode = useStubMode(connected);

  // Connection is chrome state, not mastery — it must never borrow red/amber
  // /green. Live reads cyan (the app's own accent); offline just dims to the
  // neutral muted ink, no colour claim at all.
  const dotColor = connected ? 'var(--accent-cyan)' : 'var(--text-muted)';
  const dotGlow = connected ? 'rgba(82, 229, 232, 0.6)' : 'transparent';

  return (
    <motion.header
      initial={reduceMotion ? false : { opacity: 0, y: -12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: reduceMotion ? 0 : 0.6, ease: EASE_OUT }}
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

          {/* Connection readout. Two independent facts, stated plainly: is the
              realtime socket up, and is the backend answering with real model
              calls or deterministic stub text (server/src/config.ts#STUB_MODE,
              surfaced via GET /api/health). */}
          <span
            className="glass-chip inline-flex shrink-0 items-center gap-2 px-2.5 py-1"
            title={
              connected
                ? stubMode
                  ? 'Realtime connection live. Backend has no Gemini key — AI features return deterministic stub text.'
                  : 'Realtime connection live.'
                : 'Realtime connection offline — the graph is showing its last known state.'
            }
          >
            <span
              aria-hidden
              className="zc-dot"
              style={{ backgroundColor: dotColor, boxShadow: `0 0 8px ${dotGlow}, 0 0 2px ${dotGlow}` }}
            />
            <span className="sr-only">Connection status: </span>
            <span className="zc-mono" style={{ color: connected ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
              {connected ? 'Live' : 'Offline'}
            </span>
            {connected && stubMode && (
              <>
                <span aria-hidden style={{ width: 1, height: 10, background: 'var(--border-glass)' }} />
                <span className="zc-mono" style={{ color: 'var(--accent-violet)' }}>
                  Stub data
                </span>
              </>
            )}
          </span>
        </div>

        {/* The four rooms, read as one segmented instrument rather than four
            separate buttons — see .zc-instrument in ui.css for the divider
            rule, which only draws at breakpoints where more than one entry
            is visible. */}
        <div className="zc-instrument glass-chip pointer-events-auto shrink-0">
          <button
            type="button"
            onClick={onOpenPlan}
            className={`zc-instrument-btn btn-chip hidden px-3 py-2 sm:flex sm:px-3.5 ${FOCUS_RING}`}
          >
            <PlanIcon />
            <span className="zc-mono" style={{ color: 'inherit' }}>
              Plan
            </span>
          </button>
          <button
            type="button"
            onClick={onOpenTimeMachine}
            className={`zc-instrument-btn btn-chip hidden px-3 py-2 lg:flex sm:px-3.5 ${FOCUS_RING}`}
          >
            <TimeMachineIcon />
            <span className="zc-mono" style={{ color: 'inherit' }}>
              Timeline
            </span>
          </button>
          <button
            type="button"
            onClick={onOpenExam}
            className={`zc-instrument-btn btn-chip hidden px-3 py-2 sm:flex sm:px-3.5 ${FOCUS_RING}`}
          >
            <ExamIcon />
            <span className="zc-mono" style={{ color: 'inherit' }}>
              Exam
            </span>
          </button>
          <button
            type="button"
            onClick={onOpenAutopsy}
            className={`zc-instrument-btn btn-chip flex px-3 py-2 sm:px-3.5 ${FOCUS_RING}`}
          >
            <AutopsyIcon />
            <span className="zc-mono" style={{ color: 'inherit' }}>
              Autopsy
            </span>
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
