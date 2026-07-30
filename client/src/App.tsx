import { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { Edge, Node } from '@zynth/shared';
import { fetchGraph, type Workspace } from './lib/api';
import { useLiveGraph, getSocket } from './lib/socket';
import { useAppView } from './lib/appView';
import { KnowledgeGraph } from './graph/KnowledgeGraph';
import { TopBar } from './ui/TopBar';
import { Legend } from './ui/Legend';
import { NodePanel } from './ui/NodePanel';
import { Intuition } from './screens/Intuition';
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
  type: 'intuition' | 'quiz' | 'explain' | 'autopsy' | 'plan' | 'exam' | 'timemachine';
  nodeId: string | null;
};

/**
 * Top-level surface router. Zynth needs NO LOGIN, so the whole model is:
 * public site -> (first-run) onboarding -> the graph app. See lib/appView.ts.
 */
export default function App() {
  const {
    view,
    prefs,
    onboardingMode,
    enterApp,
    startOnboarding,
    startNewWorkspace,
    completeOnboarding,
    skipOnboarding,
    cancelNewWorkspace,
    goLanding,
  } = useAppView();

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

  // Two things key off this in index.css:
  //   1. the full-viewport vignette + heavy grain, which frame the 3D graph but
  //      just wash a long scrolling page grey;
  //   2. the viewport lock. The graph app owns the screen and must never
  //      scroll; the marketing site is a ~7700px document and must. That lock
  //      lives on <html> as well as <body>, so the attribute goes on both
  //      rather than making the CSS depend on :has().
  useEffect(() => {
    document.body.dataset.view = view;
    document.documentElement.dataset.view = view;
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
      {view === 'loading' && (
        <div className="flex h-full w-full items-center justify-center">
          <motion.span
            className="h-5 w-5 rounded-full border-2 border-transparent"
            style={{ borderTopColor: 'var(--accent-cyan)', borderRightColor: 'var(--accent-cyan)' }}
            animate={{ rotate: 360 }}
            transition={{ duration: 0.9, repeat: Infinity, ease: 'linear' }}
          />
        </div>
      )}
      {view === 'landing' && <Landing onEnter={enterApp} onStartTour={startOnboarding} />}
      {view === 'onboarding' && (
        <Onboarding
          mode={onboardingMode}
          namePrefill={prefs.name}
          onComplete={completeOnboarding}
          onSkip={onboardingMode === 'full' ? skipOnboarding : cancelNewWorkspace}
          onBackToSite={onboardingMode === 'full' ? goLanding : cancelNewWorkspace}
        />
      )}
      {view === 'graph' && <GraphApp onRequestNewWorkspace={startNewWorkspace} />}
    </motion.div>
  );
}

const HINT_KEY = 'zynth.graphHintSeen.v1';

/**
 * Tracks the shared socket's connection state independent of any particular
 * workspace's node data — TopBar shows this even while <GraphStage> below is
 * being remounted for a workspace switch. Reuses the same singleton socket
 * useLiveGraph subscribes to (see lib/socket.ts#getSocket), just without
 * pulling in the heavier node/edge reconciliation it also does.
 */
function useSocketConnected(): boolean {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    const s = getSocket();
    setConnected(s.connected);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    s.on('connect', onConnect);
    s.on('disconnect', onDisconnect);
    return () => {
      s.off('connect', onConnect);
      s.off('disconnect', onDisconnect);
    };
  }, []);
  return connected;
}

interface GraphAppProps {
  /** Wired to the WorkspaceTabs "+" — hands off to the newWorkspace onboarding flow. */
  onRequestNewWorkspace: () => void;
}

/**
 * The product itself: the top chrome (with workspace tabs) plus the living
 * 3D knowledge graph and its full-screen rooms.
 *
 * `activeScreen` lives HERE (not in <GraphStage>) because TopBar's Plan /
 * Timeline / Exam / Autopsy buttons must be able to open a room even though
 * they sit outside the part of the tree that gets remounted on a workspace
 * switch. The graph-fetching half is split into <GraphStage> and re-keyed by
 * the active workspace id, so switching graphs via the tabs forces a clean
 * refetch + reseed instead of silently keeping the old workspace's nodes on
 * screen (see socket.ts's useLiveGraph, which only ever seeds once per mount
 * by design).
 */
