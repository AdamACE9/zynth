import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { STATUS_COLORS } from '@zynth/shared';
import './rooms.css';

export interface DebateArenaProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// Local types — mirror server/src/services/debateService.ts. lib/api.ts is
// frozen for this build, so this screen talks to the backend directly.
// ---------------------------------------------------------------------------

type DebateSide = 'student' | 'opponent';
type DebateNodeKind = 'claim' | 'rebuttal' | 'evidence' | 'concession';
type DebateStance = 'for' | 'against';

interface DebateArgumentNode {
  id: string;
  side: DebateSide;
  kind: DebateNodeKind;
  text: string;
  parent_id: string | null;
  strength?: number;
}

interface DebateScoreDimension {
  score: number;
  justification: string;
}

interface DebateScore {
  dimensions: {
    claim_clarity: DebateScoreDimension;
    evidence: DebateScoreDimension;
    rebuttal_quality: DebateScoreDimension;
    structure: DebateScoreDimension;
  };
  overall_verdict: string;
  strongest_moment: string;
  weakest_moment: string;
}

interface StartDebateResponse {
  session_id: string;
  motion: string;
  student_side: DebateStance;
  opening: string;
  tree: DebateArgumentNode[];
}

interface TakeTurnResponse {
  session_id: string;
  new_nodes: DebateArgumentNode[];
  tree: DebateArgumentNode[];
}

interface ScoreDebateResponse {
  session_id: string;
  score: DebateScore;
}

async function apiStartDebate(): Promise<StartDebateResponse> {
  const res = await fetch('/api/debate/start', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  if (!res.ok) throw new Error(`POST /api/debate/start responded ${res.status}`);
  return (await res.json()) as StartDebateResponse;
}

async function apiTakeTurn(sessionId: string, argument: string): Promise<TakeTurnResponse> {
  const res = await fetch('/api/debate/turn', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, argument }),
  });
  if (!res.ok) throw new Error(`POST /api/debate/turn responded ${res.status}`);
  return (await res.json()) as TakeTurnResponse;
}

async function apiScoreDebate(sessionId: string): Promise<ScoreDebateResponse> {
  const res = await fetch('/api/debate/score', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId }),
  });
  if (!res.ok) throw new Error(`POST /api/debate/score responded ${res.status}`);
  return (await res.json()) as ScoreDebateResponse;
}

const KIND_LABEL: Record<DebateNodeKind, string> = {
  claim: 'Claim',
  rebuttal: 'Rebuttal',
  evidence: 'Evidence',
  concession: 'Concession',
};

const DIMENSION_LABEL: Record<keyof DebateScore['dimensions'], string> = {
  claim_clarity: 'Claim clarity',
  evidence: 'Evidence',
  rebuttal_quality: 'Rebuttal quality',
  structure: 'Structure',
};

const STUDENT_ACCENT = 'var(--accent-cyan)';
const OPPONENT_ACCENT = 'var(--accent-violet)';

/** 0-10 rubric score -> the same red/amber/green vocabulary the rest of Zynth uses. */
function scoreColor(score: number): string {
  if (score >= 7) return STATUS_COLORS.green;
  if (score >= 4) return STATUS_COLORS.amber;
  return STATUS_COLORS.red;
}

/** Three-dot "thinking…" indicator — same construction as War Room/Explain's, just local. */
function ThinkingDots({ color }: { color: string }) {
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
 * One node in the argument tree, rendered recursively. Indentation + a
 * left-border connector (colour-coded by side) is the entire "graph" — plain
 * nested divs, no canvas or graph library, per the Tier 2 brief.
 */
function ArgumentNodeView({
  node,
  depth,
  childMap,
}: {
  node: DebateArgumentNode;
  depth: number;
  childMap: Map<string | null, DebateArgumentNode[]>;
}) {
  const kids = childMap.get(node.id) ?? [];
  const accent = node.side === 'student' ? STUDENT_ACCENT : OPPONENT_ACCENT;
  const indent = Math.min(depth, 7) * 18;

  return (
    <div>
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.2 }}
        style={{
          marginLeft: indent,
          borderLeft: depth > 0 ? `2px solid ${accent}` : 'none',
          paddingLeft: depth > 0 ? 14 : 0,
          marginBottom: 14,
        }}
      >
        <div className="mb-1.5 flex flex-wrap items-baseline gap-2">
          <span className="rm-eyebrow" style={{ color: accent, fontSize: 10 }}>
            {node.side === 'student' ? 'You' : 'Opponent'}
          </span>
          <span className="rm-tag" style={{ padding: '2px 8px', fontSize: 9.5 }}>
            {KIND_LABEL[node.kind]}
          </span>
          {typeof node.strength === 'number' && (
            <span className="rm-micro rm-num">strength {node.strength}/10</span>
          )}
        </div>
        <p className="wr-bubble rm-wrap" style={{ '--seat-accent': accent } as CSSProperties} data-final="false">
          {node.text}
        </p>
      </motion.div>
      {kids.map((child) => (
        <ArgumentNodeView key={child.id} node={child} depth={depth + 1} childMap={childMap} />
      ))}
    </div>
  );
}

