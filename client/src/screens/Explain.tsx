import { useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import type { ExplainMessage, Node, Status, StatusHistoryEntry } from '@zynth/shared';
import { STATUS_COLORS } from '@zynth/shared';
import { sendExplainMessage } from '../lib/api';

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

/**
 * Short human-readable status trend from node.history, e.g.
 * "red -> amber (updated this week)". Deliberately mirrors the same read the
 * backend's own buildContextInstruction gives the tutor (see
 * server/src/services/explainService.ts#summarizeTrend) — the chip is showing
 * the student the truth, not a paraphrase of it.
 */
function summarizeTrend(history: StatusHistoryEntry[]): string {
  if (history.length === 0) return 'No status history yet — this will be the first touch.';
  const recent = history.slice(-4);
  const chain = recent.map((h) => h.status).join(' → ');
  const last = recent[recent.length - 1]!;
  return `${chain} (${formatRelative(last.timestamp)})`;
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

/**
 * Pulls the first quoted excerpt out of a tutor reply, if any. The backend's
 * explainService (see stubReply / the Gemini system instruction) folds the
 * student's actual recorded mistake text into the very first reply, quoted
 * verbatim — so if we spot a quote in that opening message, it's almost
 * always the exact slip the tutor is about to address. Surfacing it in the
 * chip proves, visibly, that context carried over before the student typed
 * a word.
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
          className="h-1 w-1 rounded-full"
          style={{ backgroundColor: 'var(--text-muted)' }}
          animate={{ opacity: [0.25, 1, 0.25] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: i * 0.15, ease: 'easeInOut' }}
        />
      ))}
    </span>
  );
}

/**
 * Explain — the calm, context-aware 1:1 tutor. Deliberately the quieter
 * counterpart to War Room: one voice, plain bubbles, muted chrome. The whole
 * point is that the student never has to re-explain where they're stuck —
 * the context chip up top makes that visible before they type anything.
 */
export function Explain({ node, onClose }: ExplainProps) {
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [messages, setMessages] = useState<ExplainMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [surpriseQuote, setSurpriseQuote] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  const trend = useMemo(() => summarizeTrend(node.history), [node.history]);
  const statusColor = STATUS_COLORS[node.status];

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, sending]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleSend() {
    const text = input.trim();
    if (!text || sending) return;

    const isFirstTurn = messages.length === 0;
    const optimistic: ExplainMessage = { role: 'student', content: text, at: new Date().toISOString() };
    setMessages((prev) => [...prev, optimistic]);
    setInput('');
    setSending(true);
    setError(null);

    try {
      const result = await sendExplainMessage(node.id, text, sessionId);
      setSessionId(result.session_id);
      setMessages(result.messages);
      if (isFirstTurn) {
        const quote = extractQuotedExcerpt(result.tutor_reply);
        if (quote) setSurpriseQuote(quote);
      }
    } catch (err) {
      console.warn('[Zynth] explain send failed:', err);
      setError("Couldn't reach the tutor — check the connection and try again.");
    } finally {
      setSending(false);
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      className="fixed inset-0 z-30 flex items-center justify-center bg-black/45 backdrop-blur-sm"
    >
      <motion.div
        initial={{ scale: 0.98, y: 8, opacity: 0 }}
        animate={{ scale: 1, y: 0, opacity: 1 }}
        exit={{ scale: 0.98, y: 8, opacity: 0, transition: { duration: 0.15 } }}
        transition={{ type: 'spring', stiffness: 220, damping: 32 }}
        className="glass-panel glass-panel-strong pointer-events-auto flex h-[38rem] max-h-[85vh] w-[34rem] max-w-[92vw] flex-col p-5"
      >
        {/* Header — quiet, no theatrics. */}
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="section-label">Explain &middot; {node.subject}</div>
            <h2 className="font-display mt-1 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
              {node.label}
            </h2>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-muted)' }}>
              Your tutor already knows where you're stuck.
            </p>
          </div>
          <button
            onClick={onClose}
            className="shrink-0 transition-colors duration-150"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
            aria-label="Close"
          >
            {'✕'}
          </button>
        </div>

        {/* Context chip — everything the tutor already knows about this node. */}
        <div className="glass-chip mt-4 flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1.5 font-medium" style={{ color: statusColor }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: statusColor }} />
            {STATUS_LABEL[node.status]}
          </span>
          <span style={{ color: 'var(--text-secondary)' }}>
            mastery <span className="tabular-nums">{node.mastery_score}</span>/100
          </span>
          {node.retest_count > 0 && (
            <span style={{ color: 'var(--text-secondary)' }}>retested {node.retest_count}&times;</span>
          )}
          <span style={{ color: 'var(--text-muted)' }}>{trend}</span>
        </div>

        {surpriseQuote && (
          <motion.div
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-chip mt-2 px-3 py-2 text-[11px] leading-relaxed"
            style={{ color: 'var(--text-secondary)', borderLeft: '2px solid var(--accent-violet)' }}
          >
            <span className="font-semibold" style={{ color: 'var(--accent-violet)' }}>
              Surprise —
            </span>{' '}
            pulled straight from your history, no re-explaining needed: &ldquo;{surpriseQuote}&rdquo;
          </motion.div>
        )}

        {/* Message list */}
        <div ref={scrollRef} className="mt-4 flex-1 space-y-3 overflow-y-auto pr-1">
          {messages.length === 0 && (
            <div className="mt-6 text-center text-xs" style={{ color: 'var(--text-muted)' }}>
              Say what's confusing — no need to set the scene, the context above already has it.
            </div>
          )}
          {messages.map((m, i) => (
            <motion.div
              key={`${m.at}-${i}`}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
              className={`flex ${m.role === 'student' ? 'justify-end' : 'justify-start'}`}
            >
              <div className={`max-w-[80%] ${m.role === 'student' ? 'text-right' : 'text-left'}`}>
                <div className="section-label mb-1 text-[10px]" style={{ opacity: 0.6 }}>
                  {m.role === 'student' ? 'You' : 'Tutor'}
                </div>
                <div
                  className="glass-chip whitespace-pre-wrap px-3 py-2 text-sm leading-relaxed"
                  style={{ color: 'var(--text-primary)' }}
                >
                  {m.content}
                </div>
              </div>
            </motion.div>
          ))}
          {sending && (
            <div className="flex justify-start">
              <div className="max-w-[80%] text-left">
                <div className="section-label mb-1 text-[10px]" style={{ opacity: 0.6 }}>
                  Tutor
                </div>
                <div
                  className="glass-chip inline-flex items-center gap-2 px-3 py-2 text-xs"
                  style={{ color: 'var(--text-muted)' }}
                >
                  <ThinkingDots /> thinking&hellip;
                </div>
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="mt-2 text-[11px]" style={{ color: 'var(--status-red)' }}>
            {error}
          </div>
        )}

        {/* Input */}
        <div className="mt-3 flex items-end gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask your tutor anything about this concept..."
            rows={1}
            className="glass-chip max-h-24 min-h-[2.5rem] flex-1 resize-none bg-transparent px-3 py-2.5 text-sm outline-none"
            style={{ color: 'var(--text-primary)' }}
          />
          <button
            onClick={() => void handleSend()}
            disabled={sending || input.trim().length === 0}
            className="btn-primary px-4 py-2.5 text-sm font-semibold"
          >
            Send
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}

export default Explain;
