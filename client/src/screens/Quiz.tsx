import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Node, QuizQuestion } from '@zynth/shared';
import { QUIZ_PASS_THRESHOLD, STATUS_COLORS } from '@zynth/shared';
import { generateQuiz, submitQuiz } from '../lib/api';
import { CopilotPanel } from '../ui/CopilotPanel';
import './rooms.css';

export interface QuizProps {
  node: Node;
  onClose: () => void;
  patchNode: (nodeId: string, patch: Partial<Node>) => void;
  replaceNode: (node: Node) => void;
}

type Phase = 'loading' | 'error' | 'answering' | 'submitting' | 'results';

interface PerQuestionResult {
  id: string;
  is_correct: boolean;
}

const LOADING_LINES = [
  'Reading the concept…',
  'Drafting questions with Gemini…',
  'Sanity-checking the answer key…',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Full-page quiz overlay — the only path to a green/mastered node. Flow:
 * generate (Gemini, live) -> answer, one question at a time (mcq single-select
 * / free-response textarea) -> submit (Groq-graded) -> results (score, pass/fail,
 * per-question explanations, replaceNode(green) on pass).
 *
 * Visual intent: high-stakes and singular. One question owns the viewport at a
 * large size, a hairline progress bar runs the top edge, and the result screen
 * makes the score the hero — one enormous numeral against the 70% threshold.
 */
export function Quiz({ node, onClose, patchNode, replaceNode }: QuizProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadingLine, setLoadingLine] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);
  const [score, setScore] = useState(0);
  const [passed, setPassed] = useState(false);
  const [perQuestion, setPerQuestion] = useState<PerQuestionResult[]>([]);
  const [gradedQuestions, setGradedQuestions] = useState<QuizQuestion[]>([]);
  const [confirmingClose, setConfirmingClose] = useState(false);

  // Live Co-Pilot wiring — quiz_id doubles as the copilot session_id.
  const [sessionId, setSessionId] = useState<string | null>(null);
  const shownAtRef = useRef<Record<string, number>>({});
  const revisionCountsRef = useRef<Record<string, number>>({});
  const postedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = setInterval(() => {
      setLoadingLine((i) => (i + 1) % LOADING_LINES.length);
    }, 1400);
    return () => clearInterval(timer);
  }, [phase]);

  async function load() {
    setPhase('loading');
    setError(null);
    try {
      const { quiz_id, questions: qs } = await generateQuiz([node.id]);
      setQuestions(qs);
      setAnswers({});
      setCurrentIndex(0);
      shownAtRef.current = {};
      revisionCountsRef.current = {};
      postedIdsRef.current = new Set();
      setSessionId(quiz_id);
      setPhase('answering');
    } catch (err) {
      console.warn('[Zynth] quiz generation failed:', err);
      setError('Could not generate the quiz. The tutor may be offline — try again.');
      setPhase('error');
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [node.id]);

  // Live Co-Pilot: stamp the moment each question first becomes current
  // (once per question) — used to compute latency_ms when it's committed.
  useEffect(() => {
    const q = questions[currentIndex];
    if (q && shownAtRef.current[q.id] === undefined) {
      shownAtRef.current[q.id] = Date.now();
    }
  }, [currentIndex, questions]);

  const answeredIds = useMemo(
    () => new Set(questions.filter((q) => (answers[q.id] ?? '').trim().length > 0).map((q) => q.id)),
    [questions, answers],
  );
  const allAnswered = questions.length > 0 && answeredIds.size === questions.length;
  const hasAnyAnswer = answeredIds.size > 0;
  const currentQuestion = questions[currentIndex] as QuizQuestion | undefined;
  const isLastQuestion = currentIndex === questions.length - 1;

  function setAnswer(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
    revisionCountsRef.current[questionId] = (revisionCountsRef.current[questionId] ?? 0) + 1;
  }

  /**
   * Live Co-Pilot: posts the "first commit" of one question's answer to
   * POST /api/quiz/answer — fired exactly once per question (guarded by
   * postedIdsRef), the first time the student moves off it (or hits Submit
   * while viewing it). Fire-and-forget: never blocks quiz navigation, and a
   * network failure here must never break the quiz itself — the bulk
   * /quiz/submit grading path is completely independent of this.
   */
  function commitAnswer(questionId: string) {
    if (!sessionId || postedIdsRef.current.has(questionId)) return;
    const value = (answers[questionId] ?? '').trim();
    if (value.length === 0) return;
    const question = questions.find((q) => q.id === questionId);
    if (!question) return;
    postedIdsRef.current.add(questionId);

    const sessionIndex = questions.findIndex((q) => q.id === questionId);
    const nodeQuestions = questions.filter((q) => q.node_id === question.node_id);
    const nodeIndex = nodeQuestions.findIndex((q) => q.id === questionId);
    const shownAt = shownAtRef.current[questionId];
    const latencyMs = shownAt !== undefined ? Date.now() - shownAt : undefined;
    const revisionCount = Math.max(0, (revisionCountsRef.current[questionId] ?? 1) - 1);

    fetch('/api/quiz/answer', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_id: sessionId,
        question_id: questionId,
        node_id: question.node_id,
        question_type: question.question_type ?? 'mcq',
        session_index: sessionIndex,
        node_index: nodeIndex,
        given_answer: answers[questionId] ?? '',
        latency_ms: latencyMs,
        revision_count: revisionCount,
      }),
    }).catch((err) => {
      console.warn('[Zynth] Live Co-Pilot answer post failed (quiz itself is unaffected):', err);
    });
  }

  function goTo(index: number) {
    if (index < 0 || index >= questions.length) return;
    if (currentQuestion) commitAnswer(currentQuestion.id);
    setCurrentIndex(index);
  }

  /** Close attempts mid-quiz warn if answers would be lost; otherwise close right away. */
  function requestClose() {
    if (phase === 'answering' && hasAnyAnswer) {
      setConfirmingClose(true);
      return;
    }
    onClose();
  }

  async function handleSubmit() {
    if (!allAnswered) return;
    // The question currently in view was never "navigated away from", so it
    // was never committed to the Live Co-Pilot — commit it now, before grading.
    if (currentQuestion) commitAnswer(currentQuestion.id);
    setPhase('submitting');
    try {
      const payload: QuizQuestion[] = questions.map((q) => ({ ...q, given_answer: answers[q.id] ?? '' }));
      const result = await submitQuiz({ node_ids: [node.id], questions: payload });
      setScore(result.session.score);
      setPassed(result.session.passed);
      setPerQuestion(result.per_question);
      setGradedQuestions(result.session.questions);
      const updatedNode = result.updated.find((n) => n.id === node.id);
      if (result.session.passed && updatedNode) {
        replaceNode(updatedNode);
      } else if (updatedNode) {
        // Failed retest still carries a status update (e.g. green->amber) — keep it in sync.
        replaceNode(updatedNode);
      } else {
        // No matching node came back (shouldn't happen) — at least reflect the raw score locally.
        patchNode(node.id, {
          last_quiz_result: { passed: result.session.passed, score: result.session.score, at: result.session.created_at },
        });
      }
      setPhase('results');
    } catch (err) {
      console.warn('[Zynth] quiz submission failed:', err);
      setError('Could not grade the quiz. Check your connection and try submitting again.');
      setPhase('answering');
    }
  }

  // Esc closes (through the same unsaved-answers guard); ignored while a
  // confirm dialog or a textarea is capturing input.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key !== 'Escape') return;
      if (confirmingClose) {
        setConfirmingClose(false);
        return;
      }
      requestClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [confirmingClose, phase, hasAnyAnswer]);

  // MCQ keyboard support: 1-9 to pick a choice, arrows to move the selection,
  // Enter to advance/submit. Disabled while a textarea has focus so free
  // response typing (and its own Enter-for-newline) is never intercepted.
  useEffect(() => {
    if (phase !== 'answering' || !currentQuestion) return;

    function onKeyDown(e: KeyboardEvent) {
      const active = document.activeElement;
      const typingInField = active instanceof HTMLTextAreaElement || active instanceof HTMLInputElement;
      const q = currentQuestion;
      if (!q) return;

      if (e.key === 'Enter' && !typingInField) {
        e.preventDefault();
        if (isLastQuestion) {
          if (allAnswered) handleSubmit();
        } else if ((answers[q.id] ?? '').trim().length > 0) {
          goTo(currentIndex + 1);
        }
        return;
      }

      if (q.question_type !== 'mcq' || typingInField) return;
      const choices = q.choices ?? [];

      if (/^[1-9]$/.test(e.key)) {
        const idx = Number(e.key) - 1;
        const choice = choices[idx];
        if (choice !== undefined) setAnswer(q.id, choice);
        return;
      }

      if (['ArrowDown', 'ArrowRight', 'ArrowUp', 'ArrowLeft'].includes(e.key)) {
        e.preventDefault();
        const dir = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : -1;
        const current = choices.indexOf(answers[q.id] ?? '');
        const next = current === -1 ? (dir === 1 ? 0 : choices.length - 1) : (current + dir + choices.length) % choices.length;
        const choice = choices[next];
        if (choice !== undefined) setAnswer(q.id, choice);
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, currentQuestion, currentIndex, answers, isLastQuestion, allAnswered]);

  const answering = phase === 'answering' || phase === 'submitting';
  const progressPct =
    phase === 'results' ? 100 : questions.length === 0 ? 0 : ((currentIndex + 1) / questions.length) * 100;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="rm-scrim rm-page flex flex-col"
      style={{ '--rm-accent': 'var(--accent-cyan)' } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label={`Quiz — ${node.label}`}
    >
      {/* Hairline progress along the very top edge — the only always-on chrome. */}
      <div className="qz-progress" aria-hidden="true">
        <div className="qz-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {/* Live Co-Pilot: floating heatmap + (rare) insight card. Answering-only. */}
      {answering && <CopilotPanel sessionId={sessionId} />}

      {/* ---- Header --------------------------------------------------------- */}
      <header className="rm-rule-b flex-shrink-0">
        <div className="rm-pad rm-band mx-auto flex w-full max-w-3xl items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="rm-eyebrow">
              Quiz <span aria-hidden="true">·</span> {node.subject}
            </div>
            <h1 className="rm-title rm-wrap mt-2">{node.label}</h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {answering && (
              <span className="rm-tag hidden sm:inline-flex" style={{ color: 'var(--accent-cyan)' }}>
                {QUIZ_PASS_THRESHOLD}% to pass
              </span>
            )}
            <span className="rm-micro hidden sm:inline">Esc</span>
            <button type="button" onClick={requestClose} className="rm-icon-btn" aria-label="Close quiz">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>
      </header>

      {/* ---- Body ----------------------------------------------------------- */}
      <div className="rm-scroll flex-1">
        <div className="rm-pad mx-auto w-full max-w-3xl py-8 sm:py-12">
          {/* NOT mode="wait": that holds the outgoing phase mounted until its
              exit animation completes, and a stalled exit has frozen this app
              three separate times — most recently leaving a loading panel
              mounted at opacity 0 forever. On the one screen that is the only
              route to a green node, a frozen phase transition means the quiz
              simply never appears. Phases are mutually exclusive and keyed, so
              an instant swap is correct anyway. */}
          <AnimatePresence>
            {phase === 'loading' && (
              <motion.div
                key="loading"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-start gap-5 py-10"
                aria-live="polite"
              >
                <div className="rm-spinner h-7 w-7" aria-hidden="true" />
                <div className="rm-eyebrow rm-eyebrow-accent">Generating your quiz</div>
                <p className="rm-display">{LOADING_LINES[loadingLine]}</p>
                <p className="rm-micro">Live model call — usually takes a few seconds.</p>
              </motion.div>
            )}

            {phase === 'error' && (
              <motion.div
                key="error"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                className="flex flex-col items-start gap-5 py-10"
              >
                <div className="rm-eyebrow" style={{ color: 'var(--status-red)' }}>
                  Could not start
                </div>
                <p className="rm-title max-w-xl">{error}</p>
                <button type="button" onClick={load} className="rm-btn rm-btn-solid">
                  Try again
                </button>
              </motion.div>
            )}

            {answering && currentQuestion && (
              <motion.div
                key={`q-${currentQuestion.id}`}
                initial={{ opacity: 0, x: 14 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: -14 }}
                transition={{ type: 'spring', stiffness: 260, damping: 30 }}
              >
                {error && (
                  <div
                    className="mb-6 rounded-xl border px-4 py-3"
                    style={{ borderColor: 'var(--status-amber)', color: 'var(--status-amber)' }}
                    role="alert"
                  >
                    <span className="rm-micro" style={{ color: 'inherit' }}>
                      {error}
                    </span>
                  </div>
                )}

                <QuestionPanel
                  index={currentIndex}
                  total={questions.length}
                  question={currentQuestion}
                  value={answers[currentQuestion.id] ?? ''}
                  onChange={(v) => setAnswer(currentQuestion.id, v)}
                  disabled={phase === 'submitting'}
                />
              </motion.div>
            )}

            {phase === 'results' && (
              <ResultsView
                score={score}
                passed={passed}
                questions={gradedQuestions}
                perQuestion={perQuestion}
                onRetry={load}
                onClose={onClose}
              />
            )}
          </AnimatePresence>
        </div>
      </div>

      {/* ---- Footer --------------------------------------------------------- */}
      {answering && questions.length > 0 && (
        <QuizFooter
          questions={questions}
          currentIndex={currentIndex}
          answeredIds={answeredIds}
          allAnswered={allAnswered}
          submitting={phase === 'submitting'}
          onGoTo={goTo}
          onSubmit={handleSubmit}
        />
      )}

      <AnimatePresence>
        {confirmingClose && (
          <motion.div
            key="confirm-close"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-40 flex items-center justify-center p-6"
            style={{ background: 'rgba(2, 2, 6, 0.75)' }}
          >
            <motion.div
              initial={{ scale: 0.96, opacity: 0, y: 8 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.97, opacity: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 26 }}
              className="w-full max-w-sm rounded-2xl border p-7"
              style={{
                borderColor: 'var(--border-glass)',
                background: 'linear-gradient(180deg, rgba(16,18,32,0.98), rgba(8,9,18,0.98))',
              }}
              role="alertdialog"
              aria-modal="true"
              aria-label="Leave quiz without finishing?"
            >
              <div className="rm-eyebrow">Unsaved attempt</div>
              <p className="rm-subtitle mt-2.5">Leave without finishing?</p>
              <p className="rm-body mt-2">Your answers on this attempt won’t be saved.</p>
              <div className="mt-6 flex flex-col gap-2.5 sm:flex-row">
                <button
                  type="button"
                  onClick={() => setConfirmingClose(false)}
                  className="rm-btn rm-btn-ghost flex-1"
                  autoFocus
                >
                  Stay
                </button>
                <button type="button" onClick={onClose} className="rm-btn rm-btn-solid flex-1">
                  Leave quiz
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function QuestionPanel({
  index,
  total,
  question,
  value,
  onChange,
  disabled,
}: {
  index: number;
  total: number;
  question: QuizQuestion;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const isMcq = question.question_type === 'mcq';
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const choices = question.choices ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="rm-eyebrow rm-eyebrow-accent rm-num" aria-live="polite">
          Question {pad2(index + 1)} / {pad2(total)}
        </span>
        <span className="rm-tag">{isMcq ? 'Multiple choice' : 'AI-graded'}</span>
      </div>

      <p className="qz-question mt-5 sm:mt-7">{question.prompt}</p>

      <div className="mt-8 sm:mt-10">
        {isMcq ? (
          <>
            <div className="flex flex-col gap-2.5" role="group" aria-label="Answer choices">
              {choices.map((choice, i) => {
                const selected = value === choice;
                return (
                  <button
                    key={choice}
                    type="button"
                    disabled={disabled}
                    onClick={() => onChange(choice)}
                    className="qz-option"
                    data-selected={selected ? 'true' : 'false'}
                    aria-pressed={selected}
                  >
                    <span className="qz-key" aria-hidden="true">
                      {selected ? '✓' : i + 1}
                    </span>
                    <span className="rm-wrap min-w-0">{choice}</span>
                  </button>
                );
              })}
            </div>
            <p className="rm-micro mt-4">
              Press 1–{choices.length} or use the arrow keys to pick · Enter to continue
            </p>
          </>
        ) : (
          <>
            <textarea
              ref={textareaRef}
              value={value}
              disabled={disabled}
              onChange={(e) => onChange(e.target.value)}
              placeholder="Type your answer…"
              rows={7}
              className="rm-field"
              aria-label="Your answer"
            />
            <p className="rm-micro mt-3">This answer is graded by AI for meaning, not exact wording.</p>
          </>
        )}
      </div>
    </div>
  );
}

function QuizFooter({
  questions,
  currentIndex,
  answeredIds,
  allAnswered,
  submitting,
  onGoTo,
  onSubmit,
}: {
  questions: QuizQuestion[];
  currentIndex: number;
  answeredIds: Set<string>;
  allAnswered: boolean;
  submitting: boolean;
  onGoTo: (i: number) => void;
  onSubmit: () => void;
}) {
  const answeredCount = answeredIds.size;
  const missing = questions.length - answeredCount;

  return (
    <footer className="rm-rule-t flex-shrink-0" style={{ background: 'rgba(3, 3, 9, 0.7)' }}>
      <div className="rm-pad rm-band-sm mx-auto flex w-full max-w-3xl flex-col gap-3">
        <div className="flex items-center justify-between gap-3">
          <button
            type="button"
            onClick={() => onGoTo(currentIndex - 1)}
            disabled={currentIndex === 0 || submitting}
            className="rm-btn rm-btn-ghost"
          >
            <span aria-hidden="true">←</span> Back
          </button>

          <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
            {questions.map((q, i) => (
              <button
                key={q.id}
                type="button"
                onClick={() => onGoTo(i)}
                disabled={submitting}
                aria-label={`Go to question ${i + 1}${answeredIds.has(q.id) ? ' (answered)' : ''}`}
                aria-current={i === currentIndex ? 'step' : undefined}
                className="qz-dot"
                data-answered={answeredIds.has(q.id) ? 'true' : 'false'}
                data-current={i === currentIndex ? 'true' : 'false'}
              >
                {i + 1}
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onGoTo(currentIndex + 1)}
            disabled={currentIndex === questions.length - 1 || submitting}
            className="rm-btn rm-btn-ghost"
          >
            Next <span aria-hidden="true">→</span>
          </button>
        </div>

        <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
          <span className="rm-micro">
            {allAnswered
              ? `All ${questions.length} answered — ready to submit.`
              : `${answeredCount} / ${questions.length} answered · ${missing} to go`}
          </span>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!allAnswered || submitting}
            className="rm-btn rm-btn-solid"
          >
            {submitting ? 'Grading…' : 'Submit quiz'}
          </button>
        </div>
      </div>
    </footer>
  );
}

function ResultsView({
  score,
  passed,
  questions,
  perQuestion,
  onRetry,
  onClose,
}: {
  score: number;
  passed: boolean;
  questions: QuizQuestion[];
  perQuestion: PerQuestionResult[];
  onRetry: () => void;
  onClose: () => void;
}) {
  const correctById = useMemo(() => {
    const map = new Map<string, boolean>();
    perQuestion.forEach((p) => map.set(p.id, p.is_correct));
    return map;
  }, [perQuestion]);

  // Fill the threshold meter on the next frame so it animates in.
  const [meterPct, setMeterPct] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setMeterPct(score));
    return () => cancelAnimationFrame(raf);
  }, [score]);

  const color = passed ? 'var(--status-green)' : 'var(--status-amber)';

  return (
    <motion.div
      key="results"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex flex-col gap-12"
      aria-live="polite"
    >
      {/* ---- The score is the hero ---------------------------------------- */}
      <section>
        <div className="rm-eyebrow" style={{ color }}>
          {passed ? 'Passed' : 'Not yet'}
        </div>

        <div className="mt-5 flex items-end gap-3">
          <span className="qz-score" style={{ color }}>
            {score}
          </span>
          <span className="rm-micro rm-num" style={{ paddingBottom: 10 }}>
            / 100
          </span>
        </div>

        <div className="mt-7 max-w-md">
          <div className="qz-meter">
            <div className="qz-meter-fill" style={{ width: `${meterPct}%`, background: color }} />
            <div className="qz-meter-tick" style={{ left: `${QUIZ_PASS_THRESHOLD}%` }} aria-hidden="true" />
          </div>
          <div className="rm-micro rm-num mt-2.5 flex justify-between">
            <span>0</span>
            <span>{QUIZ_PASS_THRESHOLD}% threshold</span>
            <span>100</span>
          </div>
        </div>

        <h2 className="rm-display mt-9 max-w-xl">
          {passed ? 'Mastery proven.' : 'Not quite mastery — yet.'}
        </h2>
        <p className="rm-lead mt-3 max-w-xl">
          {passed
            ? `You cleared the ${QUIZ_PASS_THRESHOLD}% threshold. This node just turned green on your graph.`
            : `You need ${QUIZ_PASS_THRESHOLD}% to prove mastery — you're not far off. Review the explanations below and go again.`}
        </p>

        {passed && (
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 0.4 }}
            className="mt-6 inline-flex items-center gap-3"
          >
            <span className="rm-eyebrow">Node status</span>
            <span className="rm-tag" style={{ color: 'var(--status-amber)' }}>
              <span className="rm-dot" style={{ background: STATUS_COLORS.amber }} />
              Amber
            </span>
            <span className="rm-micro" aria-hidden="true">
              →
            </span>
            <span className="rm-tag" style={{ color: 'var(--status-green)', borderColor: 'var(--status-green)' }}>
              <span
                className="rm-dot"
                style={{ background: STATUS_COLORS.green, boxShadow: '0 0 10px var(--status-green-glow)' }}
              />
              Green
            </span>
          </motion.div>
        )}

        <div className="mt-9 flex flex-col gap-2.5 sm:flex-row">
          {passed ? (
            <button type="button" onClick={onClose} className="rm-btn rm-btn-solid">
              Back to constellation
            </button>
          ) : (
            <>
              <button type="button" onClick={onRetry} className="rm-btn rm-btn-solid">
                Retry quiz
              </button>
              <button type="button" onClick={onClose} className="rm-btn rm-btn-ghost">
                Close
              </button>
            </>
          )}
        </div>
      </section>

      {/* ---- Per-question review ------------------------------------------- */}
      <section>
        <div className="rm-eyebrow">The breakdown</div>
        <div className="mt-5 flex flex-col gap-3">
          {questions.map((q, idx) => {
            const isCorrect = correctById.get(q.id) ?? q.is_correct ?? false;
            return (
              <div key={q.id} className="qz-review">
                <span
                  className="qz-verdict-mark"
                  style={{
                    background: isCorrect ? 'rgba(40, 224, 160, 0.14)' : 'rgba(255, 59, 92, 0.14)',
                    color: isCorrect ? 'var(--status-green)' : 'var(--status-red)',
                  }}
                  aria-hidden="true"
                >
                  {isCorrect ? '✓' : '✕'}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="rm-eyebrow rm-num">Question {pad2(idx + 1)}</div>
                  <p className="rm-wrap mt-2" style={{ fontSize: 14.5, lineHeight: 1.55, color: 'var(--text-primary)' }}>
                    {q.prompt}
                  </p>
                  <p className="rm-micro rm-wrap mt-3">
                    Your answer:{' '}
                    <span style={{ color: isCorrect ? 'var(--status-green)' : 'var(--text-secondary)' }}>
                      {q.given_answer || '—'}
                    </span>
                  </p>
                  {!isCorrect && (
                    <p className="rm-micro rm-wrap mt-1">
                      Correct: <span style={{ color: 'var(--status-green)' }}>{q.correct_answer}</span>
                    </p>
                  )}
                  {q.explanation && (
                    <p className="rm-body rm-wrap mt-3" style={{ fontSize: 13.5 }}>
                      {q.explanation}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </motion.div>
  );
}

export default Quiz;
