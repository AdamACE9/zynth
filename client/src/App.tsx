import { useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Edge, Node } from '@zynth/shared';
import { fetchGraph } from './lib/api';
import { useLiveGraph } from './lib/socket';
import { useAppView } from './lib/appView';
import { KnowledgeGraph } from './graph/KnowledgeGraph';
import { TopBar } from './ui/TopBar';
import { Legend } from './ui/Legend';
import { NodePanel } from './ui/NodePanel';
import { WarRoom } from './screens/WarRoom';
import { Quiz } from './screens/Quiz';
import { Explain } from './screens/Explain';
import { Autopsy } from './screens/Autopsy';
import { StudyPlan } from './screens/StudyPlan';
import { ExamSim } from './screens/ExamSim';
import { TimeMachine } from './screens/TimeMachine';
import { Landing } from './site/Landing';
import { Onboarding } from './onboarding/Onboarding';

interface GraphPayload {
  nodes: Node[];
  edges: Edge[];
}

/** Which full-screen overlay (if any) is mounted on top of the ever-present graph. */
type ActiveScreen = {
  type: 'warroom' | 'quiz' | 'explain' | 'autopsy' | 'plan' | 'exam' | 'timemachine';
  nodeId: string | null;
};

/**
 * Top-level surface router. Zynth needs NO LOGIN, so the whole model is:
 * public site -> (first-run) onboarding -> the graph app. See lib/appView.ts.
 */
export default function App() {
  const { view, enterApp, startOnboarding, completeOnboarding, skipOnboarding, goLanding } = useAppView();

  // The r3f <Canvas> sizes itself via ResizeObserver. A few environments
  // (headless preview panes, embedded/kiosk webviews) don't fire the *initial*
  // observer callback, leaving the canvas stuck at its 300x150 default. Nudging
  // a resize forces react-use-measure's window-event fallback to run. Harmless
  // in normal browsers; re-run on view change since the graph mounts late.
  useEffect(() => {
    const nudge = () => window.dispatchEvent(new Event('resize'));
    const raf = requestAnimationFrame(nudge);
    const t = setTimeout(nudge, 200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, [view]);

  // The full-viewport vignette + heavy grain exist to frame the 3D graph; over
  // a long scrolling page they just wash everything grey. index.css keys off this.
  useEffect(() => {
    document.body.dataset.view = view;
  }, [view]);

  // NOTE: deliberately NOT <AnimatePresence mode="wait">. That waits for the
  // outgoing view's exit animation to finish before mounting the next one, and
  // if any nested motion element never settles the exit never completes — the
  // view state flips to 'graph' while the DOM keeps showing onboarding forever
  // (i.e. "Open Zynth" silently does nothing). Keying the incoming view and
  // animating enter-only can't deadlock.
  return (
    <motion.div
      key={view}
      className="h-full w-full"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: view === 'graph' ? 0.4 : 0.25 }}
    >
      {view === 'landing' && <Landing onEnter={enterApp} onStartTour={startOnboarding} />}
      {view === 'onboarding' && (
        <Onboarding onComplete={completeOnboarding} onSkip={skipOnboarding} onBackToSite={goLanding} />
      )}
      {view === 'graph' && <GraphApp />}
    </motion.div>
  );
}

const HINT_KEY = 'zynth.graphHintSeen.v1';

