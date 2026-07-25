import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Node, ServerToClientEvents, Status, WarRoomOutcome, WarRoomPersona } from '@zynth/shared';
import { STATUS_COLORS } from '@zynth/shared';
import { startWarRoomStream } from '../lib/api';
import { getSocket } from '../lib/socket';
import './rooms.css';

export interface WarRoomProps {
  node: Node;
  onClose: () => void;
  patchNode: (id: string, patch: Partial<Node>) => void;
  replaceNode: (node: Node) => void;
}

type SeatPhase = 'idle' | 'active' | 'done';

interface SeatState {
  phase: SeatPhase;
  text: string;
  startedAt: number | null;
}

/** Fixed debate order — mirrors server/src/agents/warRoomStream.ts WAR_ROOM_SEQUENCE. */
const SEAT_ORDER: WarRoomPersona[] = ['analogist', 'purist', 'real_world', 'skeptic', 'synthesis'];

const SEAT_META: Record<
  WarRoomPersona,
  { label: string; short: string; accent: string; tagline: string }
> = {
  analogist: {
    label: 'The Analogist',
    short: 'Analogist',
    accent: 'var(--accent-cyan)',
    tagline: 'makes it click',
  },
  purist: {
    label: 'The Purist',
    short: 'Purist',
    accent: 'var(--accent-violet)',
    tagline: 'keeps it exact',
  },
  real_world: {
    label: 'Real World',
    short: 'Real World',
    accent: '#f2b84b',
    tagline: 'grounds it',
  },
  skeptic: {
    label: 'The Skeptic',
    short: 'Skeptic',
    accent: '#ff6b81',
    tagline: 'stress-tests it',
  },
  synthesis: {
    label: 'Synthesis',
    short: 'Synthesis',
    accent: '#eef1fb',
    tagline: 'the verdict',
  },
};

const STATUS_LABEL: Record<Status, string> = {
  red: 'Unproven',
  amber: 'Engaged',
  green: 'Proven',
};

const OUTCOME_COPY: Record<WarRoomOutcome, { headline: string; body: string }> = {
  understood: {
    headline: 'The room reached agreement.',
    body: 'All five perspectives converged on a shared explanation — that’s worth locking in.',
  },
  still_confused: {
    headline: 'The room couldn’t fully agree.',
    body: 'There’s still some tension between perspectives here — worth a second pass before you test yourself.',
  },
};

/** Two-digit turn index, e.g. 01 — the numbered structure the roster leans on. */
function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Safety net: the personas are prompted to write plain text, but if the model
 * ever slips in markdown we strip it so the chat never shows raw ** or ` `.
 */
