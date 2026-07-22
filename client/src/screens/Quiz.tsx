import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Node, QuizQuestion } from '@zynth/shared';
import { QUIZ_PASS_THRESHOLD, STATUS_COLORS } from '@zynth/shared';
import { generateQuiz, submitQuiz } from '../lib/api';

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

/**
 * Full-page quiz overlay — the only path to a green/mastered node. Flow:
 * generate (Gemini, live) -> answer (mcq single-select / free-response
 * textarea) -> submit (Groq-graded) -> results (score ring, pass/fail,
 * per-question explanations, replaceNode(green) on pass).
 */
export function Quiz({ node, onClose, patchNode, replaceNode }: QuizProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [loadingLine, setLoadingLine] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [score, setScore] = useState(0);
  const [passed, setPassed] = useState(false);
  const [perQuestion, setPerQuestion] = useState<PerQuestionResult[]>([]);
  const [gradedQuestions, setGradedQuestions] = useState<QuizQuestion[]>([]);

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
      const { questions: qs } = await generateQuiz([node.id]);
      setQuestions(qs);
      setAnswers({});
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

  const allAnswered = useMemo(
    () => questions.length > 0 && questions.every((q) => (answers[q.id] ?? '').trim().length > 0),
    [questions, answers],
  );

  function setAnswer(questionId: string, value: string) {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  }

  async function handleSubmit() {
    if (!allAnswered) return;
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-30 flex flex-col overflow-y-auto bg-black/70 backdrop-blur-md"
    >
      <Header node={node} onClose={onClose} />

      <div className="mx-auto w-full max-w-3xl flex-1 px-6 pb-16 pt-6">
        <AnimatePresence mode="wait">
          {phase === 'loading' && (
            <motion.div
              key="loading"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="glass-panel flex flex-col items-center gap-4 px-8 py-16 text-center"
            >
              <div className="relative h-12 w-12">
                <div
                  className="absolute inset-0 animate-spin rounded-full border-2 border-transparent"
                  style={{ borderTopColor: 'var(--accent-cyan)', borderRightColor: 'var(--accent-cyan)' }}
                />
              </div>
              <div className="section-label">Generating your quiz</div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {LOADING_LINES[loadingLine]}
              </p>
              <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                Live model call — usually takes a few seconds.
              </p>
            </motion.div>
          )}

          {phase === 'error' && (
            <motion.div
              key="error"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="glass-panel flex flex-col items-center gap-4 px-8 py-16 text-center"
            >
              <div className="text-3xl">⚠️</div>
              <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                {error}
              </p>
              <button onClick={load} className="btn-primary px-5 py-2.5 text-sm font-semibold">
                Try again
              </button>
            </motion.div>
          )}

          {(phase === 'answering' || phase === 'submitting') && (
            <motion.div key="answering" initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              {error && (
                <div className="glass-chip mb-4 px-4 py-2 text-xs" style={{ color: 'var(--status-amber)' }}>
                  {error}
                </div>
              )}
              <div className="flex flex-col gap-4">
                {questions.map((q, idx) => (
                  <QuestionCard
                    key={q.id}
                    index={idx}
                    question={q}
                    value={answers[q.id] ?? ''}
                    onChange={(v) => setAnswer(q.id, v)}
                    disabled={phase === 'submitting'}
                  />
                ))}
              </div>

              <div className="mt-6 flex items-center justify-between">
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  {questions.filter((q) => (answers[q.id] ?? '').trim().length > 0).length} / {questions.length} answered
                </span>
                <button
                  onClick={handleSubmit}
                  disabled={!allAnswered || phase === 'submitting'}
                  className="btn-primary px-6 py-2.5 text-sm font-semibold"
                >
                  {phase === 'submitting' ? 'Grading…' : 'Submit quiz'}
                </button>
              </div>
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
    </motion.div>
  );
}

function Header({ node, onClose }: { node: Node; onClose: () => void }) {
  return (
    <div className="sticky top-0 z-10 border-b border-white/5 bg-black/30 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5">
        <div>
          <div className="section-label">{node.subject} · Quiz</div>
          <h1 className="font-display mt-1 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            {node.label}
          </h1>
        </div>
        <button
          onClick={onClose}
          className="glass-chip btn-chip flex h-9 w-9 items-center justify-center text-sm"
          aria-label="Close quiz"
        >
          {'✕'}
        </button>
      </div>
    </div>
  );
}

function QuestionCard({
  index,
  question,
  value,
  onChange,
  disabled,
}: {
  index: number;
  question: QuizQuestion;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  const isMcq = question.question_type === 'mcq';
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.05 }}
      className="glass-panel px-5 py-5"
    >
      <div className="flex items-start gap-3">
        <span
          className="glass-chip flex h-6 w-6 shrink-0 items-center justify-center text-[11px] font-semibold"
          style={{ color: 'var(--accent-cyan)' }}
        >
          {index + 1}
        </span>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-primary)' }}>
          {question.prompt}
        </p>
      </div>

      <div className="mt-4 pl-9">
        {isMcq ? (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {(question.choices ?? []).map((choice) => {
              const selected = value === choice;
              return (
                <button
                  key={choice}
                  disabled={disabled}
                  onClick={() => onChange(choice)}
                  className="glass-chip rounded-lg px-3.5 py-2.5 text-left text-sm transition disabled:opacity-60"
                  style={{
                    color: selected ? 'var(--text-primary)' : 'var(--text-secondary)',
                    borderColor: selected ? 'var(--accent-cyan)' : undefined,
                    boxShadow: selected ? '0 0 0 1px var(--accent-cyan), 0 0 16px var(--accent-cyan-dim)' : undefined,
                  }}
                >
                  {choice}
                </button>
              );
            })}
          </div>
        ) : (
          <textarea
            value={value}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
            placeholder="Type your answer…"
            rows={4}
            className="glass-chip w-full resize-none rounded-lg px-3.5 py-3 text-sm outline-none placeholder:text-white/25 disabled:opacity-60"
            style={{ color: 'var(--text-primary)' }}
          />
        )}
      </div>
    </motion.div>
  );
}

