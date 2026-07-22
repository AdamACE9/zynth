import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { Node, ServerToClientEvents, Status, WarRoomOutcome, WarRoomPersona } from '@zynth/shared';
import { STATUS_COLORS } from '@zynth/shared';
import { startWarRoomStream } from '../lib/api';
import { getSocket } from '../lib/socket';

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
}

/** Fixed debate order — mirrors server/src/agents/warRoomStream.ts WAR_ROOM_SEQUENCE. */
const SEAT_ORDER: WarRoomPersona[] = ['analogist', 'purist', 'real_world', 'skeptic', 'synthesis'];

const SEAT_META: Record<
  WarRoomPersona,
  { label: string; emoji: string; accent: string; glow: string; tagline: string }
> = {
  analogist: {
    label: 'The Analogist',
    emoji: '🧩',
    accent: 'var(--accent-cyan)',
    glow: 'rgba(82, 229, 232, 0.5)',
    tagline: 'makes it click',
  },
  purist: {
    label: 'The Purist',
    emoji: '📐',
    accent: 'var(--accent-violet)',
    glow: 'rgba(155, 123, 255, 0.5)',
    tagline: 'keeps it exact',
  },
  real_world: {
    label: 'Real World',
    emoji: '🌍',
    accent: '#f2b84b',
    glow: 'rgba(242, 184, 75, 0.5)',
    tagline: 'grounds it',
  },
  skeptic: {
    label: 'The Skeptic',
    emoji: '🔍',
    accent: '#ff6b81',
    glow: 'rgba(255, 107, 129, 0.5)',
    tagline: 'stress-tests it',
  },
  synthesis: {
    label: 'Synthesis',
    emoji: '✨',
    accent: '#eef1fb',
    glow: 'rgba(238, 241, 251, 0.4)',
    tagline: 'the verdict',
  },
};

const STATUS_LABEL: Record<Status, string> = {
  red: 'Unproven',
  amber: 'Engaged',
  green: 'Proven',
};

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

function emptySeats(): Record<WarRoomPersona, SeatState> {
  return {
    analogist: { phase: 'idle', text: '' },
    purist: { phase: 'idle', text: '' },
    real_world: { phase: 'idle', text: '' },
    skeptic: { phase: 'idle', text: '' },
    synthesis: { phase: 'idle', text: '' },
  };
}

/**
 * War Room — the live 5-persona debate. Streams token-by-token over Socket.io
 * (see server/src/agents/warRoomStream.ts) and, on convergence, plays an
 * understated "case closed" beat before handing the updated node back to the
 * graph via replaceNode.
 */
