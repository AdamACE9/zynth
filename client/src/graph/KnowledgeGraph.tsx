import { Canvas } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import type { Edge, Node } from '@zynth/shared';
import { useGraphLayout } from './useGraphLayout';
import { NodeMesh } from './NodeMesh';
import { Edges } from './Edges';
import { ClusterLabels } from './ClusterLabels';

interface KnowledgeGraphProps {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

/**
 * The hero shot: a deep-space 3D "mastery map". Dark transparent canvas (the
 * page's own nebula gradient shows through), starfield, gentle auto-rotate,
 * bloom on the emissive node materials, and the constellation layout from
 * useGraphLayout.
 */
export function KnowledgeGraph({ nodes, edges, selectedNodeId, onSelectNode }: KnowledgeGraphProps) {
  const { positions, clusterAnchors } = useGraphLayout(nodes, edges);

  return (
    <Canvas
      className="absolute inset-0"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, 12, 36], fov: 50, near: 0.1, far: 300 }}
      onPointerMissed={() => onSelectNode(null)}
    >
      <fog attach="fog" args={['#05060f', 26, 78]} />
      <ambientLight intensity={0.4} color="#8fa8ff" />
      <pointLight position={[24, 22, 18]} intensity={40} color="#67e8f9" distance={120} decay={2} />
      <pointLight position={[-24, -12, -20]} intensity={35} color="#a78bfa" distance={120} decay={2} />
      <Stars radius={110} depth={60} count={3500} factor={3.5} saturation={0} fade speed={0.4} />

      <Edges edges={edges} positions={positions} />

      {nodes.map((node) => {
        const position = positions.get(node.id);
        if (!position) return null;
        return (
          <NodeMesh
            key={node.id}
            node={node}
            position={position}
            isSelected={selectedNodeId === node.id}
            onSelect={onSelectNode}
          />
        );
      })}

      <ClusterLabels anchors={clusterAnchors} />

      <OrbitControls
        autoRotate
        autoRotateSpeed={0.35}
        enableDamping
        dampingFactor={0.08}
        minDistance={12}
        maxDistance={70}
        maxPolarAngle={Math.PI * 0.82}
      />

      <EffectComposer>
        <Bloom luminanceThreshold={1} intensity={1.15} mipmapBlur luminanceSmoothing={0.4} />
      </EffectComposer>
    </Canvas>
  );
}
