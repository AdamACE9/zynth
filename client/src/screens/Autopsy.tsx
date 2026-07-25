import { useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { motion } from 'motion/react';
import type { ErrorType, MistakeRecord } from '@zynth/shared';
import { fetchGraph, runAutopsy } from '../lib/api';
import { getSocket } from '../lib/socket';
import './rooms.css';

export interface AutopsyProps {
  onClose: () => void;
}

/**
 * A single recurring failure pattern found by the clustering pass. Mirrors
 * server/src/services/autopsyService.ts#AutopsyCluster — the backend
 * contract is looser (`clusters: any[]`) so we shape it here.
 */
interface AutopsyCluster {
  pattern_label: string;
  description: string;
  node_ids: string[];
  error_type: ErrorType;
  confidence: number;
  example_excerpts: string[];
}

interface AutopsyEdge {
  id: string;
  source_node_id: string;
  target_node_id: string;
  strength: number;
}

interface AutopsyRunResult {
  mistakes: MistakeRecord[];
  clusters: AutopsyCluster[];
  new_edges: AutopsyEdge[];
  new_nodes: { id: string; label: string }[];
}

const SAMPLE_TEXT = `1. Differentiating cos(3x), I got 3sin(3x) instead of -3sin(3x) — I dropped the negative that comes from the chain rule's inner derivative.
2. For e^(-x^2), I wrote 2x*e^(-x^2), but the negative sign from -x^2's own derivative should carry through, so it should be -2x*e^(-x^2).
3. Implicit differentiation of x^2 + y^2 = 25: I got dy/dx = x/y, but it should be dy/dx = -x/y after isolating the derivative.
4. On xy + y^2 = 7, I dropped the negative sign when moving the x*(dy/dx) term to the other side of the equation.
5. Ladder sliding down a wall (related rates): I used dx/dt = (y/x)(dy/dt) with no negative sign, even though the top of the ladder is falling so dy/dt should be negative.
6. Shrinking circle (related rates): I computed dA/dt = 2*pi*r*(dr/dt) but plugged in a positive dr/dt even though the radius is actually shrinking.
7. Quotient rule on x/(x+1): I swapped the numerator terms and used the wrong formula entirely — not a sign issue, just don't have the rule memorized right.`;

const ERROR_TYPE_META: Record<ErrorType, { label: string; color: string }> = {
  concept_gap: { label: 'Concept Gap', color: 'var(--status-red)' },
  careless_slip: { label: 'Careless Slip', color: 'var(--status-amber)' },
  prerequisite_gap: { label: 'Prerequisite Gap', color: 'var(--accent-violet)' },
};

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Full-screen Autopsy Board overlay. Paste (or load a sample of) raw
 * homework/test mistakes, run them through POST /api/autopsy, and watch
 * Zynth extract each mistake onto a concept node, cluster recurring failure
 * patterns across nodes, and wire up `correlated_error` edges live — the
 * graph behind this overlay redraws those edges itself via useLiveGraph.
 *
 * Visual intent: a diagnostic report, not a form. Findings are numbered and
 * lead with a large pattern statement; the "Zynth connected X ↔ Y" lines are
 * given real weight because they are the moment the product earns its claim.
 */
export function Autopsy({ onClose }: AutopsyProps) {
  const [text, setText] = useState('');
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<AutopsyRunResult | null>(null);
  const [nodeLabels, setNodeLabels] = useState<Record<string, string>>({});

  // Best-effort label lookup for nodes referenced in the results (both
  // pre-existing nodes and ones Autopsy just created) — purely cosmetic.
  useEffect(() => {
    let cancelled = false;
    fetchGraph().then((graph) => {
      if (cancelled) return;
      setNodeLabels((prev) => {
        const merged = { ...prev };
        for (const n of graph.nodes) merged[n.id] = n.label;
        return merged;
      });
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    function handleProgress(payload: { message: string }) {
      setProgress((prev) => [...prev, payload.message]);
    }
    socket.on('autopsy:progress', handleProgress);
    return () => {
      socket.off('autopsy:progress', handleProgress);
    };
  }, []);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  function labelFor(nodeId: string): string {
    return nodeLabels[nodeId] ?? nodeId;
  }

  async function handleAnalyze() {
    if (!text.trim() || running) return;
    setRunning(true);
    setProgress([]);
    setError(null);
    setResult(null);
    try {
      const res = await runAutopsy(text);
      setResult(res as unknown as AutopsyRunResult);
      setNodeLabels((prev) => {
        const merged = { ...prev };
        for (const n of (res.new_nodes ?? [])) merged[n.id] = n.label;
        return merged;
      });
    } catch (err) {
      console.warn('[Zynth] autopsy run failed:', err);
      setError('Autopsy could not run — the backend may be offline. Try again.');
    } finally {
      setRunning(false);
    }
  }

  const uncategorized = useMemo(() => {
    if (!result) return [];
    const clustered = new Set<string>();
    for (const c of result.clusters) {
      for (const m of result.mistakes) {
        if (c.node_ids.includes(m.node_id)) clustered.add(m.id);
      }
    }
    return result.mistakes.filter((m) => !clustered.has(m.id));
  }, [result]);

  const trimmedLength = text.trim().length;
  const lineCount = text.trim().length === 0 ? 0 : text.trim().split(/\r?\n+/).filter(Boolean).length;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="rm-scrim rm-page flex flex-col"
      style={{ '--rm-accent': 'var(--accent-cyan)' } as CSSProperties}
      role="dialog"
      aria-modal="true"
      aria-label="Autopsy Board"
    >
      {/* ---- Header --------------------------------------------------------- */}
      <header className="rm-rule-b flex-shrink-0">
        <div className="rm-pad rm-band-sm mx-auto flex w-full max-w-4xl items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="rm-eyebrow">Whole-graph diagnosis</div>
            <h1 className="rm-title mt-1.5">Autopsy Board</h1>
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <span className="rm-micro hidden sm:inline">Esc</span>
            <button type="button" onClick={onClose} className="rm-icon-btn" aria-label="Close autopsy board">
              <span aria-hidden="true">✕</span>
            </button>
          </div>
        </div>
      </header>

      {/* ---- Body ----------------------------------------------------------- */}
      <div className="rm-scroll flex-1">
        <div className="rm-pad mx-auto flex w-full max-w-4xl flex-col gap-10 py-8 sm:gap-12 sm:py-12">
          {/* Statement of intent — hidden once results take over the screen. */}
          {!result && (
            <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
              <h2 className="rm-display max-w-2xl">Find the one mistake behind all the others.</h2>
              <p className="rm-lead mt-4 max-w-xl">
                Paste mistakes from homework or a past test. Zynth extracts each one onto a concept, finds the
                pattern they share, and draws the new connections straight onto your graph.
              </p>
            </motion.section>
          )}

          {/* ---- Input ------------------------------------------------------ */}
          <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="rm-eyebrow rm-eyebrow-accent">
                {result ? 'Run another autopsy' : 'Step 01 · Paste your mistakes'}
              </div>
              <button
                type="button"
                onClick={() => setText(SAMPLE_TEXT)}
                disabled={running}
                className="rm-btn rm-btn-ghost"
                style={{ padding: '7px 13px', fontSize: 12 }}
              >
                Load sample mistakes
              </button>
            </div>

            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              disabled={running}
              placeholder="Paste homework, quiz, or test mistakes here — one per line works well…"
              rows={8}
              className="rm-field mt-4"
              aria-label="Mistakes to analyze"
            />

            <div className="mt-4 flex flex-col items-stretch gap-3 sm:flex-row sm:items-center sm:justify-between">
              <span className="rm-micro rm-num">
                {trimmedLength === 0
                  ? 'Nothing to analyze yet.'
                  : `${trimmedLength} character${trimmedLength === 1 ? '' : 's'} · ${lineCount} line${lineCount === 1 ? '' : 's'} ready`}
              </span>
              <button
                type="button"
                onClick={handleAnalyze}
                disabled={!text.trim() || running}
                className="rm-btn rm-btn-solid"
              >
                {running ? 'Analyzing…' : 'Run autopsy'}
              </button>
            </div>
          </motion.section>

          {/* ---- Progress --------------------------------------------------- */}
          {running && (
            <motion.section
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              className="rm-rule-t pt-8"
              aria-live="polite"
            >
              <div className="flex items-center gap-3">
                <div className="rm-spinner h-4 w-4" aria-hidden="true" />
                <span className="rm-eyebrow rm-eyebrow-accent">Autopsy in progress</span>
              </div>
              <div className="mt-5 flex flex-col gap-3">
                {progress.length === 0 && <span className="rm-micro">Waking up the diagnosis agent…</span>}
                {progress.map((line, i) => {
                  const isActive = i === progress.length - 1;
                  return (
                    <motion.div
                      key={`${i}-${line}`}
                      initial={{ opacity: 0, x: -6 }}
                      animate={{ opacity: 1, x: 0 }}
                      className="ap-step"
                      data-active={isActive ? 'true' : 'false'}
                    >
                      <span className="ap-step-mark" aria-hidden="true">
                        {isActive ? '●' : '✓'}
                      </span>
                      <span
                        className="rm-micro rm-wrap"
                        style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-muted)' }}
                      >
                        {line}
                      </span>
                    </motion.div>
                  );
                })}
              </div>
            </motion.section>
          )}

          {error && (
            <div
              className="rounded-xl border px-4 py-3"
              style={{ borderColor: 'var(--status-amber)' }}
              role="alert"
            >
              <span className="rm-micro" style={{ color: 'var(--status-amber)' }}>
                {error}
              </span>
            </div>
          )}

          {/* ---- Findings --------------------------------------------------- */}
          {result && !running && (
            <motion.section
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="rm-rule-t flex flex-col gap-10 pt-10 sm:gap-12"
              aria-live="polite"
            >
              <div>
                <div className="rm-eyebrow rm-eyebrow-accent">Diagnosis complete</div>
                <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <Stat value={result.mistakes.length} label="Mistakes read" />
                  <Stat value={result.clusters.length} label="Patterns found" accent />
                  <Stat value={result.new_edges.length} label="Connections drawn" accent />
                  <Stat value={result.new_nodes.length} label="New concepts" />
                </div>
              </div>

              {result.clusters.length === 0 && (
                <div>
                  <h3 className="rm-subtitle">No recurring pattern yet.</h3>
                  <p className="rm-body mt-2 max-w-xl">
                    Each mistake still looks like an isolated issue. Paste more mistakes over time and Autopsy
                    will surface a pattern the moment one exists.
                  </p>
                </div>
              )}

              {result.clusters.map((cluster, idx) => (
                <ClusterCard
                  key={`${cluster.pattern_label}-${idx}`}
                  index={idx}
                  cluster={cluster}
                  edges={result.new_edges.filter(
                    (e) => cluster.node_ids.includes(e.source_node_id) && cluster.node_ids.includes(e.target_node_id),
                  )}
                  mistakes={result.mistakes.filter((m) => cluster.node_ids.includes(m.node_id))}
                  labelFor={labelFor}
                  delay={idx * 0.08}
                />
              ))}

              {result.new_nodes.length > 0 && (
                <div>
                  <div className="rm-eyebrow">New concepts discovered</div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    {result.new_nodes.map((n) => (
                      <span
                        key={n.id}
                        className="rm-tag"
                        style={{
                          color: 'var(--text-primary)',
                          textTransform: 'none',
                          letterSpacing: '-0.01em',
                          fontSize: 13,
                          padding: '7px 12px',
                        }}
                      >
                        <span className="rm-dot" style={{ background: 'var(--accent-violet)' }} />
                        {n.label}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {uncategorized.length > 0 && (
                <div>
                  <div className="rm-eyebrow">Not yet part of a pattern</div>
                  <div className="mt-4 flex flex-col gap-2">
                    {uncategorized.map((m) => (
                      <MistakeRow key={m.id} mistake={m} label={labelFor(m.node_id)} />
                    ))}
                  </div>
                </div>
              )}

              <div className="rm-rule-t flex flex-col items-start gap-4 pt-8">
                <p className="rm-subtitle max-w-xl">
                  {result.new_edges.length > 0
                    ? `${result.new_edges.length} new connection${result.new_edges.length === 1 ? '' : 's'} ${result.new_edges.length === 1 ? 'is' : 'are'} now live on your graph.`
                    : 'Analysis complete — your graph reflects the latest data.'}
                </p>
                <button type="button" onClick={onClose} className="rm-btn rm-btn-solid">
                  <span aria-hidden="true">←</span> Back to graph
                </button>
              </div>
            </motion.section>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function Stat({ value, label, accent }: { value: number; label: string; accent?: boolean }) {
  return (
    <div className="ap-stat">
      <span className="ap-stat-value" style={accent ? { color: 'var(--accent-cyan)' } : undefined}>
        {pad2(value)}
      </span>
      <span className="rm-eyebrow" style={{ fontSize: 10 }}>
        {label}
      </span>
    </div>
  );
}

function ClusterCard({
  index,
  cluster,
  edges,
  mistakes,
  labelFor,
  delay,
}: {
  index: number;
  cluster: AutopsyCluster;
  edges: AutopsyEdge[];
  mistakes: MistakeRecord[];
  labelFor: (id: string) => string;
  delay: number;
}) {
  const meta = ERROR_TYPE_META[cluster.error_type] ?? ERROR_TYPE_META.concept_gap;
  const confidencePct = Math.round(cluster.confidence * 100);
  const excerpts =
    cluster.example_excerpts.length > 0
      ? cluster.example_excerpts
      : mistakes.slice(0, 3).map((m) => m.raw_excerpt);

  // Animate the confidence bar in from zero on mount.
  const [barPct, setBarPct] = useState(0);
  useEffect(() => {
    const raf = requestAnimationFrame(() => setBarPct(confidencePct));
    return () => cancelAnimationFrame(raf);
  }, [confidencePct]);

  return (
    <motion.article
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="ap-finding"
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="rm-eyebrow rm-num">Finding {pad2(index + 1)}</span>
        <span className="rm-tag" style={{ color: meta.color }}>
          <span className="rm-dot" style={{ background: meta.color }} />
          {meta.label}
        </span>
        <span className="rm-tag rm-num">Spans {cluster.node_ids.length} concepts</span>
      </div>

      <h3 className="ap-pattern mt-4">{cluster.pattern_label}</h3>
      <p className="rm-body rm-wrap mt-3 max-w-2xl">{cluster.description}</p>

      <div className="mt-6 max-w-xs">
        <div className="flex items-baseline justify-between">
          <span className="rm-eyebrow" style={{ fontSize: 10 }}>
            Confidence
          </span>
          <span className="rm-num" style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent-cyan)' }}>
            {confidencePct}%
          </span>
        </div>
        <div
          className="ap-confidence mt-2"
          role="meter"
          aria-valuenow={confidencePct}
          aria-valuemin={0}
          aria-valuemax={100}
          aria-label="Pattern confidence"
        >
          <span className="ap-confidence-fill" style={{ width: `${barPct}%` }} />
        </div>
      </div>

      {edges.length > 0 && (
        <div className="mt-7">
          <div className="rm-eyebrow rm-eyebrow-accent">
            {edges.length === 1 ? 'Connection drawn' : `${edges.length} connections drawn`}
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {edges.map((e) => (
              <div key={e.id} className="ap-link">
                <span className="ap-link-node">{labelFor(e.source_node_id)}</span>
                <span className="ap-link-arrow" aria-hidden="true">
                  ↔
                </span>
                <span className="ap-link-node">{labelFor(e.target_node_id)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {excerpts.length > 0 && (
        <div className="mt-7">
          <div className="rm-eyebrow" style={{ fontSize: 10 }}>
            Evidence
          </div>
          <div className="mt-3 flex flex-col gap-2">
            {excerpts.map((excerpt, i) => (
              <p key={i} className="ap-quote">
                &ldquo;{excerpt}&rdquo;
              </p>
            ))}
          </div>
        </div>
      )}
    </motion.article>
  );
}

function MistakeRow({ mistake, label }: { mistake: MistakeRecord; label: string }) {
  const meta = ERROR_TYPE_META[mistake.error_type] ?? ERROR_TYPE_META.concept_gap;
  return (
    <div
      className="flex flex-col gap-1.5 rounded-xl px-4 py-3 sm:flex-row sm:gap-4"
      style={{ border: '1px solid var(--border-glass)', background: 'rgba(255, 255, 255, 0.022)' }}
    >
      <span
        className="rm-eyebrow flex-shrink-0 sm:w-40"
        style={{ color: meta.color, fontSize: 10 }}
      >
        {label}
      </span>
      <span className="rm-micro rm-wrap min-w-0" style={{ color: 'var(--text-secondary)' }}>
        {mistake.raw_excerpt}
      </span>
    </div>
  );
}

export default Autopsy;