function DimensionBar({ label, dim }: { label: string; dim: DebateScoreDimension }) {
  const color = scoreColor(dim.score);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <span className="rm-body rm-strong">{label}</span>
        <span className="rm-num" style={{ color, fontWeight: 700, fontSize: 14 }}>
          {dim.score.toFixed(1)}/10
        </span>
      </div>
      <div className="qz-meter">
        <div
          className="qz-meter-fill"
          style={{ width: `${Math.max(0, Math.min(100, dim.score * 10))}%`, background: color }}
        />
      </div>
      <p className="rm-micro rm-wrap">{dim.justification}</p>
    </div>
  );
}

/**
 * Debate Arena — the student argues a position against an AI opponent that
 * directly rebuts their specific point, turn by turn, building a real
 * argument tree (parent_id links) rather than a flat transcript. Deliberately
 * built from the same room primitives as War Room (transcript + roster
 * framing) and Explain (composer + context header) — no bespoke UI.
 */
export function DebateArena({ onClose }: DebateArenaProps) {
  const [loading, setLoading] = useState(true);
  const [startError, setStartError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [motion_, setMotion] = useState('');
  const [studentSide, setStudentSide] = useState<DebateStance>('for');
  const [tree, setTree] = useState<DebateArgumentNode[]>([]);

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [turnError, setTurnError] = useState<string | null>(null);

  const [scoring, setScoring] = useState(false);
  const [score, setScore] = useState<DebateScore | null>(null);
  const [scoreError, setScoreError] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottomRef = useRef(true);

  const studentTurnCount = useMemo(() => tree.filter((n) => n.side === 'student').length, [tree]);

  const childMap = useMemo(() => {
    const map = new Map<string | null, DebateArgumentNode[]>();
    for (const n of tree) {
      const list = map.get(n.parent_id) ?? [];
      list.push(n);
      map.set(n.parent_id, list);
    }
    return map;
  }, [tree]);
  const rootNodes = childMap.get(null) ?? [];

  async function boot() {
    setLoading(true);
    setStartError(null);
    try {
      const result = await apiStartDebate();
      setSessionId(result.session_id);
      setMotion(result.motion);
      setStudentSide(result.student_side);
      setTree(result.tree);
    } catch (err) {
      console.warn('[Zynth] debate start failed:', err);
      setStartError('Could not reach the Debate Arena backend — is the server running?');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void boot();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!loading && !startError) inputRef.current?.focus();
  }, [loading, startError]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  useEffect(() => {
    if (!nearBottomRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [tree, sending]);

  async function submitTurn(text: string) {
    const trimmed = text.trim();
    if (!trimmed || !sessionId || sending) return;

    setSending(true);
    setTurnError(null);
    setInput('');
    nearBottomRef.current = true;

    try {
      const result = await apiTakeTurn(sessionId, trimmed);
      setTree(result.tree);
    } catch (err) {
      console.warn('[Zynth] debate turn failed:', err);
      setTurnError("Couldn't reach the opponent — check the connection and try again.");
      setInput(trimmed);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submitTurn(input);
    }
  }

  async function handleScore() {
    if (!sessionId || scoring) return;
    setScoring(true);
    setScoreError(null);
    try {
      const result = await apiScoreDebate(sessionId);
      setScore(result.score);
    } catch (err) {
      console.warn('[Zynth] debate score failed:', err);
      setScoreError("Couldn't reach the grader — check the connection and try again.");
    } finally {
      setScoring(false);
    }
  }

  const sideColor = studentSide === 'for' ? STATUS_COLORS.green : STATUS_COLORS.red;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0, transition: { duration: 0.2 } }}
      className="rm-scrim flex items-stretch justify-center p-0 sm:p-6"
      style={{ '--rm-accent': STUDENT_ACCENT } as CSSProperties}
    >
      <motion.div
        initial={{ scale: 0.99, y: 8, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.99, y: 8, opacity: 0, transition: { duration: 0.15 } }}
        transition={{ type: 'spring', stiffness: 220, damping: 32 }}
        className="rm-shell pointer-events-auto h-full w-full max-w-3xl sm:h-[46rem] sm:max-h-full"
        role="dialog"
        aria-modal="true"
        aria-label="Debate Arena"
      >
        {/* ---- Header -------------------------------------------------- */}
        <header className="rm-pad rm-rule-b rm-band-sm flex flex-shrink-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <button type="button" onClick={onClose} className="rm-btn-quiet">
              <span aria-hidden="true">←</span> Back to graph
            </button>
            <div className="rm-eyebrow mt-3">Debate Arena</div>
            <h2 className="rm-subtitle rm-wrap mt-2">
              {loading ? 'Convening the opposition…' : motion_}
            </h2>
            {!loading && !startError && (
              <span className="rm-tag mt-2.5 inline-flex" style={{ color: sideColor }}>
                <span className="rm-dot" style={{ background: sideColor }} />
                You argue {studentSide.toUpperCase()}
              </span>
            )}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2 pt-0.5">
            <span className="rm-micro hidden sm:inline">Esc</span>
            <button type="button" onClick={onClose} className="rm-icon-btn" aria-label="Close Debate Arena">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </header>

        {/* ---- Body ------------------------------------------------------ */}
        {startError ? (
          <div className="rm-pad relative flex flex-1 flex-col items-center justify-center gap-5 py-10 text-center">
            <div className="rm-eyebrow" style={{ color: 'var(--status-red)' }}>
              Connection lost
            </div>
            <p className="rm-lead max-w-md">{startError}</p>
            <button type="button" onClick={() => void boot()} className="rm-btn rm-btn-solid">
              Retry connection
            </button>
          </div>
        ) : loading ? (
          <div className="rm-pad flex flex-1 flex-col items-center justify-center gap-4 py-12 text-center">
            <div className="rm-spinner h-6 w-6" aria-hidden="true" />
            <p className="rm-body max-w-xs">Your opponent is picking a motion and taking a side…</p>
          </div>
        ) : (
          <>
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="rm-scroll rm-pad flex-1 pb-4 pt-5"
              aria-live="polite"
            >
              {rootNodes.map((node) => (
                <ArgumentNodeView key={node.id} node={node} depth={0} childMap={childMap} />
              ))}

              {sending && (
                <div className="mb-1.5 flex items-center gap-2 pl-1">
                  <span className="rm-eyebrow" style={{ color: OPPONENT_ACCENT, fontSize: 10 }}>
                    Opponent
                  </span>
                  <ThinkingDots color={OPPONENT_ACCENT} />
                </div>
              )}

              {/* ---- Scorecard -------------------------------------------- */}
              <AnimatePresence initial={false}>
                {score && (
                  <motion.div
                    key="scorecard"
                    initial={{ opacity: 0, y: 16 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ type: 'spring', stiffness: 220, damping: 28 }}
                    className="mt-5 rounded-xl p-5"
                    style={{ border: '1px solid var(--border-glass)', background: 'rgba(255,255,255,0.03)' }}
                  >
                    <div className="rm-eyebrow" style={{ color: STUDENT_ACCENT }}>
                      Scorecard
                    </div>
                    <p className="rm-lead rm-wrap mt-2">{score.overall_verdict}</p>

                    <div className="mt-5 flex flex-col gap-5">
                      {(Object.keys(score.dimensions) as (keyof DebateScore['dimensions'])[]).map((key) => (
                        <DimensionBar key={key} label={DIMENSION_LABEL[key]} dim={score.dimensions[key]} />
                      ))}
                    </div>

                    <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2">
                      <div>
                        <div className="rm-eyebrow" style={{ color: STATUS_COLORS.green, fontSize: 10 }}>
                          Strongest moment
                        </div>
                        <p className="ap-quote rm-wrap mt-2">{score.strongest_moment}</p>
                      </div>
                      <div>
                        <div className="rm-eyebrow" style={{ color: STATUS_COLORS.red, fontSize: 10 }}>
                          Weakest moment
                        </div>
                        <p className="ap-quote rm-wrap mt-2">{score.weakest_moment}</p>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* ---- Composer -------------------------------------------------- */}
            <div className="rm-pad flex-shrink-0 pb-5 pt-3">
              {turnError && (
                <div className="mb-2.5 flex items-center justify-between gap-3" role="alert">
                  <span className="rm-micro" style={{ color: 'var(--status-red)' }}>
                    {turnError}
                  </span>
                  <button
                    type="button"
                    onClick={() => void submitTurn(input)}
                    className="rm-btn rm-btn-ghost flex-shrink-0"
                    style={{ padding: '6px 12px', fontSize: 12 }}
                  >
                    Retry
                  </button>
                </div>
              )}
              {scoreError && (
                <div className="mb-2.5" role="alert">
                  <span className="rm-micro" style={{ color: 'var(--status-red)' }}>
                    {scoreError}
                  </span>
                </div>
              )}
              <div className="flex items-end gap-2.5">
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={handleKeyDown}
                  disabled={sending}
                  placeholder="Make your argument…"
                  rows={1}
                  className="rm-field"
                  style={{ maxHeight: '7rem', minHeight: '2.9rem', padding: '11px 14px' }}
                  aria-label="Your argument"
                />
                <button
                  type="button"
                  onClick={() => void submitTurn(input)}
                  disabled={sending || input.trim().length === 0}
                  className="rm-btn rm-btn-solid flex-shrink-0"
                >
                  Send
                </button>
              </div>
              <div className="mt-2.5 flex items-center justify-between gap-3">
                <span className="rm-micro">
                  {studentTurnCount === 0
                    ? 'Make your opening argument to begin.'
                    : `${studentTurnCount} argument${studentTurnCount === 1 ? '' : 's'} made.`}
                </span>
                <button
                  type="button"
                  onClick={() => void handleScore()}
                  disabled={studentTurnCount === 0 || scoring}
                  className="rm-btn rm-btn-ghost flex-shrink-0"
                  style={{ padding: '8px 14px', fontSize: 12.5 }}
                >
                  {scoring ? 'Scoring…' : score ? 'Re-score debate' : 'Score debate'}
                </button>
              </div>
            </div>
          </>
        )}
      </motion.div>
    </motion.div>
  );
}

export default DebateArena;