function ScoreRing({ score, passed }: { score: number; passed: boolean }) {
  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const [dashOffset, setDashOffset] = useState(circumference);
  const color = passed ? 'var(--status-green)' : 'var(--status-amber)';
  const glow = passed ? 'var(--status-green-glow)' : 'var(--status-amber-glow)';

  useEffect(() => {
    // Animated fill-in beat — the "small tasteful surprise" for this screen.
    const raf = requestAnimationFrame(() => {
      setDashOffset(circumference * (1 - score / 100));
    });
    return () => cancelAnimationFrame(raf);
  }, [circumference, score]);

  return (
    <div className="relative flex h-36 w-36 items-center justify-center">
      <svg width="144" height="144" viewBox="0 0 144 144" className="-rotate-90">
        <circle cx="72" cy="72" r={radius} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="8" />
        <circle
          cx="72"
          cy="72"
          r={radius}
          fill="none"
          stroke={color}
          strokeWidth="8"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
          style={{
            transition: 'stroke-dashoffset 1.1s cubic-bezier(0.16, 1, 0.3, 1)',
            filter: `drop-shadow(0 0 10px ${glow})`,
          }}
        />
      </svg>
      <div className="absolute flex flex-col items-center">
        <span className="font-display tabular-nums text-3xl font-bold" style={{ color: 'var(--text-primary)' }}>
          {score}
        </span>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          / 100
        </span>
      </div>
    </div>
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

  return (
    <motion.div
      key="results"
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0 }}
      className="flex flex-col gap-6"
    >
      <div
        className="glass-panel flex flex-col items-center gap-3 px-8 py-10 text-center"
        style={{
          boxShadow: passed
            ? '0 8px 40px rgba(0,0,0,0.45), inset 0 1px 0 var(--border-inner-highlight), 0 0 60px var(--status-green-glow)'
            : undefined,
        }}
      >
        <ScoreRing score={score} passed={passed} />
        <div
          className="glass-chip mt-1 px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.2em]"
          style={{ color: passed ? 'var(--status-green)' : 'var(--status-amber)' }}
        >
          {passed ? 'Passed' : 'Not yet'}
        </div>
        <h2 className="font-display mt-1 text-xl font-semibold" style={{ color: 'var(--text-primary)' }}>
          {passed ? 'Mastery proven.' : 'Not quite mastery — yet.'}
        </h2>
        <p className="max-w-md text-sm" style={{ color: 'var(--text-secondary)' }}>
          {passed
            ? `You cleared the ${QUIZ_PASS_THRESHOLD} threshold. This node just turned green.`
            : `You need ${QUIZ_PASS_THRESHOLD} to prove mastery — you're not far off. Review the explanations below and go again.`}
        </p>
        {passed && (
          <motion.div
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, type: 'spring', stiffness: 200, damping: 18 }}
            className="mt-2 flex items-center gap-2 text-xs"
            style={{ color: 'var(--status-green)' }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: STATUS_COLORS.green, boxShadow: '0 0 10px var(--status-green-glow)' }}
            />
            node status: amber → green
          </motion.div>
        )}
      </div>

      <div className="flex flex-col gap-3">
        {questions.map((q, idx) => {
          const isCorrect = correctById.get(q.id) ?? q.is_correct ?? false;
          return (
            <div key={q.id} className="glass-panel px-5 py-4">
              <div className="flex items-start gap-3">
                <span
                  className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px]"
                  style={{
                    backgroundColor: isCorrect ? 'rgba(40,224,160,0.15)' : 'rgba(255,59,92,0.15)',
                    color: isCorrect ? 'var(--status-green)' : 'var(--status-red)',
                  }}
                >
                  {isCorrect ? '✓' : '✕'}
                </span>
                <div className="flex-1">
                  <p className="text-sm" style={{ color: 'var(--text-primary)' }}>
                    {idx + 1}. {q.prompt}
                  </p>
                  <p className="mt-1.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                    Your answer: <span style={{ color: 'var(--text-secondary)' }}>{q.given_answer || '—'}</span>
                  </p>
                  {!isCorrect && (
                    <p className="mt-0.5 text-xs" style={{ color: 'var(--text-muted)' }}>
                      Correct: <span style={{ color: 'var(--text-secondary)' }}>{q.correct_answer}</span>
                    </p>
                  )}
                  {q.explanation && (
                    <p className="mt-2 text-xs italic" style={{ color: 'var(--text-secondary)' }}>
                      {q.explanation}
                    </p>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex items-center justify-center gap-3 pb-4">
        {passed ? (
          <button onClick={onClose} className="btn-primary px-6 py-2.5 text-sm font-semibold">
            Back to constellation
          </button>
        ) : (
          <>
            <button onClick={onClose} className="glass-chip btn-chip px-5 py-2.5 text-sm font-medium">
              Close
            </button>
            <button onClick={onRetry} className="btn-primary px-6 py-2.5 text-sm font-semibold">
              Retry quiz
            </button>
          </>
        )}
      </div>
    </motion.div>
  );
}

export default Quiz;