export function WarRoom({ node, onClose, replaceNode }: WarRoomProps) {
  const [seats, setSeats] = useState<Record<WarRoomPersona, SeatState>>(emptySeats);
  const [activePersona, setActivePersona] = useState<WarRoomPersona | null>(null);
  const [round, setRound] = useState(0);
  const [resolved, setResolved] = useState(false);
  const [outcome, setOutcome] = useState<WarRoomOutcome | null>(null);
  const [resolvedStatus, setResolvedStatus] = useState<Status | null>(null);
  const [connectionNote, setConnectionNote] = useState<string | null>(null);

  const sessionIdRef = useRef<string | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    let cancelled = false;
    const socket = getSocket();

    const handleTurn: ServerToClientEvents['warroom:turn'] = (payload) => {
      if (payload.node_id !== node.id) return;
      if (!sessionIdRef.current || payload.session_id !== sessionIdRef.current) return;

      setSeats((prev) => {
        const current = prev[payload.persona];
        if (payload.phase === 'start') {
          return { ...prev, [payload.persona]: { phase: 'active', text: '' } };
        }
        if (payload.phase === 'token') {
          return { ...prev, [payload.persona]: { phase: 'active', text: current.text + payload.text } };
        }
        // 'done' — server sends the full accumulated message, trust it verbatim.
        return { ...prev, [payload.persona]: { phase: 'done', text: payload.text } };
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
        if (!cancelled) setConnectionNote('Could not reach the War Room backend — is the server running?');
      });

    return () => {
      cancelled = true;
      socket.off('warroom:turn', handleTurn);
      socket.off('warroom:resolved', handleResolved);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  // Auto-scroll the transcript as new turns/tokens arrive.
  useLayoutEffect(() => {
    const el = transcriptRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const liveStatusColor = STATUS_COLORS[node.status];
  const finalStatusColor = resolvedStatus ? STATUS_COLORS[resolvedStatus] : liveStatusColor;
  const pillColor = resolved ? finalStatusColor : liveStatusColor;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      className="pointer-events-auto fixed inset-0 z-30 flex items-center justify-center p-6"
      style={{ background: 'rgba(2, 2, 8, 0.68)', backdropFilter: 'blur(6px)', WebkitBackdropFilter: 'blur(6px)' }}
    >
      <motion.div
        initial={{ scale: 0.96, y: 16, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.97, y: 12, opacity: 0, transition: { duration: 0.2, ease: 'easeIn' } }}
        transition={{ type: 'spring', stiffness: 240, damping: 28 }}
        className="glass-panel glass-panel-strong relative flex h-[88vh] w-[min(72rem,94vw)] flex-col overflow-hidden p-0"
      >
        {/* Case-closed glow pulse — plays once on resolution, then fades away. */}
        <AnimatePresence>
          {resolved && (
            <motion.div
              key="resolve-glow"
              className="pointer-events-none absolute inset-0 z-0"
              initial={{ opacity: 0 }}
              animate={{ opacity: [0, 0.9, 0] }}
              transition={{ duration: 1.4, ease: 'easeOut' }}
              style={{
                background: `radial-gradient(ellipse 70% 60% at 50% 40%, ${finalStatusColor}33, transparent 70%)`,
              }}
            />
          )}
        </AnimatePresence>

        {/* Header */}
        <div className="relative z-10 flex items-start justify-between gap-4 border-b px-7 pb-5 pt-6" style={{ borderColor: 'var(--border-glass)' }}>
          <div className="min-w-0">
            <div className="section-label">{node.subject}</div>
            <h2 className="font-display mt-1 truncate text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
              {node.label}
            </h2>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              5 minds, one concept.
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-3">
            {!resolved && round > 0 && (
              <span className="glass-chip px-2.5 py-1 text-[11px] font-medium tabular-nums" style={{ color: 'var(--text-muted)' }}>
                Round {round} / {SEAT_ORDER.length}
              </span>
            )}
            <motion.span
              className="glass-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium"
              animate={{ color: pillColor }}
              transition={{ type: 'spring', stiffness: 120, damping: 20 }}
            >
              <motion.span
                className="h-1.5 w-1.5 rounded-full"
                animate={{
                  backgroundColor: pillColor,
                  boxShadow: `0 0 8px ${pillColor}88, 0 0 2px ${pillColor}88`,
                }}
                transition={{ type: 'spring', stiffness: 120, damping: 20 }}
              />
              {resolved ? `Case closed — ${STATUS_LABEL[resolvedStatus ?? node.status]}` : 'Live debate'}
            </motion.span>
            <button
              onClick={onClose}
              className="transition-colors duration-150"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
              aria-label="Close"
            >
              {'✕'}
            </button>
          </div>
        </div>

        {connectionNote && (
          <div className="relative z-10 mx-7 mt-4 glass-chip px-3 py-2 text-[11px]" style={{ color: 'var(--status-red)' }}>
            {connectionNote}
          </div>
        )}

        {/* Seats row */}
        <div className="relative z-10 flex items-center gap-3 overflow-x-auto px-7 py-5">
          {SEAT_ORDER.map((persona, i) => {
            const meta = SEAT_META[persona];
            const seat = seats[persona];
            const isActive = activePersona === persona;
            const isFinalWord = resolved && persona === 'synthesis';
            return (
              <motion.div
                key={persona}
                initial={{ opacity: 0, y: 10 }}
                animate={{
                  opacity: resolved && !isFinalWord ? 0.55 : 1,
                  y: 0,
                  scale: isActive || isFinalWord ? 1.04 : 1,
                }}
                transition={{ delay: i * 0.06, type: 'spring', stiffness: 220, damping: 24 }}
                className="glass-chip flex shrink-0 items-center gap-2 px-3 py-2"
                style={{
                  borderColor: isActive || isFinalWord ? meta.accent : 'var(--border-glass)',
                  boxShadow: isActive || isFinalWord ? `0 0 18px ${meta.glow}` : undefined,
                }}
              >
                <span
                  className="relative flex h-6 w-6 items-center justify-center rounded-full text-xs"
                  style={{ background: `${meta.accent}22`, border: `1px solid ${meta.accent}55` }}
                >
                  {meta.emoji}
                  {isActive && (
                    <motion.span
                      className="absolute inset-0 rounded-full"
                      style={{ border: `1px solid ${meta.accent}` }}
                      animate={{ opacity: [0.7, 0, 0.7], scale: [1, 1.5, 1] }}
                      transition={{ duration: 1.3, repeat: Infinity, ease: 'easeOut' }}
                    />
                  )}
                </span>
                <div className="leading-tight">
                  <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                    {meta.label}
                  </div>
                  <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {seat.phase === 'done' ? 'done' : seat.phase === 'active' ? 'speaking…' : meta.tagline}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {/* Transcript */}
        <div ref={transcriptRef} className="relative z-10 flex-1 overflow-y-auto px-7 pb-7">
          <div className="flex flex-col gap-4">
            {SEAT_ORDER.filter((p) => seats[p].phase !== 'idle').map((persona) => {
              const meta = SEAT_META[persona];
              const seat = seats[persona];
              const isActive = activePersona === persona;
              const isFinalWord = resolved && persona === 'synthesis';
              return (
                <motion.div
                  key={persona}
                  initial={{ opacity: 0, y: 14 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ type: 'spring', stiffness: 240, damping: 28 }}
                  className="flex items-start gap-3"
                >
                  <span
                    className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm"
                    style={{ background: `${meta.accent}22`, border: `1px solid ${meta.accent}55` }}
                  >
                    {meta.emoji}
                  </span>
                  <div
                    className="glass-chip min-w-0 flex-1 px-4 py-3"
                    style={{
                      borderColor: isActive || isFinalWord ? meta.accent : 'var(--border-glass)',
                      boxShadow: isFinalWord ? `0 0 22px ${meta.glow}` : undefined,
                    }}
                  >
                    <div className="flex items-baseline gap-2">
                      <span className="text-xs font-semibold" style={{ color: meta.accent }}>
                        {meta.label}
                      </span>
                      <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                        {meta.tagline}
                      </span>
                    </div>
                    <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
                      {stripMarkdown(seat.text)}
                      {isActive && (
                        <motion.span
                          aria-hidden="true"
                          className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 align-middle"
                          style={{ background: meta.accent }}
                          animate={{ opacity: [1, 0, 1] }}
                          transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
                        />
                      )}
                    </p>
                  </div>
                </motion.div>
              );
            })}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default WarRoom;