function stripMarkdown(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/(?<!\*)\*(?!\*)(.+?)\*(?!\*)/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s*[-*+]\s+/gm, '')
    .replace(/^\s*>\s+/gm, '')
    .replace(/[*_`]{1,2}/g, '');
}

function formatClock(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function emptySeats(): Record<WarRoomPersona, SeatState> {
  return {
    analogist: { phase: 'idle', text: '', startedAt: null },
    purist: { phase: 'idle', text: '', startedAt: null },
    real_world: { phase: 'idle', text: '', startedAt: null },
    skeptic: { phase: 'idle', text: '', startedAt: null },
    synthesis: { phase: 'idle', text: '', startedAt: null },
  };
}

/** Three-dot "typing…" indicator, tinted to the speaking persona's accent. */
function TypingDots({ color }: { color: string }) {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="rm-dot"
          style={{ background: color, width: 4, height: 4 }}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut', delay: i * 0.15 }}
        />
      ))}
    </span>
  );
}

/**
 * War Room — the live 5-persona debate. Streams token-by-token over Socket.io
 * (see server/src/agents/warRoomStream.ts) and, on convergence, plays an
 * understated "case closed" beat before handing the updated node back to the
 * graph via replaceNode.
 *
 * Visual intent: a situation room. A numbered roster rail owns identity, and
 * the transcript is a single threaded sequence of short turns — accent colour
 * carries who is speaking, the bubbles themselves stay neutral so five voices
 * never turn into five competing colour fields.
 */
export function WarRoom({ node, onClose, replaceNode }: WarRoomProps) {
  const [seats, setSeats] = useState<Record<WarRoomPersona, SeatState>>(emptySeats);
  const [activePersona, setActivePersona] = useState<WarRoomPersona | null>(null);
  const [round, setRound] = useState(0);
  const [resolved, setResolved] = useState(false);
  const [outcome, setOutcome] = useState<WarRoomOutcome | null>(null);
  const [resolvedStatus, setResolvedStatus] = useState<Status | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [retryTick, setRetryTick] = useState(0);

  const sessionIdRef = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const nearBottomRef = useRef(true);

  useEffect(() => {
    let cancelled = false;
    const socket = getSocket();

    // Fresh attempt — clear out any previous run's state.
    setSeats(emptySeats());
    setActivePersona(null);
    setRound(0);
    setResolved(false);
    setOutcome(null);
    setResolvedStatus(null);
    setConnectionError(null);
    sessionIdRef.current = null;

    const handleTurn: ServerToClientEvents['warroom:turn'] = (payload) => {
      if (payload.node_id !== node.id) return;
      if (!sessionIdRef.current || payload.session_id !== sessionIdRef.current) return;

      setSeats((prev) => {
        const current = prev[payload.persona];
        if (payload.phase === 'start') {
          return { ...prev, [payload.persona]: { phase: 'active', text: '', startedAt: Date.now() } };
        }
        if (payload.phase === 'token') {
          return { ...prev, [payload.persona]: { ...current, phase: 'active', text: current.text + payload.text } };
        }
        // 'done' — server sends the full accumulated message, trust it verbatim.
        return { ...prev, [payload.persona]: { ...current, phase: 'done', text: payload.text } };
      });

      if (payload.phase === 'start') {
        setActivePersona(payload.persona);
        setRound(SEAT_ORDER.indexOf(payload.persona) + 1);
      } else if (payload.phase === 'done') {
        setActivePersona((prev) => (prev === payload.persona ? null : prev));
      }
    };

    const handleResolved: ServerToClientEvents['warroom:resolved'] = (payload) => {
      if (payload.node_id !== node.id) return;
      if (!sessionIdRef.current || payload.session_id !== sessionIdRef.current) return;

      setActivePersona(null);
      setResolved(true);
      setOutcome(payload.outcome);
      setResolvedStatus(payload.node.status);

      // Let the "case closed" beat play before the graph updates behind us.
      window.setTimeout(() => {
        if (!cancelled) replaceNode(payload.node);
      }, 950);
    };

    socket.on('warroom:turn', handleTurn);
    socket.on('warroom:resolved', handleResolved);

    startWarRoomStream(node.id)
      .then(({ session_id }) => {
        if (!cancelled) sessionIdRef.current = session_id;
      })
      .catch((err) => {
        console.warn('[Zynth] War Room stream failed to start:', err);
        if (!cancelled) setConnectionError('Could not reach the War Room backend — is the server running?');
      });

    return () => {
      cancelled = true;
      socket.off('warroom:turn', handleTurn);
      socket.off('warroom:resolved', handleResolved);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id, retryTick]);

  // Esc closes the room from anywhere in this screen.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Track whether the reader is already near the bottom, so streaming text
  // never yanks the scroll position out from under someone reading back.
  const handleTranscriptScroll = useCallback(() => {
    const el = transcriptRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }, []);

  useEffect(() => {
    const el = transcriptRef.current;
    if (el && nearBottomRef.current) el.scrollTop = el.scrollHeight;
  });

  const started = round > 0 || resolved;
  const liveStatusColor = STATUS_COLORS[node.status];
  const finalStatusColor = resolvedStatus ? STATUS_COLORS[resolvedStatus] : liveStatusColor;
  const pillColor = resolved ? finalStatusColor : liveStatusColor;
  const spokenSeats = SEAT_ORDER.filter((p) => seats[p].phase !== 'idle');

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      className="rm-scrim pointer-events-auto flex items-stretch justify-center p-0 sm:p-6"
      style={{ '--rm-accent': 'var(--accent-cyan)' } as CSSProperties}
    >
      <motion.div
        initial={{ scale: 0.985, y: 12, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.99, y: 8, opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }}
        transition={{ type: 'spring', stiffness: 240, damping: 28 }}
        className="rm-shell h-full w-full max-w-6xl"
        role="dialog"
        aria-modal="true"
        aria-label={`War Room — ${node.label}`}
      >
        {/* Case-closed beat: a single slow sweep of light. No confetti. */}
        {resolved && <div className="wr-sweep" aria-hidden="true" />}

        {/* ---- Header ------------------------------------------------------ */}
        <header className="rm-pad rm-rule-b rm-band relative z-10 flex flex-shrink-0 flex-col gap-3.5 sm:gap-4">
          <div className="flex items-start justify-between gap-4">
            <button type="button" onClick={onClose} className="rm-btn-quiet">
              <span aria-hidden="true">←</span> Back to graph
            </button>
            <div className="flex items-center gap-2">
              <span className="rm-micro hidden sm:inline">Esc</span>
              <button type="button" onClick={onClose} className="rm-icon-btn" aria-label="Close War Room">
                <span aria-hidden="true">✕</span>
              </button>
            </div>
          </div>

          <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="min-w-0">
              <div className="rm-eyebrow">
                War Room <span aria-hidden="true">·</span> {node.subject}
              </div>
              <h2 className="rm-title rm-wrap mt-2.5">{node.label}</h2>
              <p className="rm-lead rm-optional mt-2.5 max-w-xl">
                Five AI perspectives argue this concept live until they converge on a verdict.
              </p>
            </div>

            <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
              {!resolved && round > 0 && (
                <span className="rm-tag rm-num">
                  Turn {pad2(round)} / {pad2(SEAT_ORDER.length)}
                </span>
              )}
              <motion.span className="rm-tag" animate={{ color: pillColor }} transition={{ duration: 0.4 }}>
                <motion.span
                  className="rm-dot"
                  animate={{ backgroundColor: pillColor, boxShadow: `0 0 10px ${pillColor}` }}
                  transition={{ duration: 0.4 }}
                />
                {resolved
                  ? `Case closed · ${STATUS_LABEL[resolvedStatus ?? node.status]}`
                  : started
                    ? 'Live debate'
                    : 'Connecting'}
              </motion.span>
            </div>
          </div>
        </header>

        {connectionError ? (
          /* Error state — the whole body becomes a single retry surface. */
          <div className="rm-pad relative z-10 flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
            <div className="rm-eyebrow" style={{ color: 'var(--status-red)' }}>
              Connection lost
            </div>
            <p className="rm-lead max-w-md">{connectionError}</p>
            <button type="button" onClick={() => setRetryTick((t) => t + 1)} className="rm-btn rm-btn-solid">
              Retry connection
            </button>
          </div>
        ) : (
          <div className="relative z-10 flex min-h-0 flex-1 flex-col lg:flex-row">
            {/* ---- Roster rail --------------------------------------------- */}
            <div className="wr-roster" aria-label="Debate roster">
              <div className="rm-eyebrow hidden lg:block" style={{ paddingBottom: 14 }}>
                The room
              </div>
              {SEAT_ORDER.map((persona, i) => {
                const meta = SEAT_META[persona];
                const seat = seats[persona];
                const isActive = activePersona === persona;
                const state = isActive ? 'active' : seat.phase === 'done' ? 'done' : 'idle';
                return (
                  <div
                    key={persona}
                    className="wr-seat"
                    data-state={state}
                    style={{ '--seat-accent': meta.accent } as CSSProperties}
                  >
                    <span className="wr-seat-idx">{pad2(i + 1)}</span>
                    <span className="rm-dot" style={{ background: meta.accent }} aria-hidden="true" />
                    <div className="min-w-0">
                      <div className="wr-seat-name">{meta.short}</div>
                      <div className="wr-seat-state">
                        {seat.phase === 'active' ? (
                          <>
                            <TypingDots color={meta.accent} />
                            <span>Speaking</span>
                          </>
                        ) : seat.phase === 'done' ? (
                          'Spoken'
                        ) : (
                          'Waiting'
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* ---- Transcript ---------------------------------------------- */}
            {/* The padding lives on the inner wrapper, never on the scroller
                itself: padding is not shrinkable, so a padded flex-1 scroller
                has a hard minimum height and spills over the verdict bar on
                landscape phones. */}
            <div
              ref={transcriptRef}
              onScroll={handleTranscriptScroll}
              className="rm-scroll flex-1"
              aria-live="polite"
              aria-atomic="false"
            >
              {!started ? (
                <div className="rm-pad flex h-full flex-col items-center justify-center gap-4 py-12 text-center">
                  <div className="rm-spinner h-6 w-6" aria-hidden="true" />
                  <div className="rm-eyebrow">Convening</div>
                  <p className="rm-body max-w-xs">
                    Pulling {SEAT_ORDER.length} perspectives into the room…
                  </p>
                </div>
              ) : (
                <div className="rm-pad pb-8 pt-6 sm:pt-8">
                <div className="wr-thread">
                  {spokenSeats.map((persona) => {
                    const meta = SEAT_META[persona];
                    const seat = seats[persona];
                    const isActive = activePersona === persona;
                    const isFinalWord = resolved && persona === 'synthesis';
                    const turn = SEAT_ORDER.indexOf(persona) + 1;
                    return (
                      <motion.article
                        key={persona}
                        initial={{ opacity: 0, y: 12 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ type: 'spring', stiffness: 260, damping: 30 }}
                        className="wr-msg"
                        style={{ '--seat-accent': meta.accent } as CSSProperties}
                      >
                        <span className="wr-msg-badge rm-num" aria-hidden="true">
                          {pad2(turn)}
                        </span>
                        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                          <span className="wr-msg-name">{meta.label}</span>
                          <span className="wr-msg-meta">
                            {seat.startedAt ? formatClock(seat.startedAt) : meta.tagline}
                          </span>
                        </div>
                        {seat.text ? (
                          <p className="wr-bubble" data-final={isFinalWord ? 'true' : 'false'}>
                            {stripMarkdown(seat.text)}
                            {isActive && <span className="wr-caret" aria-hidden="true" />}
                          </p>
                        ) : (
                          <span className="wr-bubble" data-final="false">
                            <TypingDots color={meta.accent} />
                          </span>
                        )}
                      </motion.article>
                    );
                  })}
                </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* ---- Verdict ------------------------------------------------------ */}
        <AnimatePresence>
          {resolved && outcome && (
            <motion.div
              key="summary"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.45, type: 'spring', stiffness: 220, damping: 28 }}
              className="rm-pad rm-rule-t rm-band-sm relative z-10 flex-shrink-0"
              aria-live="polite"
            >
              <div className="flex flex-col gap-3.5 sm:flex-row sm:items-end sm:justify-between sm:gap-5">
                <div className="min-w-0">
                  <div className="rm-eyebrow" style={{ color: finalStatusColor }}>
                    Verdict
                  </div>
                  <p className="rm-subtitle rm-wrap mt-2">{OUTCOME_COPY[outcome].headline}</p>
                  <p className="rm-body rm-optional mt-1.5 max-w-xl">{OUTCOME_COPY[outcome].body}</p>
                </div>
                <button type="button" onClick={onClose} className="rm-btn rm-btn-solid flex-shrink-0">
                  Prove it with a quiz <span aria-hidden="true">→</span>
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

export default WarRoom;
