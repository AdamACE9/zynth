import { useCallback, useEffect, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import './rooms.css';

export interface OfficeHoursProps {
  onClose: () => void;
}

/**
 * Mirrors server/src/services/officeHoursService.ts#WorkedSolution — a
 * structured worked solution rather than a wall of prose.
 */
interface WorkedSolutionStep {
  label: string;
  expression: string;
  note: string;
}

interface WorkedSolution {
  steps: WorkedSolutionStep[];
  key_insight: string;
  common_mistake: string;
}

interface OfficeHoursQuestion {
  id: string;
  asker_name: string;
  question: string;
  node_id: string | null;
  node_label: string | null;
  cluster_id: string | null;
  status: 'open' | 'answered';
  answer: WorkedSolution | null;
  created_at: string;
}

interface OfficeHoursBatch {
  batch_id: string;
  label: string;
  node_id: string | null;
  node_label: string | null;
  questions: OfficeHoursQuestion[];
  answer: WorkedSolution | null;
}

async function fetchQueue(): Promise<OfficeHoursBatch[]> {
  const res = await fetch('/api/officehours');
  if (!res.ok) throw new Error(`GET /api/officehours responded ${res.status}`);
  const data = (await res.json()) as { batches?: OfficeHoursBatch[] };
  return data.batches ?? [];
}

async function submitQuestion(question: string, askerName: string): Promise<OfficeHoursQuestion> {
  const res = await fetch('/api/officehours/ask', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ question, asker_name: askerName.trim() || undefined }),
  });
  if (!res.ok) throw new Error(`POST /api/officehours/ask responded ${res.status}`);
  const data = (await res.json()) as { item: OfficeHoursQuestion };
  return data.item;
}

async function answerBatch(batchId: string): Promise<OfficeHoursBatch> {
  const res = await fetch('/api/officehours/answer', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ batch_id: batchId }),
  });
  if (!res.ok) throw new Error(`POST /api/officehours/answer responded ${res.status}`);
  const data = (await res.json()) as { batch: OfficeHoursBatch };
  return data.batch;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

function isAnswered(batch: OfficeHoursBatch): boolean {
  return batch.answer !== null || batch.questions.every((q) => q.status === 'answered');
}

/**
 * Full-screen Office Hours Queue overlay. Students drop a question in; Zynth
 * classifies it onto a graph concept and the shared queue re-batches every
 * still-open question by topic/misconception overlap (not just by concept —
 * three differently-phrased questions that are all really "forgot the chain
 * rule's inner derivative" land in ONE batch). The teacher (or the demo
 * narrator) answers the biggest, most-blocking batch first with a single
 * visual worked solution instead of replying to each question separately.
 *
 * Visual language is borrowed wholesale from the Autopsy Board (ap-finding /
 * ap-pattern / ap-quote / ap-step) — this room does its own real batching +
 * answer-generation logic, but ZERO bespoke UI design per the Tier 2 rule.
 */
