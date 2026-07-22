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
