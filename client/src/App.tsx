import { useEffect, useState } from 'react';
import { AnimatePresence } from 'motion/react';
import type { Edge, Node } from '@zynth/shared';
import { fetchGraph } from './lib/api';
import { useLiveGraph } from './lib/socket';
import { KnowledgeGraph } from './graph/KnowledgeGraph';
import { TopBar } from './ui/TopBar';
import { Legend } from './ui/Legend';
import { NodePanel } from './ui/NodePanel';

interface GraphPayload {
  nodes: Node[];
  edges: Edge[];
}

export default function App() {
  const [initialGraph, setInitialGraph] = useState<GraphPayload | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGraph().then((graph) => {
      if (!cancelled) setInitialGraph(graph);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  // r3f's <Canvas> sizes itself via ResizeObserver. A few environments
  // (headless preview panes, some embedded webviews) don't fire the *initial*
  // observer callback, leaving the canvas stuck at its 300x150 default. Nudging
  // a resize on mount forces react-use-measure's window-event fallback to run.
  // Harmless in normal browsers (one extra measure); guarantees a sized canvas
  // everywhere — including on demo day if the app is embedded/kiosked.
  useEffect(() => {
    const nudge = () => window.dispatchEvent(new Event('resize'));
    const raf = requestAnimationFrame(nudge);
    const t = setTimeout(nudge, 200);
    return () => {
      cancelAnimationFrame(raf);
      clearTimeout(t);
    };
  }, []);

  const { nodes, edges, connected, patchNode, replaceNode } = useLiveGraph(initialGraph);
  const selectedNode = nodes.find((n) => n.id === selectedId) ?? null;

  return (
    <div className="relative h-full w-full">
      <KnowledgeGraph
        nodes={nodes}
        edges={edges}
        selectedNodeId={selectedId}
        onSelectNode={setSelectedId}
      />
      <TopBar connected={connected} />
      <Legend />
      <AnimatePresence>
        {selectedNode && (
          <NodePanel
            key={selectedNode.id}
            node={selectedNode}
            onClose={() => setSelectedId(null)}
            patchNode={patchNode}
            replaceNode={replaceNode}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