function GraphApp({ onRequestNewWorkspace }: GraphAppProps) {
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [activeScreen, setActiveScreen] = useState<ActiveScreen | null>(null);
  const connected = useSocketConnected();

  const openScreen = useCallback((type: ActiveScreen['type'], nodeId: string | null) => {
    setActiveScreen({ type, nodeId });
  }, []);
  const closeScreen = useCallback(() => setActiveScreen(null), []);

  const handleWorkspaceSwitched = useCallback((workspace: Workspace) => {
    setActiveWorkspaceId(workspace.id);
    // A screen scoped to a node from the OLD workspace wouldn't resolve to
    // anything in the new one — close it rather than leave a room stranded.
    setActiveScreen(null);
  }, []);

  return (
    <div className="relative h-full w-full">
      <GraphStage
        key={activeWorkspaceId ?? 'initial'}
        activeScreen={activeScreen}
        openScreen={openScreen}
        closeScreen={closeScreen}
      />
      <TopBar
        connected={connected}
        onOpenAutopsy={() => openScreen('autopsy', null)}
        onOpenPlan={() => openScreen('plan', null)}
        onOpenExam={() => openScreen('exam', null)}
        onOpenTimeMachine={() => openScreen('timemachine', null)}
        onWorkspaceSwitched={handleWorkspaceSwitched}
        onCreateWorkspace={onRequestNewWorkspace}
      />
      <Legend />
    </div>
  );
}

interface GraphStageProps {
  activeScreen: ActiveScreen | null;
  openScreen: (type: ActiveScreen['type'], nodeId: string | null) => void;
  closeScreen: () => void;
}

/**
 * Everything that depends on "which workspace's graph is this": the fetch,
 * the live socket state, node selection, and the full-screen rooms (given
 * `activeScreen` state from the parent, since TopBar can also open one).
 * Kept separate from <GraphApp> purely so it can be remounted wholesale (via
 * a `key` in the parent) when the active workspace changes.
 */
function GraphStage({ activeScreen, openScreen, closeScreen }: GraphStageProps) {
  const [initialGraph, setInitialGraph] = useState<GraphPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hintDismissed, setHintDismissed] = useState<boolean>(() => {
    try {
      return localStorage.getItem(HINT_KEY) === '1';
    } catch {
      return false;
    }
  });

  /**
   * Load the active workspace's graph, and keep trying until we actually have
   * one.
   *
   * The previous version fired once and discarded its result if the component
   * had unmounted — which is correct in isolation, but this component is
   * re-keyed on the active workspace id, so a mount race could leave the
   * surviving instance with `loading` stuck true and no data. The visible
   * symptom was the app sitting on "Building your knowledge graph…" forever
   * while /api/graph happily returned 21 nodes.
   *
   * Now it re-polls while it has nothing to show, so no ordering of mounts,
   * StrictMode double-invokes or workspace switches can strand the UI.
   */
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;

    const attempt = async () => {
      const graph = await fetchGraph();
      if (cancelled) return;
      setInitialGraph(graph);
      setLoading(false);
      if (graph.nodes.length === 0) {
        timer = window.setTimeout(attempt, 1500);
      }
    };

    void attempt();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
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

  const { nodes, edges, patchNode, replaceNode } = useLiveGraph(initialGraph);
  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;
  const activeScreenNode = activeScreen?.nodeId ? nodes.find((n) => n.id === activeScreen.nodeId) ?? null : null;

  // Esc closes whatever is on top: a room first, then the node panel.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (activeScreen) closeScreen();
      else if (selectedId) setSelectedId(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [activeScreen, selectedId, closeScreen]);

  return (
    <>
      <KnowledgeGraph nodes={nodes} edges={edges} selectedNodeId={selectedId} onSelectNode={setSelectedId} />

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
        {activeScreen?.type === 'intuition' && activeScreenNode && (
          <Intuition
            key="intuition"
            node={activeScreenNode}
            onClose={closeScreen}
            patchNode={patchNode}
            replaceNode={replaceNode}
            onOpenScreen={openScreen}
          />
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
    </>
  );
}