/** The product itself: the living 3D knowledge graph plus its full-screen rooms. */
function GraphApp() {
  const [initialGraph, setInitialGraph] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeScreen, setActiveScreen] = useState<ActiveScreen | null>(null);
  const [hintDismissed, setHintDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HINT_KEY) === '1';
    } catch {
      return false;
    }
  });

  useEffect(() => {
    let cancelled = false;
    fetchGraph()
      .then((graph) => {
        if (!cancelled) setInitialGraph(graph);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // The r3f canvas mounts a beat after this view does, and some embedded
  // webviews never fire the initial ResizeObserver — leaving it at 300x150.
  // A few staggered nudges guarantee it measures once it exists.
  useEffect(() => {
    const timers = [80, 350, 900].map((ms) => window.setTimeout(() => window.dispatchEvent(new Event('resize')), ms));
    return () => timers.forEach(clearTimeout);
  }, []);

  function dismissHint() {
    setHintDismissed(true);
    try {
      localStorage.setItem(HINT_KEY, '1');
    } catch {
      /* storage disabled — the hint just reappears next session */
    }
  }

  const { nodes, edges, connected, patchNode, replaceNode } = useLiveGraph(initialGraph);
  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const activeScreenNode = activeScreen?.nodeId ? nodes.find((n) => n.id === activeScreen.nodeId) ?? null : null;

  function openScreen(type: ActiveScreen['type'], nodeId: string | null) {
    setActiveScreen({ type, nodeId });
  }

  function closeScreen() {
    setActiveScreen(null);
  }

  // Esc closes whatever is on top: a room first, then the node panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeScreen) setActiveScreen(null);
      else if (selectedId) setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeScreen, selectedId]);

  return (
    <div className="relative h-full w-full">
      <KnowledgeGraph nodes={nodes} edges={edges} selectedNodeId={selectedId} onSelectNode={setSelectedId} />
      <TopBar
        connected={connected}
        onOpenAutopsy={() => openScreen('autopsy', null)}
        onOpenPlan={() => openScreen('plan', null)}
        onOpenExam={() => openScreen('exam', null)}
        onOpenTimeMachine={() => openScreen('timemachine', null)}
      />
      <Legend />

      {/* Loading / empty states — never leave the user staring at an unexplained void. */}
      <AnimatePresence>
        {/* Still fetching, OR fetched-with-content that hasn't propagated into
            live state yet. Without the second clause the "can't reach the
            server" panel flashes for a frame on a perfectly good load. */}
        {nodes.length === 0 && (loading || (initialGraph?.nodes.length ?? 0) > 0) && (
          <motion.div
            key="graph-loading"
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="glass-panel flex items-center gap-3 px-5 py-4">
              <motion.span
                className="h-4 w-4 rounded-full border-2 border-transparent"
                style={{ borderTopColor: 'var(--accent-cyan)', borderRightColor: 'var(--accent-cyan)' }}
                animate={{ rotate: 360 }}
                transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
              />
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Building your knowledge graph…
              </span>
            </div>
          </motion.div>
        )}

        {!loading && nodes.length === 0 && (initialGraph?.nodes.length ?? 0) === 0 && (
          <motion.div
            key="graph-empty"
            className="absolute inset-0 z-10 flex items-center justify-center p-6"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="glass-panel max-w-sm p-6 text-center">
              <h3 className="font-display text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
                No concepts yet
              </h3>
              <p className="mt-2 text-sm" style={{ color: 'var(--text-secondary)' }}>
                Zynth couldn&apos;t reach the graph server, so there&apos;s nothing to map yet. Make sure the backend is
                running, then reload.
              </p>
              <button className="btn-primary mt-4" onClick={() => window.location.reload()}>
                Retry
              </button>
            </div>
          </motion.div>
        )}

        {/* First-run nudge — the single most useful thing to tell someone landing on a 3D graph. */}
        {!loading && nodes.length > 0 && !hintDismissed && !selectedNode && !activeScreen && (
          <motion.div
            key="graph-hint"
            className="absolute inset-x-0 bottom-8 z-10 flex justify-center px-6"
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 8 }}
            transition={{ delay: 1.2 }}
          >
            <div className="glass-chip flex items-center gap-3 px-4 py-2.5">
              <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>
                Click any glowing node to see what you actually know about it.
              </span>
              <button
                onClick={dismissHint}
                className="text-xs transition-colors duration-150"
                style={{ color: 'var(--text-muted)' }}
                aria-label="Dismiss hint"
              >
                Got it
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedNode && (
          <NodePanel
            key={selectedNode.id}
            node={selectedNode}
            onClose={() => setSelectedId(null)}
            patchNode={patchNode}
            replaceNode={replaceNode}
            onOpenScreen={openScreen}
          />
        )}
      </AnimatePresence>
      {/* Full-screen rooms — the graph stays mounted behind them at all times. */}
      <AnimatePresence>
        {activeScreen?.type === 'warroom' && activeScreenNode && (
          <WarRoom key="warroom" node={activeScreenNode} onClose={closeScreen} patchNode={patchNode} replaceNode={replaceNode} />
        )}
        {activeScreen?.type === 'quiz' && activeScreenNode && (
          <Quiz key="quiz" node={activeScreenNode} onClose={closeScreen} patchNode={patchNode} replaceNode={replaceNode} />
        )}
        {activeScreen?.type === 'explain' && activeScreenNode && (
          <Explain key="explain" node={activeScreenNode} onClose={closeScreen} patchNode={patchNode} replaceNode={replaceNode} />
        )}
        {activeScreen?.type === 'autopsy' && <Autopsy key="autopsy" onClose={closeScreen} />}
        {activeScreen?.type === 'plan' && <StudyPlan key="plan" onClose={closeScreen} />}
        {activeScreen?.type === 'exam' && <ExamSim key="exam" onClose={closeScreen} />}
        {activeScreen?.type === 'timemachine' && <TimeMachine key="timemachine" onClose={closeScreen} />}
      </AnimatePresence>
    </div>
  );
}
