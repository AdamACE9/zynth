import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import type {
  ExamNodeResult,
  ExamSimSession,
  Node as ZynthNode,
  QuizQuestion,
  ServerToClientEvents,
} from '@zynth/shared';
import { fetchGraph } from '../lib/api';
import { getSocket } from '../lib/socket';
import './rooms.css';

export interface ExamSimProps {
  onClose: () => void;
}

type Phase = 'setup' | 'loading' | 'error' | 'answering' | 'grading' | 'results';

interface ReasoningState {
  phase: 'thinking' | 'token' | 'graded';
  text: string;
  is_correct?: boolean;
}

const QUESTION_COUNT_OPTIONS = [4, 6, 10];

const LOADING_LINES = [
  'Pulling your weakest concepts…',
  'Drafting a past paper with Gemini…',
  'Setting the clock…',
];

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function formatClock(totalSeconds: number): string {
  const clamped = Math.max(0, totalSeconds);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${pad2(s)}`;
}

/**
 * Exam Simulator — a timed simulated past paper across the student's weak
 * nodes. Flow: setup (pick length) -> generate (Gemini, live) -> answer
 * against a countdown -> submit -> grading (the star feature: the
 * exam_grader agent's own "where did your logic diverge" reasoning streams
 * in, live, per question, over the 'exam:reasoning' socket event) -> results
 * (score, weak-topic report tied back to graph nodes, full reasoning trace).
 *
 * This screen NEVER touches Node.status — see server/src/services/examService.ts.
 * It produces a report and (server-side) MistakeRecords, nothing more.
 */
export function ExamSim({ onClose }: ExamSimProps) {
  const [phase, setPhase] = useState<Phase>('setup');
  const [loadingLine, setLoadingLine] = useState(0);
  const [questionCount, setQuestionCount] = useState(6);
  const [error, setError] = useState<string | null>(null);

  const [sessionId, setSessionId] = useState<string | null>(null);
  const [sourcePaper, setSourcePaper] = useState<string>('');
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [currentIndex, setCurrentIndex] = useState(0);

  const [durationSeconds, setDurationSeconds] = useState(0);
  const [remainingSeconds, setRemainingSeconds] = useState(0);

  const [reasoning, setReasoning] = useState<Record<string, ReasoningState>>({});
  const [reasoningOrder, setReasoningOrder] = useState<string[]>([]);
  const [gradingProgress, setGradingProgress] = useState<{ index: number; total: number } | null>(null);

  const [resultSession, setResultSession] = useState<ExamSimSession | null>(null);
  const [nodesById, setNodesById] = useState<Record<string, ZynthNode>>({});

  const sessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    sessionIdRef.current = sessionId;
  }, [sessionId]);

  // Node labels for the weak-topic report + reasoning cards — best-effort,
  // falls back to raw node ids if this never resolves.
  useEffect(() => {
    let cancelled = false;
    fetchGraph().then(({ nodes }) => {
      if (cancelled) return;
      const map: Record<string, ZynthNode> = {};
      nodes.forEach((n) => {
        map[n.id] = n;
      });
      setNodesById(map);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (phase !== 'loading') return;
    const timer = setInterval(() => setLoadingLine((i) => (i + 1) % LOADING_LINES.length), 1300);
    return () => clearInterval(timer);
  }, [phase]);

  // Live reasoning stream — the star feature. Subscribed for the component's
  // whole lifetime, filtered by the active session so a stray event from a
  // superseded attempt never leaks in. `.off` on cleanup, per the socket
  // contract used across every other room.
  useEffect(() => {
    const socket = getSocket();
    const handleReasoning: ServerToClientEvents['exam:reasoning'] = (payload) => {
      if (!sessionIdRef.current || payload.session_id !== sessionIdRef.current) return;

      setReasoning((prev) => {
        const existing = prev[payload.question_id];
        if (payload.phase === 'thinking') {
          return { ...prev, [payload.question_id]: { phase: 'thinking', text: '' } };
        }
        if (payload.phase === 'token') {
          const base = existing && existing.phase !== 'thinking' ? existing.text : '';
          return { ...prev, [payload.question_id]: { phase: 'token', text: base + payload.text } };
        }
        // 'graded' — server sends the full accumulated reasoning, trust it verbatim.
        return {
          ...prev,
          [payload.question_id]: { phase: 'graded', text: payload.text, is_correct: payload.is_correct },
        };
      });
      setReasoningOrder((prev) => (prev.includes(payload.question_id) ? prev : [...prev, payload.question_id]));
      setGradingProgress({ index: payload.index, total: payload.total });
    };

    socket.on('exam:reasoning', handleReasoning);
    return () => {
      socket.off('exam:reasoning', handleReasoning);
    };
  }, []);

  async function startExam() {
    setPhase('loading');
    setError(null);
    try {
      const res = await fetch('/api/exam/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question_count: questionCount }),
      });
      if (!res.ok) throw new Error(`POST /api/exam/start responded ${res.status}`);
      const data = (await res.json()) as { session_id: string; questions: QuizQuestion[]; duration_seconds: number };
      setSessionId(data.session_id);
      setQuestions(data.questions);
      setSourcePaper(`Simulated Paper · ${data.questions.length} questions`);
      setAnswers({});
      setCurrentIndex(0);
      setDurationSeconds(data.duration_seconds);
      setRemainingSeconds(data.duration_seconds);
      setReasoning({});
      setReasoningOrder([]);
      setGradingProgress(null);
      setResultSession(null);
      setPhase('answering');
    } catch (err) {
      console.warn('[Zynth] exam start failed:', err);
      setError('Could not start the exam. The tutor may be offline — try again.');
      setPhase('error');
    }
  }

  async function submitExam() {
    if (!sessionId) return;
    setPhase('grading');
    setError(null);
    try {
      const res = await fetch('/api/exam/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, answers }),
      });
      if (!res.ok) throw new Error(`POST /api/exam/submit responded ${res.status}`);
      const data = (await res.json()) as { session: ExamSimSession };
      setResultSession(data.session);
      setPhase('results');
    } catch (err) {
      console.warn('[Zynth] exam submit failed:', err);
      setError('Could not grade the exam. Check your connection and try submitting again.');
      setPhase('answering');
    }
  }

  // Countdown — auto-submits the moment it hits zero.
  useEffect(() => {
    if (phase !== 'answering') return;
    if (remainingSeconds <= 0) {
      submitExam();
      return;
    }
    const timer = setTimeout(() => setRemainingSeconds((s) => s - 1), 1000);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, remainingSeconds]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && phase !== 'grading') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose, phase]);

  function setAnswer(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  function goTo(index: number) {
    if (index < 0 || index >= questions.length) return;
    setCurrentIndex(index);
  }

  const answeredIds = useMemo(
    () => new Set(questions.filter((q) => (answers[q.id] ?? '').trim().length > 0).map((q) => q.id)),
    [questions, answers],
  );
  const currentQuestion = questions[currentIndex] as QuizQuestion | undefined;
  const timeLow = remainingSeconds <= 60;
  const progressPct = phase === 'results' ? 100 : durationSeconds > 0 ? ((durationSeconds - remainingSeconds) / durationSeconds) * 100 : 0;

  const displayQuestions = resultSession?.questions ?? [];
  const nodeResults: ExamNodeResult[] = resultSession?.node_results ?? [];
  const weakestFirst = [...nodeResults].sort((a, b) => a.score - b.score);
  const overallScore =
    resultSession && displayQuestions.length > 0
      ? Math.round((100 * displayQuestions.filter((q) => q.is_correct).length) / displayQuestions.length)
      : 0;

  function nodeLabel(nodeId: string): string {
    return nodesById[nodeId]?.label ?? nodeId;
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="rm-scrim rm-page flex flex-col"
      style={{ '--rm-accent': 'var(--status-amber)' } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="Exam Simulator"
    >
      <div className="qz-progress" aria-hidden="true">
        <div className="qz-progress-fill" style={{ width: `${progressPct}%` }} />
      </div>

      {/* ---- Header --------------------------------------------------------- */}
      <header className="rm-rule-b flex-shrink-0">
        <div className="rm-pad rm-band mx-auto flex w-full max-w-3xl items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="rm-eyebrow rm-eyebrow-accent">Exam Simulator</div>
            <h1 className="rm-title rm-wrap mt-2">
              {phase === 'setup' || phase === 'loading' || phase === 'error' ? 'Timed practice paper' : sourcePaper}
            </h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            {phase === 'answering' && (
              <span
                className="rm-tag rm-num"
                style={{ color: timeLow ? 'var(--status-red)' : 'var(--text-secondary)', borderColor: timeLow ? 'var(--status-red)' : undefined }}
                aria-live="polite"
              >
                {formatClock(remainingSeconds)}
              </span>
            )}
            <span className="rm-micro hidden sm:inline">Esc</span>
            <button
              type="button"
              onClick={onClose}
              disabled={phase === 'grading'}
              className="rm-icon-btn"
              aria-label="Close Exam Simulator"
            >
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>
      </header>

      {/* ---- Body ------------------------------------------------------------ */}
      <div className="rm-scroll flex-1">
        <div className="rm-pad mx-auto w-full max-w-3xl py-8 sm:py-12">
          {phase === 'setup' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-start gap-2">
              <h2 className="rm-display max-w-xl">Sit a timed practice paper.</h2>
              <p className="rm-lead mt-1 max-w-xl">
                Zynth builds a simulated past paper from your weakest concepts, self-grades it, and streams its own
                reasoning live — showing exactly where your logic diverged, question by question.
              </p>

              <div className="mt-8 w-full">
                <div className="rm-eyebrow">Paper length</div>
                <div className="mt-3 flex flex-wrap gap-3" role="group" aria-label="Question count">
                  {QUESTION_COUNT_OPTIONS.map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setQuestionCount(n)}
                      className="es-chip"
                      data-selected={questionCount === n ? 'true' : 'false'}
                      aria-pressed={questionCount === n}
                    >
                      <span className="rm-num" style={{ fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>
                        {n}
                      </span>
                      <span className="rm-micro">questions</span>
                    </button>
                  ))}
                </div>
              </div>

              <button type="button" onClick={startExam} className="rm-btn rm-btn-solid mt-9">
                Start exam <span aria-hidden="true">→</span>
              </button>
            </motion.div>
          )}

          {phase === 'loading' && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="flex flex-col items-start gap-5 py-10"
              aria-live="polite"
            >
              <div className="rm-spinner h-7 w-7" aria-hidden="true" />
              <div className="rm-eyebrow rm-eyebrow-accent">Building your paper</div>
              <p className="rm-display">{LOADING_LINES[loadingLine]}</p>
              <p className="rm-micro">Live model call — usually takes a few seconds.</p>
            </motion.div>
          )}

          {phase === 'error' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col items-start gap-5 py-10">
              <div className="rm-eyebrow" style={{ color: 'var(--status-red)' }}>
                Could not start
              </div>
              <p className="rm-title max-w-xl">{error}</p>
              <button type="button" onClick={startExam} className="rm-btn rm-btn-solid">
                Try again
              </button>
            </motion.div>
          )}

          {phase === 'answering' && currentQuestion && (
            <motion.div
              key={`q-${currentQuestion.id}`}
              initial={{ opacity: 0, x: 14 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ type: 'spring', stiffness: 260, damping: 30 }}
            >
              {error && (
                <div className="mb-6 rounded-xl border px-4 py-3" style={{ borderColor: 'var(--status-amber)', color: 'var(--status-amber)' }} role="alert">
                  <span className="rm-micro" style={{ color: 'inherit' }}>
                    {error}
                  </span>
                </div>
              )}
              <QuestionPanel
                index={currentIndex}
                total={questions.length}
                question={currentQuestion}
                nodeLabel={nodeLabel(currentQuestion.node_id)}
                value={answers[currentQuestion.id] ?? ''}
                onChange={(v) => setAnswer(currentQuestion.id, v)}
              />
            </motion.div>
          )}

          {phase === 'grading' && (
            <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5" aria-live="polite">
              <div className="rm-eyebrow rm-eyebrow-accent">
                Grading{gradingProgress ? ` · question ${pad2(gradingProgress.index + 1)} / ${pad2(gradingProgress.total)}` : '…'}
              </div>
              <p className="rm-lead max-w-xl">
                Watching the exam_grader agent work — it streams its own reasoning as it grades each question live.
              </p>
              <div className="mt-2 flex flex-col gap-3">
                {questions.map((q) => {
                  if (!reasoningOrder.includes(q.id) && reasoning[q.id] === undefined) return null;
                  return <ReasoningRow key={q.id} question={q} state={reasoning[q.id]} nodeLbl={nodeLabel(q.node_id)} />;
                })}
                {reasoningOrder.length === 0 && (
                  <div className="flex items-center gap-3 py-6">
                    <div className="rm-spinner h-5 w-5" aria-hidden="true" />
                    <span className="rm-body">Starting the grading pass…</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}

          {phase === 'results' && resultSession && (
            <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-12" aria-live="polite">
              {/* ---- Score hero -------------------------------------------- */}
              <section>
                <div className="rm-eyebrow" style={{ color: overallScore >= 70 ? 'var(--status-green)' : 'var(--status-amber)' }}>
                  Exam complete
                </div>
                <div className="mt-5 flex items-end gap-3">
                  <span className="qz-score" style={{ color: overallScore >= 70 ? 'var(--status-green)' : 'var(--status-amber)' }}>
                    {overallScore}
                  </span>
                  <span className="rm-micro rm-num" style={{ paddingBottom: 10 }}>
                    / 100
                  </span>
                </div>
                <p className="rm-lead mt-3 max-w-xl">
                  {resultSession.source_paper} · {displayQuestions.filter((q) => q.is_correct).length} / {displayQuestions.length} correct.
                </p>
                <p className="rm-micro mt-2 max-w-xl">
                  This is a report, not a retest — it does not change any node&apos;s status. Pass a Quiz on a weak node
                  below to actually move it toward green.
                </p>
                <button type="button" onClick={onClose} className="rm-btn rm-btn-solid mt-8">
                  Back to constellation
                </button>
              </section>

              {/* ---- Weak-topic report --------------------------------------- */}
              <section>
                <div className="rm-eyebrow">Weak-topic report</div>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {weakestFirst.map((r) => {
                    const weak = r.score < 70;
                    return (
                      <div key={r.node_id} className="ap-stat">
                        <div className="flex items-center justify-between gap-2">
                          <span className="rm-wrap" style={{ fontSize: 13.5, fontWeight: 600, color: 'var(--text-primary)' }}>
                            {nodeLabel(r.node_id)}
                          </span>
                          {weak && (
                            <span className="rm-tag" style={{ color: 'var(--status-amber)' }}>
                              Weak
                            </span>
                          )}
                        </div>
                        <div className="ap-stat-value mt-1">{r.score}</div>
                        <div className="ap-confidence mt-2">
                          <span
                            className="ap-confidence-fill"
                            style={{ width: `${r.score}%`, background: weak ? 'var(--status-amber)' : 'var(--status-green)' }}
                          />
                        </div>
                      </div>
                    );
                  })}
                  {weakestFirst.length === 0 && <p className="rm-body">No per-node results came back for this attempt.</p>}
                </div>
              </section>

              {/* ---- Full reasoning trace ------------------------------------ */}
              <section>
                <div className="rm-eyebrow">The reasoning trace</div>
                <div className="mt-5 flex flex-col gap-3">
                  {displayQuestions.map((q, idx) => {
                    const reasoningText = resultSession.live_reasoning_log.find((r) => r.question_id === q.id)?.reasoning ?? '';
                    const isCorrect = !!q.is_correct;
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
                          <div className="rm-eyebrow rm-num">
                            Question {pad2(idx + 1)} <span aria-hidden="true">·</span> {nodeLabel(q.node_id)}
                          </div>
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
                          {reasoningText && (
                            <p className="rm-body rm-wrap mt-3" style={{ fontSize: 13.5 }}>
                              {reasoningText}
                            </p>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            </motion.div>
          )}
        </div>
      </div>

      {/* ---- Footer ----------------------------------------------------------- */}
      {phase === 'answering' && questions.length > 0 && (
        <footer className="rm-rule-t flex-shrink-0" style={{ background: 'rgba(3, 3, 9, 0.7)' }}>
          <div className="rm-pad rm-band-sm mx-auto flex w-full max-w-3xl flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <button type="button" onClick={() => goTo(currentIndex - 1)} disabled={currentIndex === 0} className="rm-btn rm-btn-ghost">
                <span aria-hidden="true">←</span> Back
              </button>
              <div className="flex min-w-0 items-center gap-1.5 overflow-x-auto">
                {questions.map((q, i) => (
                  <button
                    key={q.id}
                    type="button"
                    onClick={() => goTo(i)}
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
                onClick={() => goTo(currentIndex + 1)}
                disabled={currentIndex === questions.length - 1}
                className="rm-btn rm-btn-ghost"
              >
                Next <span aria-hidden="true">→</span>
              </button>
            </div>
            <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="rm-micro">
                {answeredIds.size} / {questions.length} answered
                {answeredIds.size < questions.length ? ' · unanswered questions are marked wrong' : ' · ready to submit'}
              </span>
              <button type="button" onClick={submitExam} className="rm-btn rm-btn-solid">
                Submit exam
              </button>
            </div>
          </div>
        </footer>
      )}
    </motion.div>
  );
}

function QuestionPanel({
  index,
  total,
  question,
  nodeLabel,
  value,
  onChange,
}: {
  index: number;
  total: number;
  question: QuizQuestion;
  nodeLabel: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const isMcq = question.question_type === 'mcq';
  const choices = question.choices ?? [];

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <span className="rm-eyebrow rm-eyebrow-accent rm-num" aria-live="polite">
          Question {pad2(index + 1)} / {pad2(total)}
        </span>
        <span className="rm-tag">{nodeLabel}</span>
      </div>

      <p className="qz-question mt-5 sm:mt-7">{question.prompt}</p>

      <div className="mt-8 sm:mt-10">
        {isMcq ? (
          <div className="flex flex-col gap-2.5" role="group" aria-label="Answer choices">
            {choices.map((choice, i) => {
              const selected = value === choice;
              return (
                <button
                  key={choice}
                  type="button"
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
        ) : (
          <>
            <textarea
              value={value}
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

function ReasoningRow({ question, state, nodeLbl }: { question: QuizQuestion; state?: ReasoningState; nodeLbl: string }) {
  const isActive = state?.phase === 'thinking' || state?.phase === 'token';
  const isGraded = state?.phase === 'graded';
  return (
    <div className="es-feed-row" data-active={isActive ? 'true' : 'false'}>
      <span
        className="qz-verdict-mark"
        style={{
          background: isGraded ? (state.is_correct ? 'rgba(40, 224, 160, 0.14)' : 'rgba(255, 59, 92, 0.14)') : 'rgba(255,255,255,0.06)',
          color: isGraded ? (state.is_correct ? 'var(--status-green)' : 'var(--status-red)') : 'var(--text-muted)',
        }}
        aria-hidden="true"
      >
        {isGraded ? (state.is_correct ? '✓' : '✕') : '…'}
      </span>
      <div className="min-w-0 flex-1">
        <div className="rm-eyebrow rm-num">{nodeLbl}</div>
        <p className="rm-wrap mt-1" style={{ fontSize: 13.5, color: 'var(--text-secondary)' }}>
          {question.prompt}
        </p>
        <p className="rm-body rm-wrap mt-2" style={{ fontSize: 13 }}>
          {state?.text || 'Reviewing…'}
          {isActive && <span className="wr-caret" aria-hidden="true" />}
        </p>
      </div>
    </div>
  );
}

export default ExamSim;