export function OfficeHours({ onClose }: OfficeHoursProps) {
  const [batches, setBatches] = useState<OfficeHoursBatch[] | null>(null);
  const [loadingQueue, setLoadingQueue] = useState(true);
  const [queueError, setQueueError] = useState<string | null>(null);

  const [askerName, setAskerName] = useState('');
  const [questionText, setQuestionText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [submitted, setSubmitted] = useState(false);

  const [answeringId, setAnsweringId] = useState<string | null>(null);
  const [answerError, setAnswerError] = useState<string | null>(null);

  const loadQueue = useCallback(async () => {
    setLoadingQueue(true);
    setQueueError(null);
    try {
      const fresh = await fetchQueue();
      setBatches(fresh);
    } catch (err) {
      console.warn('[Zynth] office hours queue fetch failed:', err);
      setQueueError('Could not load the queue — the backend may be offline. Try refreshing.');
    } finally {
      setLoadingQueue(false);
    }
  }, []);

  useEffect(() => {
    loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleSubmit() {
    if (!questionText.trim() || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    setSubmitted(false);
    try {
      await submitQuestion(questionText, askerName);
      setQuestionText('');
      setSubmitted(true);
      await loadQueue();
    } catch (err) {
      console.warn('[Zynth] office hours submit failed:', err);
      setSubmitError('Could not submit your question — the backend may be offline. Try again.');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAnswerBatch(batchId: string) {
    setAnsweringId(batchId);
    setAnswerError(null);
    try {
      const resolved = await answerBatch(batchId);
      setBatches((prev) => (prev ? prev.map((b) => (b.batch_id === batchId ? resolved : b)) : prev));
    } catch (err) {
      console.warn('[Zynth] office hours answer failed:', err);
      setAnswerError('Could not generate an answer for that batch — try again.');
    } finally {
      setAnsweringId(null);
    }
  }

  const openCount = batches?.reduce((sum, b) => sum + b.questions.filter((q) => q.status === 'open').length, 0) ?? 0;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="rm-scrim rm-page flex flex-col"
      style={{ '--rm-accent': 'var(--accent-violet)' } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="Office Hours Queue"
    >
      {/* ---- Header --------------------------------------------------------- */}
      <header className="rm-rule-b flex-shrink-0">
        <div className="rm-pad rm-band-sm mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="rm-eyebrow">Shared question queue</div>
            <h1 className="rm-title mt-1.5">Office Hours Queue</h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="rm-micro hidden sm:inline">Esc</span>
            <button type="button" onClick={onClose} className="rm-icon-btn" aria-label="Close office hours queue">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>
      </header>

      {/* ---- Body ----------------------------------------------------------- */}
      <div className="rm-scroll flex-1">
        <div className="rm-pad mx-auto flex w-full max-w-4xl flex-col gap-10 py-8 sm:gap-12 sm:py-12">
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <h2 className="rm-display max-w-2xl">One answer, every student it's blocking.</h2>
            <p className="rm-lead mt-4 max-w-xl">
              Drop a question in. Zynth links it to the concept it's really about, then batches it with every other
              open question that shares the same underlying misconception — so one worked solution can resolve
              everyone stuck on the same thing at once.
            </p>
          </motion.section>

          {/* ---- Ask box ------------------------------------------------------ */}
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="rm-eyebrow rm-eyebrow-accent">Step 01 · Ask a question</div>

            <input
              value={askerName}
              onChange={(e) => setAskerName(e.target.value)}
              disabled={submitting}
              placeholder="Your name (optional)"
              className="rm-field mt-4"
              aria-label="Your name"
            />

            <textarea
              value={questionText}
              onChange={(e) => setQuestionText(e.target.value)}
              disabled={submitting}
              placeholder="What are you stuck on? Be as specific as you can…"
              rows={3}
              className="rm-field mt-3"
              aria-label="Your question"
            />

            <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="rm-micro rm-num">
                {submitted ? 'Question added to the queue.' : 'Your question joins the shared queue below.'}
              </span>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={!questionText.trim() || submitting}
                className="rm-btn rm-btn-solid"
              >
                {submitting ? 'Submitting…' : 'Submit question'}
              </button>
            </div>

            {submitError && (
              <div className="mt-3 rounded-xl border px-4 py-3" style={{ borderColor: 'var(--status-amber)' }} role="alert">
                <span className="rm-micro" style={{ color: 'var(--status-amber)' }}>
                  {submitError}
                </span>
              </div>
            )}
          </motion.section>

          {/* ---- Queue ---------------------------------------------------- */}
          <motion.section
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="rm-rule-t flex flex-col gap-8 pt-10 sm:gap-10"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="rm-eyebrow rm-eyebrow-accent">Triaged queue</div>
                <p className="rm-micro mt-2 rm-num">
                  {loadingQueue
                    ? 'Loading…'
                    : `${openCount} open question${openCount === 1 ? '' : 's'} across ${batches?.length ?? 0} batch${
                        (batches?.length ?? 0) === 1 ? '' : 'es'
                      } · biggest, most-blocking batch first`}
                </p>
              </div>
              <button type="button" onClick={loadQueue} disabled={loadingQueue} className="rm-btn rm-btn-ghost">
                {loadingQueue ? 'Refreshing…' : 'Refresh queue'}
              </button>
            </div>

            {queueError && (
              <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--status-amber)' }} role="alert">
                <span className="rm-micro" style={{ color: 'var(--status-amber)' }}>
                  {queueError}
                </span>
              </div>
            )}

            {answerError && (
              <div className="rounded-xl border px-4 py-3" style={{ borderColor: 'var(--status-amber)' }} role="alert">
                <span className="rm-micro" style={{ color: 'var(--status-amber)' }}>
                  {answerError}
                </span>
              </div>
            )}

            {loadingQueue && !batches && (
              <div className="flex items-center gap-3">
                <div className="rm-spinner h-4 w-4" aria-hidden="true" />
                <span className="rm-micro">Batching the queue by topic overlap…</span>
              </div>
            )}

            {batches && batches.length === 0 && (
              <p className="rm-body max-w-xl">No open questions right now — the queue is clear.</p>
            )}

            {batches?.map((batch, idx) => (
              <BatchCard
                key={batch.batch_id}
                index={idx}
                batch={batch}
                answering={answeringId === batch.batch_id}
                onAnswer={() => handleAnswerBatch(batch.batch_id)}
              />
            ))}
          </motion.section>
        </div>
      </div>
    </motion.div>
  );
}

function BatchCard({
  index,
  batch,
  answering,
  onAnswer,
}: {
  index: number;
  batch: OfficeHoursBatch;
  answering: boolean;
  onAnswer: () => void;
}) {
  const answered = isAnswered(batch);
  const count = batch.questions.length;

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.06 }}
      className="ap-finding"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="rm-eyebrow rm-num">Batch {pad2(index + 1)}</span>
        <span className="rm-tag" style={{ color: count > 1 ? 'var(--status-amber)' : 'var(--text-muted)' }}>
          <span className="rm-dot" style={{ background: count > 1 ? 'var(--status-amber)' : 'var(--text-muted)' }} />
          {count} question{count === 1 ? '' : 's'}
        </span>
        {batch.node_label && (
          <span className="rm-tag" style={{ color: 'var(--accent-violet)' }}>
            <span className="rm-dot" style={{ background: 'var(--accent-violet)' }} />
            {batch.node_label}
          </span>
        )}
        {answered && (
          <span className="rm-tag" style={{ color: 'var(--status-green)' }}>
            <span className="rm-dot" style={{ background: 'var(--status-green)' }} />
            Answered
          </span>
        )}
      </div>

      <h3 className="ap-pattern mt-4">{batch.label}</h3>

      <div className="mt-6 flex flex-col gap-2">
        {batch.questions.map((q) => (
          <div
            key={q.id}
            className="flex flex-col gap-1.5 rounded-xl px-4 py-3 sm:flex-row sm:gap-4"
            style={{ border: '1px solid var(--border-glass)', background: 'rgba(255, 255, 255, 0.022)' }}
          >
            <span className="rm-eyebrow flex-shrink-0 sm:w-32" style={{ fontSize: 10, color: 'var(--text-muted)' }}>
              {q.asker_name}
            </span>
            <span className="rm-micro rm-wrap min-w-0" style={{ color: 'var(--text-secondary)' }}>
              {q.question}
            </span>
          </div>
        ))}
      </div>

      {!answered && (
        <div className="mt-7 flex justify-end">
          <button type="button" onClick={onAnswer} disabled={answering} className="rm-btn rm-btn-solid">
            {answering ? 'Working it out…' : 'Answer this batch'}
          </button>
        </div>
      )}

      {answered && batch.answer && (
        <div className="mt-7">
          <div className="rm-eyebrow rm-eyebrow-accent">Worked solution</div>
          <div className="mt-4 flex flex-col gap-4">
            {batch.answer.steps.map((step, i) => (
              <div key={i} className="ap-step" data-active="true">
                <span className="ap-step-mark" aria-hidden="true">
                  {i + 1}
                </span>
                <div className="min-w-0">
                  <div className="rm-eyebrow" style={{ fontSize: 10 }}>
                    {step.label}
                  </div>
                  <p
                    className="rm-num rm-wrap mt-1"
                    style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)' }}
                  >
                    {step.expression}
                  </p>
                  <p className="rm-body rm-wrap mt-1">{step.note}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <div className="ap-quote" style={{ borderLeftColor: 'var(--accent-violet)' }}>
              <div className="rm-eyebrow rm-eyebrow-accent" style={{ fontSize: 10 }}>
                Key insight
              </div>
              <p className="rm-body rm-wrap mt-2">{batch.answer.key_insight}</p>
            </div>
            <div className="ap-quote" style={{ borderLeftColor: 'var(--status-amber)' }}>
              <div className="rm-eyebrow" style={{ fontSize: 10, color: 'var(--status-amber)' }}>
                Common mistake
              </div>
              <p className="rm-body rm-wrap mt-2">{batch.answer.common_mistake}</p>
            </div>
          </div>
        </div>
      )}
    </motion.article>
  );
}

export default OfficeHours;
