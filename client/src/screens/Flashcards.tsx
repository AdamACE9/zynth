import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import './rooms.css';

export interface FlashcardsProps {
  onClose: () => void;
}

// ---------------------------------------------------------------------------
// shapes — mirror server/src/services/flashcardService.ts
// ---------------------------------------------------------------------------

interface Flashcard {
  id: string;
  student_id: string;
  node_id: string;
  front: string;
  back: string;
  ease: number;
  interval_days: number;
  due_at: string;
  reps: number;
  lapses: number;
  created_at: string;
}

interface ForgeConcept {
  label: string;
  node_id: string;
  is_new: boolean;
}

interface ForgeResult {
  new_nodes: { id: string; label: string; subject: string }[];
  cards: Flashcard[];
  concepts: ForgeConcept[];
}

type Mode = 'forge' | 'review';
type Grade = 0 | 1 | 2 | 3;

const GRADE_META: Record<Grade, { label: string; hint: string; color: string }> = {
  0: { label: 'Again', hint: '<1m', color: 'var(--status-red)' },
  1: { label: 'Hard', hint: '1d', color: 'var(--status-amber)' },
  2: { label: 'Good', hint: '6d', color: 'var(--accent-cyan)' },
  3: { label: 'Easy', hint: '10d+', color: 'var(--status-green)' },
};

const SAMPLE_CHAPTER = `Implicit Differentiation
When y is defined implicitly as a function of x by an equation like x^2 + y^2 = 25, we differentiate both sides with respect to x and treat y as a function of x, applying the chain rule to any term containing y. This gives 2x + 2y(dy/dx) = 0, and solving for dy/dx yields dy/dx = -x/y.

The Chain Rule
The chain rule states that the derivative of a composite function f(g(x)) is f'(g(x)) times g'(x). It is the tool that lets us differentiate a function nested inside another function, and it is essential whenever the argument of a function is itself an expression in x rather than x alone.

Related Rates
Related rates problems use the chain rule to relate the rates of change of two or more quantities that are changing with respect to time. For example, if a ladder of length L is sliding down a wall so that x^2 + y^2 = L^2, differentiating with respect to time gives 2x(dx/dt) + 2y(dy/dt) = 0, which lets us find dy/dt from dx/dt.

Newton's Second Law
Newton's Second Law states that the net force acting on an object equals its mass times its acceleration, F = ma. Acceleration is the second derivative of position with respect to time, so this law directly connects a system's motion to the forces acting on it.

Conservation of Energy
In an isolated system, the total mechanical energy — the sum of kinetic energy one-half m v squared and potential energy — remains constant over time. Energy can convert between kinetic and potential forms, but the total does not change in the absence of friction or other non-conservative forces.`;

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatInterval(days: number): string {
  if (days <= 0) return 'now';
  if (days < 1) return '<1d';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  return `${Math.round(days / 30)} mo`;
}

/**
 * Flashcard Forge — full-screen overlay, reusing the War Room / Quiz /
 * Autopsy visual system wholesale (rooms.css). Two modes:
 *
 *   Forge  — paste (or load a sample) textbook/lecture text, extract
 *            concepts via Gemini, grow the graph with any brand-new nodes,
 *            and mint spaced-repetition cards for every concept touched.
 *   Review — work through cards whose due_at has arrived (oldest first;
 *            falls back to the newest cards on file when nothing is due
 *            yet), flipping each one and grading recall with the classic
 *            Again/Hard/Good/Easy buttons — posted straight to a real SM-2
 *            scheduler on the backend.
 */
