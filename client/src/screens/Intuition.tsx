import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import type { IntuitionSpec, Node } from '@zynth/shared';
import { engageNode, fetchIntuition } from '../lib/api';
import { IntuitionVisual, type PlottedCurve } from './IntuitionVisual';
import { EASE_OUT } from '../ui/motion';
import './rooms.css';

/**
 * Intuition — the visual, interactive understanding step. Replaces War Room.
 *
 * War Room asked five AI personas to explain a concept in prose: five uncapped
 * paragraphs, streamed in sequence, to reach the same red→amber outcome as one
 * click of Explain. A student could read the textbook faster. This screen is the
 * answer to "then why would anyone use it?" — about forty words of reading, one
 * thing to drag, and one prediction the student must commit to before the answer
 * is shown.
 *
 * Three acts:
 *   explore  drag the slider, watch the relationship move
 *   predict  commit to what happens — no going back, that is the point
 *   reveal   reality drawn against your guess, with the one-line reason
 *
 * Committing to a prediction is what earns red→amber, via the same
 * POST /nodes/:id/engage → statusService.engageNode path Explain uses. This
 * screen contains no status logic of its own, and the amber→green route is
 * untouched: the only way on from here is "Prove it" → Quiz.
 */

export interface IntuitionProps {
  node: Node;
  onClose: () => void;
  patchNode: (nodeId: string, patch: Partial<Node>) => void;
  replaceNode: (node: Node) => void;
  onOpenScreen: (type: 'quiz' | 'explain', nodeId: string) => void;
}

type Phase = 'loading' | 'explore' | 'predict' | 'reveal';

