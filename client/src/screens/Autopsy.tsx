import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import type { ErrorType, MistakeRecord } from '@zynth/shared';
import { fetchGraph, runAutopsy } from '../lib/api';
import { getSocket } from '../lib/socket';

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

/**
 * Full-screen Autopsy Board overlay. Paste (or load a sample of) raw
 * homework/test mistakes, run them through POST /api/autopsy, and watch
 * Zynth extract each mistake onto a concept node, cluster recurring failure
 * patterns across nodes, and wire up `correlated_error` edges live — the
 * graph behind this overlay redraws those edges itself via useLiveGraph.
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

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-30 flex flex-col overflow-y-auto bg-black/70 backdrop-blur-md"
    >
      <Header onClose={onClose} />

      <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 px-6 pb-16 pt-6">
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-panel px-5 py-5"
        >
          <div className="flex items-center justify-between">
            <div className="section-label">Paste mistakes</div>
            <button
              onClick={() => setText(SAMPLE_TEXT)}
              disabled={running}
              className="glass-chip btn-chip px-3 py-1.5 text-xs font-medium disabled:opacity-50"
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
            className="glass-chip mt-3 w-full resize-none rounded-lg px-3.5 py-3 text-sm outline-none placeholder:text-white/25 disabled:opacity-60"
            style={{ color: 'var(--text-primary)' }}
          />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              {text.trim().length === 0 ? 'Nothing to analyze yet.' : `${text.trim().split(/\r?\n+/).filter(Boolean).length} line(s) ready.`}
            </span>
            <button
              onClick={handleAnalyze}
              disabled={!text.trim() || running}
              className="btn-primary px-6 py-2.5 text-sm font-semibold"
            >
              {running ? 'Analyzing…' : 'Analyze'}
            </button>
          </div>
        </motion.div>

        {running && (
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-panel flex flex-col gap-2 px-5 py-5"
          >
            <div className="flex items-center gap-3">
              <div className="relative h-4 w-4 shrink-0">
                <div
                  className="absolute inset-0 animate-spin rounded-full border-2 border-transparent"
                  style={{ borderTopColor: 'var(--accent-cyan)', borderRightColor: 'var(--accent-cyan)' }}
                />
              </div>
              <span className="section-label">Autopsy in progress</span>
            </div>
            <div className="flex flex-col gap-1.5 pl-7">
              {progress.length === 0 && (
                <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  Waking up the diagnosis agent…
                </span>
              )}
              {progress.map((line, i) => (
                <motion.span
                  key={`${i}-${line}`}
                  initial={{ opacity: 0, x: -6 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="text-xs"
                  style={{ color: i === progress.length - 1 ? 'var(--text-secondary)' : 'var(--text-muted)' }}
                >
                  {line}
                </motion.span>
              ))}
            </div>
          </motion.div>
        )}

        {error && (
          <div className="glass-chip px-4 py-2 text-xs" style={{ color: 'var(--status-amber)' }}>
            {error}
          </div>
        )}

        {result && !running && (
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col gap-5">
            <div className="flex items-center gap-4 text-xs" style={{ color: 'var(--text-muted)' }}>
              <span>{result.mistakes.length} mistake{result.mistakes.length === 1 ? '' : 's'} extracted</span>
              <span>·</span>
              <span>{result.clusters.length} pattern{result.clusters.length === 1 ? '' : 's'} found</span>
              <span>·</span>
              <span>{result.new_nodes.length} new node{result.new_nodes.length === 1 ? '' : 's'}</span>
              <span>·</span>
              <span>{result.new_edges.length} new connection{result.new_edges.length === 1 ? '' : 's'}</span>
            </div>

            {result.clusters.length === 0 && (
              <div className="glass-panel px-5 py-6 text-center text-sm" style={{ color: 'var(--text-secondary)' }}>
                No recurring cross-concept pattern yet — each mistake looks like an isolated issue so far. Paste more
                mistakes over time and Autopsy will surface a pattern once one exists.
              </div>
            )}

            {result.clusters.map((cluster, idx) => (
              <ClusterCard
                key={`${cluster.pattern_label}-${idx}`}
                cluster={cluster}
                edges={result.new_edges.filter(
                  (e) => cluster.node_ids.includes(e.source_node_id) && cluster.node_ids.includes(e.target_node_id),
                )}
                mistakes={result.mistakes.filter((m) => cluster.node_ids.includes(m.node_id))}
                labelFor={labelFor}
                delay={idx * 0.08}
              />
            ))}

            {uncategorized.length > 0 && (
              <div className="glass-panel px-5 py-5">
                <div className="section-label">Not yet part of a pattern</div>
                <div className="mt-3 flex flex-col gap-2">
                  {uncategorized.map((m) => (
                    <MistakeRow key={m.id} mistake={m} label={labelFor(m.node_id)} />
                  ))}
                </div>
              </div>
            )}
          </motion.div>
        )}
      </div>
    </motion.div>
  );
}

function Header({ onClose }: { onClose: () => void }) {
  return (
    <div className="sticky top-0 z-10 border-b border-white/5 bg-black/30 backdrop-blur-xl">
      <div className="mx-auto flex w-full max-w-3xl items-center justify-between px-6 py-5">
        <div>
          <div className="section-label">Whole-graph diagnosis</div>
          <h1 className="font-display mt-1 text-2xl font-semibold" style={{ color: 'var(--text-primary)' }}>
            Autopsy Board
          </h1>
        </div>
        <button
          onClick={onClose}
          className="glass-chip btn-chip flex h-9 w-9 items-center justify-center text-sm"
          aria-label="Close autopsy board"
        >
          {'✕'}
        </button>
      </div>
    </div>
  );
}

function ClusterCard({
  cluster,
  edges,
  mistakes,
  labelFor,
  delay,
}: {
  cluster: AutopsyCluster;
  edges: AutopsyEdge[];
  mistakes: MistakeRecord[];
  labelFor: (id: string) => string;
  delay: number;
}) {
  const meta = ERROR_TYPE_META[cluster.error_type] ?? ERROR_TYPE_META.concept_gap;
  const confidencePct = Math.round(cluster.confidence * 100);

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
      className="glass-panel px-5 py-5"
      style={{ boxShadow: '0 8px 40px rgba(0,0,0,0.45), inset 0 1px 0 var(--border-inner-highlight), 0 0 40px rgba(255,59,92,0.08)' }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="glass-chip inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium"
          style={{ color: meta.color }}
        >
          <span
            className="h-1.5 w-1.5 rounded-full"
            style={{ backgroundColor: meta.color, boxShadow: `0 0 8px ${meta.color}` }}
          />
          {meta.label}
        </span>
        <span className="glass-chip px-2.5 py-1 text-xs font-medium" style={{ color: 'var(--accent-cyan)' }}>
          {confidencePct}% confidence
        </span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          spans {cluster.node_ids.length} concepts
        </span>
      </div>

      <h3 className="font-display mt-3 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
        {cluster.pattern_label}
      </h3>
      <p className="mt-1.5 text-sm leading-relaxed" style={{ color: 'var(--text-secondary)' }}>
        {cluster.description}
      </p>

      {edges.length > 0 && (
        <div className="mt-3 flex flex-col gap-1.5">
          {edges.map((e) => (
            <div key={e.id} className="flex items-center gap-2 text-xs" style={{ color: 'var(--accent-cyan)' }}>
              <span aria-hidden="true">✦</span>
              Zynth connected {labelFor(e.source_node_id)} ↔ {labelFor(e.target_node_id)}
            </div>
          ))}
        </div>
      )}

      {(cluster.example_excerpts.length > 0 ? cluster.example_excerpts : mistakes.map((m) => m.raw_excerpt)).length >
        0 && (
        <div className="mt-4 flex flex-col gap-2 border-t border-white/5 pt-3">
          {(cluster.example_excerpts.length > 0
            ? cluster.example_excerpts
            : mistakes.slice(0, 3).map((m) => m.raw_excerpt)
          ).map((excerpt, i) => (
            <div key={i} className="glass-chip px-3 py-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
              &ldquo;{excerpt}&rdquo;
            </div>
          ))}
        </div>
      )}
    </motion.div>
  );
}

function MistakeRow({ mistake, label }: { mistake: MistakeRecord; label: string }) {
  const meta = ERROR_TYPE_META[mistake.error_type] ?? ERROR_TYPE_META.concept_gap;
  return (
    <div className="glass-chip flex items-start gap-2 px-3 py-2 text-xs">
      <span className="mt-0.5 shrink-0 font-medium" style={{ color: meta.color }}>
        {label}
      </span>
      <span style={{ color: 'var(--text-secondary)' }}>{mistake.raw_excerpt}</span>
    </div>
  );
}

export default Autopsy;
