import { useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
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

const DOLLY_START_Z = 60;
const DOLLY_REST_Z = 36;
const DOLLY_DURATION = 1.8;

/**
 * One-shot camera dolly-in on mount: starts pulled back, eases into its
 * resting distance over ~1.8s. Must run (and be declared) *before*
 * <OrbitControls> in the tree — r3f fires useFrame subscriptions in
 * registration order, so this repositions the camera first each frame and
 * OrbitControls.update() picks up the new position as its base radius.
 */
function CameraDolly() {
  const { camera } = useThree();
  const elapsed = useRef(0);
  const done = useRef(false);

  useFrame((_state, delta) => {
    if (done.current) return;
    elapsed.current += delta;
    const raw = Math.min(1, elapsed.current / DOLLY_DURATION);
    const eased = 1 - (1 - raw) ** 3; // ease-out cubic
    camera.position.z = DOLLY_START_Z + (DOLLY_REST_Z - DOLLY_START_Z) * eased;
    if (raw >= 1) done.current = true;
  });

  return null;
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
      camera={{ position: [0, 12, DOLLY_START_Z], fov: 43, near: 0.1, far: 300 }}
      onPointerMissed={() => onSelectNode(null)}
    >
      <fog attach="fog" args={['#04050c', 46, 130]} />
      <ambientLight intensity={0.32} color="#8fa8ff" />
      <pointLight position={[24, 22, 18]} intensity={22} color="#67e8f9" distance={140} decay={2} />
      <pointLight position={[-24, -12, -20]} intensity={18} color="#a78bfa" distance={140} decay={2} />
      <Stars radius={150} depth={80} count={1600} factor={2.0} saturation={0} fade speed={0.22} />

      <CameraDolly />

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
        <Bloom luminanceThreshold={0.9} intensity={0.7} mipmapBlur luminanceSmoothing={0.2} radius={0.7} />
      </EffectComposer>
    </Canvas>
  );
}