export function Flashcards({ onClose }: FlashcardsProps) {
  const [mode, setMode] = useState<Mode>('forge');

  // ---- Forge state --------------------------------------------------------
  const [text, setText] = useState('');
  const [forging, setForging] = useState(false);
  const [forgeError, setForgeError] = useState<string | null>(null);
  const [forgeResult, setForgeResult] = useState<ForgeResult | null>(null);

  // ---- Review state ---------------------------------------------------------
  const [queue, setQueue] = useState<Flashcard[]>([]);
  const [queueLoading, setQueueLoading] = useState(false);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [current, setCurrent] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [grading, setGrading] = useState(false);
  const [reviewedCount, setReviewedCount] = useState(0);
  const [lastGrade, setLastGrade] = useState<{ interval_days: number; grade: Grade } | null>(null);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function loadDueQueue() {
    setQueueLoading(true);
    setQueueError(null);
    setCurrent(0);
    setFlipped(false);
    setLastGrade(null);
    try {
      const res = await fetch('/api/flashcards/due');
      if (!res.ok) throw new Error(`GET /api/flashcards/due responded ${res.status}`);
      const data = (await res.json()) as { cards: Flashcard[] };
      setQueue(Array.isArray(data.cards) ? data.cards : []);
    } catch (err) {
      console.warn('[Zynth] loading due flashcards failed:', err);
      setQueueError('Could not load your deck — the backend may be offline.');
      setQueue([]);
    } finally {
      setQueueLoading(false);
    }
  }

  function goToReview() {
    setMode('review');
    void loadDueQueue();
  }

  async function handleForge() {
    if (!text.trim() || forging) return;
    setForging(true);
    setForgeError(null);
    setForgeResult(null);
    try {
      const res = await fetch('/api/flashcards/forge', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      });
      if (!res.ok) throw new Error(`POST /api/flashcards/forge responded ${res.status}`);
      const data = (await res.json()) as ForgeResult;
      setForgeResult(data);
    } catch (err) {
      console.warn('[Zynth] flashcard forge failed:', err);
      setForgeError('Forge could not run — the backend may be offline. Try again.');
    } finally {
      setForging(false);
    }
  }

  const currentCard = queue[current];

  function handleFlip() {
    if (!currentCard || grading) return;
    setFlipped((f) => !f);
  }

  async function handleGrade(grade: Grade) {
    if (!currentCard || grading) return;
    setGrading(true);
    try {
      const res = await fetch('/api/flashcards/review', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ card_id: currentCard.id, grade }),
      });
      if (!res.ok) throw new Error(`POST /api/flashcards/review responded ${res.status}`);
      const data = (await res.json()) as { card: Flashcard };
      setLastGrade({ interval_days: data.card.interval_days, grade });
      setReviewedCount((c) => c + 1);
      setFlipped(false);
      setCurrent((i) => i + 1);
    } catch (err) {
      console.warn('[Zynth] flashcard review failed:', err);
      setQueueError('Could not save that review — check your connection and try again.');
    } finally {
      setGrading(false);
    }
  }

  const deckDone = mode === 'review' && !queueLoading && queue.length > 0 && current >= queue.length;
  const trimmedLength = text.trim().length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="rm-scrim rm-page flex flex-col"
      style={{ '--rm-accent': 'var(--accent-violet)' } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="Flashcard Forge"
    >
      {/* ---- Header --------------------------------------------------------- */}
      <header className="rm-rule-b flex-shrink-0">
        <div className="rm-pad rm-band-sm mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="rm-eyebrow">Grow the graph from source material</div>
            <h1 className="rm-title mt-1.5">Flashcard Forge</h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="rm-micro hidden sm:inline">Esc</span>
            <button type="button" onClick={onClose} className="rm-icon-btn" aria-label="Close flashcard forge">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>
      </header>

      {/* ---- Mode toggle ------------------------------------------------------ */}
      <div className="rm-rule-b flex-shrink-0">
        <div className="rm-pad mx-auto flex w-full max-w-4xl items-center gap-2 py-3">
          <button
            type="button"
            onClick={() => setMode('forge')}
            className={mode === 'forge' ? 'rm-btn rm-btn-solid' : 'rm-btn rm-btn-ghost'}
            style={{ padding: '7px 16px', fontSize: 12.5 }}
          >
            Forge
          </button>
          <button
            type="button"
            onClick={goToReview}
            className={mode === 'review' ? 'rm-btn rm-btn-solid' : 'rm-btn rm-btn-ghost'}
            style={{ padding: '7px 16px', fontSize: 12.5 }}
          >
            Review{queue.length > 0 ? ` (${Math.max(queue.length - current, 0)})` : ''}
          </button>
        </div>
      </div>

      {/* ---- Body ----------------------------------------------------------- */}
      <div className="rm-scroll flex-1">
        <div className="rm-pad mx-auto flex w-full max-w-4xl flex-col gap-10 py-8 sm:gap-12 sm:py-12">
          {mode === 'forge' ? (
            <>
              {!forgeResult && (
                <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                  <h2 className="rm-display max-w-2xl">Turn a chapter into a graph and a deck.</h2>
                  <p className="rm-lead mt-4 max-w-xl">
                    Paste a textbook chapter or lecture notes. Zynth extracts the concepts, matches them onto your
                    existing graph or creates brand-new nodes for anything it hasn't seen, and mints spaced-repetition
                    flashcards tagged to each one.
                  </p>
                </motion.section>
              )}

              <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="rm-eyebrow rm-eyebrow-accent">
                    {forgeResult ? 'Forge more' : 'Step 01 · Paste your source text'}
                  </div>
                  <button
                    type="button"
                    onClick={() => setText(SAMPLE_CHAPTER)}
                    disabled={forging}
                    className="rm-btn rm-btn-ghost"
                    style={{ padding: '7px 13px', fontSize: 12 }}
                  >
                    Load sample chapter
                  </button>
                </div>

                <textarea
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  disabled={forging}
                  placeholder="Paste a chapter, lecture notes, or a study guide here…"
                  rows={9}
                  className="rm-field mt-4"
                  aria-label="Source text to forge"
                />

                <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <span className="rm-micro rm-num">
                    {trimmedLength === 0 ? 'Nothing to forge yet.' : `${trimmedLength} characters ready`}
                  </span>
                  <button
                    type="button"
                    onClick={handleForge}
                    disabled={!text.trim() || forging}
                    className="rm-btn rm-btn-solid"
                  >
                    {forging ? 'Forging…' : 'Forge flashcards'}
                  </button>
                </div>
              </motion.section>

              {forging && (
                <motion.section
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rm-rule-t pt-8"
                  aria-live="polite"
                >
                  <div className="flex items-center gap-3">
                    <div className="rm-spinner h-4 w-4" aria-hidden="true" />
                    <span className="rm-eyebrow rm-eyebrow-accent">Reading the source, extracting concepts…</span>
                  </div>
                  <p className="rm-micro mt-3">Live model call — usually takes a few seconds.</p>
                </motion.section>
              )}

              {forgeError && (
                <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--status-amber)' }} role="alert">
                  <span className="rm-micro" style={{ color: 'var(--status-amber)' }}>
                    {forgeError}
                  </span>
                </div>
              )}

              {forgeResult && !forging && (
                <motion.section
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="rm-rule-t flex flex-col gap-10 pt-10 sm:gap-12"
                  aria-live="polite"
                >
                  <div>
                    <div className="rm-eyebrow rm-eyebrow-accent">Forge complete</div>
                    <div className="mt-5 grid grid-cols-3 gap-3">
                      <Stat value={forgeResult.concepts.length} label="Concepts found" />
                      <Stat value={forgeResult.new_nodes.length} label="New graph nodes" accent />
                      <Stat value={forgeResult.cards.length} label="Cards minted" />
                    </div>
                  </div>

                  <div>
                    <div className="rm-eyebrow">Concepts</div>
                    <div className="mt-4 flex flex-col gap-2">
                      {forgeResult.concepts.map((c, i) => (
                        <ConceptRow key={`${c.node_id}-${i}`} concept={c} />
                      ))}
                    </div>
                  </div>

                  <div>
                    <div className="rm-eyebrow">Cards minted</div>
                    <div className="mt-4 flex flex-col gap-2">
                      {forgeResult.cards.map((card) => (
                        <div key={card.id} className="ap-quote" style={{ borderRadius: 12 }}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600 }}>{card.front}</span>
                          <br />
                          <span style={{ color: 'var(--text-muted)' }}>{card.back}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rm-rule-t flex flex-col items-start gap-4 pt-8 sm:flex-row sm:items-center sm:justify-between">
                    <p className="rm-subtitle max-w-xl">
                      {forgeResult.cards.length} card{forgeResult.cards.length === 1 ? '' : 's'} ready to review.
                    </p>
                    <button type="button" onClick={goToReview} className="rm-btn rm-btn-solid">
                      Review now <span aria-hidden="true">→</span>
                    </button>
                  </div>
                </motion.section>
              )}
            </>
          ) : (
            <>
              {queueLoading && (
                <div className="flex flex-col items-start gap-5 py-10" aria-live="polite">
                  <div className="rm-spinner h-6 w-6" aria-hidden="true" />
                  <span className="rm-eyebrow rm-eyebrow-accent">Loading your deck…</span>
                </div>
              )}

              {!queueLoading && queueError && (
                <div className="flex flex-col items-start gap-5 py-10">
                  <div className="rm-eyebrow" style={{ color: 'var(--status-red)' }}>
                    Could not load
                  </div>
                  <p className="rm-title max-w-xl">{queueError}</p>
                  <button type="button" onClick={loadDueQueue} className="rm-btn rm-btn-solid">
                    Try again
                  </button>
                </div>
              )}

              {!queueLoading && !queueError && queue.length === 0 && (
                <div className="flex flex-col items-start gap-5 py-10">
                  <div className="rm-eyebrow rm-eyebrow-accent">Nothing to review yet</div>
                  <p className="rm-display max-w-xl">Forge a chapter first.</p>
                  <p className="rm-lead max-w-xl">
                    Once concepts are extracted and cards are minted, they show up here immediately.
                  </p>
                  <button type="button" onClick={() => setMode('forge')} className="rm-btn rm-btn-solid">
                    Go to Forge
                  </button>
                </div>
              )}

              {!queueLoading && !queueError && queue.length > 0 && !deckDone && currentCard && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <span className="rm-eyebrow rm-eyebrow-accent rm-num" aria-live="polite">
                      Card {pad2(current + 1)} / {pad2(queue.length)}
                    </span>
                    {lastGrade && (
                      <span className="rm-tag" style={{ color: GRADE_META[lastGrade.grade].color }}>
                        Last: {GRADE_META[lastGrade.grade].label} · next in {formatInterval(lastGrade.interval_days)}
                      </span>
                    )}
                  </div>

                  <AnimatePresence>
                    <motion.div
                      key={currentCard.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      className="ap-finding mt-6"
                      style={{ cursor: grading ? 'default' : 'pointer', textAlign: 'center' }}
                      onClick={handleFlip}
                      role="button"
                      tabIndex={0}
                      aria-label={flipped ? 'Showing answer, tap to show question' : 'Showing question, tap to reveal answer'}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          handleFlip();
                        }
                      }}
                    >
                      <span className="rm-eyebrow">{flipped ? 'Answer' : 'Question'}</span>
                      <p className="qz-question mt-5" style={{ minHeight: '3.5em' }}>
                        {flipped ? currentCard.back : currentCard.front}
                      </p>
                      {!flipped && <p className="rm-micro mt-6">Tap the card to reveal the answer</p>}
                    </motion.div>
                  </AnimatePresence>

                  <div className="mt-8">
                    {flipped ? (
                      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                        {([0, 1, 2, 3] as Grade[]).map((g) => (
                          <button
                            key={g}
                            type="button"
                            disabled={grading}
                            onClick={() => handleGrade(g)}
                            className="rm-btn rm-btn-ghost"
                            style={{ borderColor: GRADE_META[g].color, color: GRADE_META[g].color, flexDirection: 'column', gap: 2 }}
                          >
                            <span>{GRADE_META[g].label}</span>
                            <span className="rm-micro" style={{ color: 'inherit', opacity: 0.75 }}>
                              {GRADE_META[g].hint}
                            </span>
                          </button>
                        ))}
                      </div>
                    ) : (
                      <button type="button" onClick={handleFlip} className="rm-btn rm-btn-solid w-full">
                        Show answer
                      </button>
                    )}
                  </div>
                </div>
              )}

              {deckDone && (
                <motion.div
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex flex-col items-start gap-5 py-10"
                >
                  <div className="rm-eyebrow rm-eyebrow-accent">Deck cleared</div>
                  <p className="rm-display max-w-xl">All caught up.</p>
                  <p className="rm-lead max-w-xl">
                    You reviewed {reviewedCount} card{reviewedCount === 1 ? '' : 's'} this session. New cards will
                    surface here the moment they're due.
                  </p>
                  <div className="flex flex-col gap-2.5 sm:flex-row">
                    <button type="button" onClick={loadDueQueue} className="rm-btn rm-btn-solid">
                      Check again
                    </button>
                    <button type="button" onClick={() => setMode('forge')} className="rm-btn rm-btn-ghost">
                      Forge more
                    </button>
                  </div>
                </motion.div>
              )}
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="ap-stat">
      <span className="ap-stat-value" style={accent ? { color: 'var(--accent-violet)' } : undefined}>
        {pad2(value)}
      </span>
      <span className="rm-eyebrow" style={{ fontSize: 10 }}>
        {label}
      </span>
    </div>
  );
}

function ConceptRow({ concept }: { concept: ForgeConcept }) {
  return (
    <div
      className="flex flex-wrap items-center justify-between gap-3 rounded-xl px-4 py-3"
      style={{ border: '1px solid var(--border-glass)', background: 'rgba(255, 255, 255, 0.022)' }}
    >
      <span className="rm-body" style={{ color: 'var(--text-primary)' }}>
        {concept.label}
      </span>
      {concept.is_new ? (
        <span className="rm-tag" style={{ color: 'var(--accent-violet)' }}>
          <span className="rm-dot" style={{ background: 'var(--accent-violet)' }} />
          New node
        </span>
      ) : (
        <span className="rm-tag" style={{ color: 'var(--text-muted)' }}>
          Matched existing
        </span>
      )}
    </div>
  );
}

export default Flashcards;