export function Intuition({ node, onClose, replaceNode, onOpenScreen }: IntuitionProps) {
  const [spec, setSpec] = useState<IntuitionSpec | null>(null);
  const [phase, setPhase] = useState<Phase>('loading');
  const [t, setT] = useState(0);
  const [chosenId, setChosenId] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  // ---- Load the spec -------------------------------------------------------
  useEffect(() => {
    let cancelled = false;
    setPhase('loading');
    setFailed(false);

    fetchIntuition(node.id)
      .then((next) => {
        if (cancelled) return;
        setSpec(next);
        // Start mid-range so the first drag can go either way — starting at the
        // minimum makes half the slider's travel invisible.
        setT(next.param.min + (next.param.max - next.param.min) / 2);
        setPhase('explore');
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });

    return () => {
      cancelled = true;
    };
  }, [node.id]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const correctOption = useMemo(
    () => spec?.predict.options.find((o) => o.id === spec.predict.correct_id) ?? null,
    [spec],
  );
  const chosenOption = useMemo(
    () => spec?.predict.options.find((o) => o.id === chosenId) ?? null,
    [spec, chosenId],
  );
  const wasRight = chosenId !== null && spec !== null && chosenId === spec.predict.correct_id;

  /**
   * Committing to a prediction is the engagement. Fired once, and deliberately
   * not awaited before revealing — the student sees the answer immediately and
   * the node turns amber underneath them. A failed engage is swallowed: the
   * graph is the source of truth and a socket update will correct it.
   */
  const commit = useCallback(
    (optionId: string) => {
      setChosenId(optionId);
      setPhase('reveal');
      engageNode(node.id)
        .then(replaceNode)
        .catch(() => {
          /* graph state stays authoritative */
        });
    },
    [node.id, replaceNode],
  );

  // ---- The reveal overlay: reality vs the student's guess -------------------
  const overlay: PlottedCurve[] = useMemo(() => {
    if (phase !== 'reveal' || !spec || spec.kind !== 'curves' || !correctOption?.expr) return [];

    const curves: PlottedCurve[] = [
      { id: 'truth', label: 'What actually happens', expr: correctOption.expr, tone: 'truth' },
    ];
    // Only draw the guess when it was wrong — otherwise it is the same line
    // twice, which reads as a rendering glitch rather than a correct answer.
    if (!wasRight && chosenOption?.expr) {
      curves.push({ id: 'guess', label: 'Your prediction', expr: chosenOption.expr, tone: 'prediction' });
    }
    return curves;
  }, [phase, spec, correctOption, chosenOption, wasRight]);

  const paramLabel = spec ? `${spec.param.label}${spec.param.unit ? ` (${spec.param.unit})` : ''}` : '';
  const tDisplay = spec
    ? spec.kind === 'stages'
      ? `${Math.round(t) + 1} / ${spec.stages.length}`
      : `${t.toFixed(spec.param.step < 1 ? 1 : 0)}${spec.param.unit ? ` ${spec.param.unit}` : ''}`
    : '';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="rm-scrim flex items-center justify-center p-0 sm:p-6"
      style={{ '--rm-accent': 'var(--accent-cyan)' } as CSSProperties}
    >
      <motion.div
        initial={{ scale: 0.99, y: 8, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.99, y: 8, opacity: 0, transition: { duration: 0.15 } }}
        transition={{ type: 'spring', stiffness: 220, damping: 32 }}
        className="rm-shell pointer-events-auto h-full w-full max-w-3xl sm:h-auto sm:max-h-full"
        role="dialog"
        aria-modal="true"
        aria-label={`Intuition — ${node.label}`}
      >
        {/* ---- Header ------------------------------------------------------- */}
        <header className="rm-pad rm-rule-b rm-band-sm flex flex-shrink-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <button type="button" onClick={onClose} className="rm-btn-quiet">
              <span aria-hidden="true">←</span> Back to graph
            </button>
            <div className="rm-eyebrow mt-3">
              Intuition <span aria-hidden="true">·</span> {node.subject}
            </div>
            <h2 className="rm-subtitle rm-wrap mt-2">{spec?.title ?? node.label}</h2>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2 pt-0.5">
            {spec && !spec.generated && (
              <span className="rm-tag" title="No model key — showing a built-in visual for this subject.">
                Built-in
              </span>
            )}
            <span className="rm-micro hidden sm:inline">Esc</span>
            <button type="button" onClick={onClose} className="rm-icon-btn" aria-label="Close Intuition">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </header>

        <div className="rm-scroll rm-pad flex flex-col gap-5">
          {phase === 'loading' && !failed && (
            <div className="iv-placeholder">
              <span className="rm-spinner" aria-hidden />
              <p className="rm-body mt-3">Building a visual for this concept…</p>
            </div>
          )}

          {failed && (
            <div className="iv-placeholder">
              <p className="rm-body">Couldn't build a visual for this concept.</p>
              <button type="button" onClick={() => onOpenScreen('explain', node.id)} className="rm-btn rm-btn-solid mt-4">
                Ask the tutor instead
              </button>
            </div>
          )}

          {spec && phase !== 'loading' && (
            <>
              {/* ---- The visual ------------------------------------------- */}
              <div className="iv-frame">
                <IntuitionVisual
                  spec={spec}
                  t={phase === 'reveal' && spec.kind === 'stages' ? t : t}
                  overlay={overlay}
                  soloOverlay={phase === 'reveal' && spec.kind === 'curves'}
                  predictedStageId={phase === 'reveal' ? chosenOption?.stage_id ?? null : null}
                />
              </div>

              {/* ---- Act 1: explore ------------------------------------------ */}
              {phase === 'explore' && (
                <motion.div
                  key="explore"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: EASE_OUT }}
                  className="flex flex-col gap-4"
                >
                  <p className="rm-lead">{spec.caption}</p>

                  <label className="iv-slider-row">
                    <span className="rm-eyebrow">{paramLabel}</span>
                    <input
                      type="range"
                      min={spec.param.min}
                      max={spec.param.max}
                      step={spec.param.step}
                      value={t}
                      onChange={(e) => setT(Number(e.target.value))}
                      className="iv-slider"
                      aria-label={paramLabel}
                    />
                    <span className="rm-num iv-slider-value">{tDisplay}</span>
                  </label>

                  <button type="button" onClick={() => setPhase('predict')} className="rm-btn rm-btn-solid self-start">
                    I see it — test me →
                  </button>
                </motion.div>
              )}

              {/* ---- Act 2: predict ----------------------------------------- */}
              {phase === 'predict' && (
                <motion.div
                  key="predict"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.4, ease: EASE_OUT }}
                  className="flex flex-col gap-3"
                >
                  <p className="rm-lead">{spec.predict.question}</p>
                  <div className="iv-options">
                    {spec.predict.options.map((o) => (
                      <button key={o.id} type="button" onClick={() => commit(o.id)} className="iv-option">
                        {o.label}
                      </button>
                    ))}
                  </div>
                  <p className="rm-micro">Commit to one — you'll see what actually happens.</p>
                </motion.div>
              )}

              {/* ---- Act 3: reveal ------------------------------------------ */}
              {phase === 'reveal' && (
                <motion.div
                  key="reveal"
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.45, ease: EASE_OUT }}
                  className="flex flex-col gap-4"
                >
                  <div className="iv-verdict" data-right={wasRight || undefined}>
                    <span className="iv-verdict-mark" aria-hidden>
                      {wasRight ? '✓' : '→'}
                    </span>
                    <div className="min-w-0">
                      <p className="rm-strong">
                        {wasRight
                          ? 'Right.'
                          : // The model's option labels often end in a full stop, which would
                            // read as `it's "…".` — strip trailing punctuation before quoting.
                            `Not quite — it's "${(correctOption?.label ?? '').replace(/[.!?]+$/, '')}".`}
                      </p>
                      <p className="rm-body mt-1">{spec.predict.why}</p>
                    </div>
                  </div>

                  {spec.kind === 'curves' && (
                    <div className="iv-legend">
                      <span className="iv-legend-item" data-tone="truth">
                        What actually happens
                      </span>
                      {!wasRight && chosenOption?.expr && (
                        <span className="iv-legend-item" data-tone="prediction">
                          Your prediction
                        </span>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onOpenScreen('quiz', node.id)}
                      className="rm-btn rm-btn-solid"
                    >
                      Prove it →
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPhase('explore');
                        setChosenId(null);
                      }}
                      className="rm-btn rm-btn-ghost"
                    >
                      Play with it again
                    </button>
                    <button type="button" onClick={() => onOpenScreen('explain', node.id)} className="rm-btn rm-btn-ghost">
                      Still unsure
                    </button>
                  </div>

                  <p className="rm-micro">
                    This concept is now <strong>amber</strong> — engaged, not yet proven. Only a passed quiz turns it green.
                  </p>
                </motion.div>
              )}
            </>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
