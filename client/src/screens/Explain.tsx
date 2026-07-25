import { useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import type { ExplainMessage, Node, Status, StatusHistoryEntry } from '@zynth/shared';
import { STATUS_COLORS } from '@zynth/shared';
import { sendExplainMessage } from '../lib/api';
import './rooms.css';

export interface ExplainProps {
  node: Node;
  onClose: () => void;
  patchNode: (nodeId: string, patch: Partial<Node>) => void;
  replaceNode: (node: Node) => void;
}

const STATUS_LABEL: Record<Status, string> = {
  red: 'Unproven',
  amber: 'Engaged',
  green: 'Proven',
};

const STARTER_PROMPTS = [
  'Why do I keep getting this wrong?',
  'Explain it simply',
  'Give me a worked example',
];

/**
 * Short human-readable status trend from node.history, e.g.
 * "red -> amber (updated this week)". Deliberately mirrors the same read the
 * backend's own buildContextInstruction gives the tutor (see
 * server/src/services/explainService.ts#summarizeTrend) — the chip is showing
 * the student the truth, not a paraphrase of it.
 */
function summarizeTrend(history: StatusHistoryEntry[]): string {
  if (history.length === 0) return 'First touch';
  const recent = history.slice(-4);
  const chain = recent.map((h) => h.status).join(' → ');
  const last = recent[recent.length - 1]!;
  return `${chain} · ${formatRelative(last.timestamp)}`;
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  const days = Math.max(0, Math.floor((Date.now() - then) / (1000 * 60 * 60 * 24)));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return 'this week';
  if (days < 30) return 'this month';
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function formatClock(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

/**
 * Pulls the first quoted excerpt out of a tutor reply, if any. The backend's
 * explainService (see stubReply / the Gemini system instruction) folds the
 * student's actual recorded mistake text into the very first reply, quoted
 * verbatim — so if we spot a quote in that opening message, it's almost
 * always the exact slip the tutor is about to address. Surfacing it proves,
 * visibly, that context carried over before the student typed a word.
 */
function extractQuotedExcerpt(reply: string): string | null {
  const match = reply.match(/"([^"]{6,140})"/);
  return match ? match[1]!.trim() : null;
}

function ThinkingDots() {
  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {[0, 1, 2].map((i) => (
        <motion.span
          key={i}
          className="rm-dot"
          style={{ backgroundColor: 'var(--accent-violet)', width: 4, height: 4 }}
          animate={{ opacity: [0.2, 1, 0.2] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </span>
  );
}

/**
 * Explain — the calm, context-aware 1:1 tutor. Deliberately the quieter
 * counterpart to War Room: one voice, one accent (violet), reading-width
 * measure, no theatrics. The hook is the context block at the top: the tutor
 * already knows the student's status, mastery and trend, so it's stated as
 * plain fact before a single word is typed.
 */
export function Explain({ node, onClose }: ExplainProps) {
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ExplainMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastFailedText, setLastFailedText] = useState<string | null>(null);
  const [surpriseQuote, setSurpriseQuote] = useState<string | null>(null);
  const [contextExpanded, setContextExpanded] = useState(false);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const nearBottomRef = useRef(true);

  const trend = useMemo(() => summarizeTrend(node.history), [node.history]);
  const statusColor = STATUS_COLORS[node.status];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Auto-scroll only when the student was already near the bottom — never
  // yank them back down mid-scroll while reading earlier turns.
  useEffect(() => {
    if (!nearBottomRef.current) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    nearBottomRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 96;
  }

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function sendText(text: string) {
    const trimmed = text.trim();
    if (!trimmed || sending) return;

    const isFirstTurn = messages.length === 0;
    const optimistic: ExplainMessage = { role: 'student', content: trimmed, at: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');
    setSending(true);
    setError(null);
    setLastFailedText(null);
    nearBottomRef.current = true;

    try {
      const result = await sendExplainMessage(node.id, trimmed, sessionId);
      setSessionId(result.session_id);
      setMessages(result.messages);
      if (isFirstTurn) {
        const quote = extractQuotedExcerpt(result.tutor_reply);
        if (quote) setSurpriseQuote(quote);
      }
    } catch (err) {
      console.warn('[Zynth] explain send failed:', err);
      setError("Couldn't reach the tutor — check the connection and try again.");
      setLastFailedText(trimmed);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }

  function handleSend() {
    void sendText(input);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="rm-scrim flex items-center justify-center p-0 sm:p-6"
      style={{ '--rm-accent': 'var(--accent-violet)' } as CSSProperties}
    >
      <motion.div
        initial={{ scale: 0.99, y: 8, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.99, y: 8, opacity: 0, transition: { duration: 0.15 } }}
        transition={{ type: 'spring', stiffness: 220, damping: 32 }}
        className="rm-shell pointer-events-auto h-full w-full max-w-2xl sm:h-[46rem] sm:max-h-full"
        role="dialog"
        aria-modal="true"
        aria-label={`Explain — ${node.label}`}
      >
        {/* ---- Header — quiet, no theatrics. -------------------------------- */}
        <header className="rm-pad rm-rule-b rm-band-sm flex flex-shrink-0 items-start justify-between gap-4">
          <div className="min-w-0">
            <button type="button" onClick={onClose} className="rm-btn-quiet">
              <span aria-hidden="true">←</span> Back to graph
            </button>
            <div className="rm-eyebrow mt-3">
              Explain <span aria-hidden="true">·</span> {node.subject}
            </div>
            <h2 className="rm-subtitle rm-wrap mt-2">{node.label}</h2>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2 pt-0.5">
            <span className="rm-micro hidden sm:inline">Esc</span>
            <button type="button" onClick={onClose} className="rm-icon-btn" aria-label="Close explain session">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </header>

        {/* ---- Scrolling body: context preamble, then the conversation. -----
            The context block deliberately lives INSIDE the scroller rather
            than pinned above it. Pinned, it ate ~200px of fixed chrome and
            clipped the composer on short viewports; scrolling, it is the
            first thing the student sees on entry and then gets out of the
            way as the conversation grows. */}
        <div
          ref={scrollRef}
          onScroll={handleScroll}
          aria-live="polite"
          className="rm-scroll rm-pad flex-1 pb-2 pt-5"
        >
          <div className="ex-context">
            <div className="px-4 pb-3.5 pt-3.5">
              <div className="rm-eyebrow" style={{ color: 'var(--accent-violet)' }}>
                Your tutor already knows
              </div>
              <div className="mt-3 grid grid-cols-2 gap-x-5 gap-y-3.5 sm:grid-cols-4">
                <div className="min-w-0">
                  <div className="ex-stat-label">Status</div>
                  <div className="ex-stat-value mt-1 flex items-center gap-1.5" style={{ color: statusColor }}>
                    <span className="rm-dot" style={{ background: statusColor }} />
                    {STATUS_LABEL[node.status]}
                  </div>
                </div>
                <div className="min-w-0">
                  <div className="ex-stat-label">Mastery</div>
                  <div className="ex-stat-value mt-1">{node.mastery_score}/100</div>
                </div>
                <div className="min-w-0">
                  <div className="ex-stat-label">Retests</div>
                  <div className="ex-stat-value mt-1">{node.retest_count}</div>
                </div>
                <div className="min-w-0">
                  <div className="ex-stat-label">Trend</div>
                  <div className="ex-stat-value mt-1">{trend}</div>
                </div>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setContextExpanded((v) => !v)}
              className="rm-btn-quiet w-full justify-between px-4 py-2.5"
              style={{ borderTop: '1px solid var(--border-glass)', width: '100%' }}
              aria-expanded={contextExpanded}
            >
              <span>{contextExpanded ? 'Hide history' : 'See the full history it carries'}</span>
              <span
                aria-hidden="true"
                style={{
                  transform: contextExpanded ? 'rotate(180deg)' : 'none',
                  transition: 'transform 150ms ease',
                  display: 'inline-block',
                }}
              >
                ▾
              </span>
            </button>

            <AnimatePresence initial={false}>
              {contextExpanded && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: 'auto', opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  style={{ overflow: 'hidden', borderTop: '1px solid var(--border-glass)' }}
                >
                  <div className="px-4 py-3.5">
                    {node.history.length > 0 ? (
                      <ul className="flex flex-col gap-2">
                        {node.history.slice(-6).map((h, i) => (
                          <li key={`${h.timestamp}-${i}`} className="flex items-center gap-2.5">
                            <span className="rm-dot" style={{ background: STATUS_COLORS[h.status] }} />
                            <span className="rm-micro" style={{ color: 'var(--text-primary)' }}>
                              {STATUS_LABEL[h.status]}
                            </span>
                            <span className="rm-micro rm-wrap min-w-0">{h.cause}</span>
                            <span className="rm-micro ml-auto flex-shrink-0">{formatRelative(h.timestamp)}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="rm-micro">No prior sessions recorded for this concept yet.</p>
                    )}
                    <p className="rm-micro mt-3">
                      It also carries forward the specific mistakes recorded here, and references them directly
                      from its first reply.
                    </p>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          {surpriseQuote && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="mt-2.5 rounded-xl px-4 py-3"
              style={{
                border: '1px solid var(--border-glass)',
                borderLeft: '2px solid var(--accent-violet)',
                background: 'rgba(155, 123, 255, 0.06)',
              }}
            >
              <div className="rm-eyebrow" style={{ color: 'var(--accent-violet)' }}>
                Pulled from your history
              </div>
              <p className="rm-micro rm-wrap mt-1.5" style={{ color: 'var(--text-secondary)' }}>
                &ldquo;{surpriseQuote}&rdquo;
              </p>
            </motion.div>
          )}

          {/* ---- Messages --------------------------------------------------- */}
          {messages.length === 0 && (
            <div className="mt-6 flex flex-col gap-3 pb-2">
              <p className="rm-body">
                Say what's confusing — no need to set the scene, the context above already has it. Or start here:
              </p>
              <div className="mt-1 flex flex-col gap-2">
                {STARTER_PROMPTS.map((prompt) => (
                  <button
                    key={prompt}
                    type="button"
                    onClick={() => void sendText(prompt)}
                    disabled={sending}
                    className="ex-starter"
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className={`flex flex-col gap-5 ${messages.length > 0 || sending ? 'mt-6' : ''}`}>
            {messages.map((m, i) => (
              <motion.div
                key={`${m.at}-${i}`}
                initial={{ opacity: 0, y: 5 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className={`flex flex-col ${m.role === 'student' ? 'items-end' : 'items-start'}`}
              >
                <div className="mb-1.5 flex items-baseline gap-2">
                  <span className="rm-eyebrow" style={{ fontSize: 10 }}>
                    {m.role === 'student' ? 'You' : 'Tutor'}
                  </span>
                  <span className="rm-micro rm-num" style={{ fontSize: 10 }}>
                    {formatClock(m.at)}
                  </span>
                </div>
                <div className={m.role === 'student' ? 'max-w-[88%]' : 'max-w-full'}>
                  <div className="ex-bubble" data-role={m.role === 'student' ? 'student' : 'tutor'}>
                    {m.content}
                  </div>
                </div>
              </motion.div>
            ))}

            {sending && (
              <div className="flex flex-col items-start">
                <div className="rm-eyebrow mb-1.5" style={{ fontSize: 10 }}>
                  Tutor
                </div>
                <div className="ex-bubble inline-flex items-center gap-2.5" data-role="tutor">
                  <ThinkingDots />
                  <span className="rm-micro">thinking…</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* ---- Composer ------------------------------------------------------ */}
        <div className="rm-pad flex-shrink-0 pb-5 pt-3">
          {error && (
            <div className="mb-2.5 flex items-center justify-between gap-3" role="alert">
              <span className="rm-micro" style={{ color: 'var(--status-red)' }}>
                {error}
              </span>
              {lastFailedText && (
                <button
                  type="button"
                  onClick={() => void sendText(lastFailedText)}
                  className="rm-btn rm-btn-ghost flex-shrink-0"
                  style={{ padding: '6px 12px', fontSize: 12 }}
                >
                  Retry
                </button>
              )}
            </div>
          )}
          <div className="flex items-end gap-2.5">
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              disabled={sending}
              placeholder="Ask your tutor anything about this concept…"
              rows={1}
              className="rm-field"
              style={{ maxHeight: '7rem', minHeight: '2.9rem', padding: '11px 14px' }}
              aria-label="Message your tutor"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || input.trim().length === 0}
              className="rm-btn rm-btn-solid flex-shrink-0"
            >
              Send
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default Explain;
