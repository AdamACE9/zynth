import { useRef } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, Stars } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import type { Edge, Node } from '@zynth/shared';
import { useGraphLayout } from './useGraphLayout';
import { NodeMesh } from './NodeMesh';
import { Edges } from './Edges';
import { ClusterLabels } from './ClusterLabels';
import { GhostPath } from './GhostPath';

interface KnowledgeGraphProps {
  nodes: Node[];
  edges: Edge[];
  selectedNodeId: string | null;
  onSelectNode: (id: string | null) => void;
}

const DOLLY_DURATION = 1.8;
const CAMERA_FOV = 43;
/** Height above the graph, as a fraction of rest distance — a slight look-down
 *  so the constellation reads as a volume rather than a flat plane. */
const CAMERA_Y = 0.22;

/**
 * How far back the camera has to sit for the whole graph to fit.
 *
 * This used to be a hard-coded 36, which only ever framed a graph of one
 * particular size. useGraphLayout anchors clusters at
 * `max(11, clusters.length * 6)` from the origin, so the extent grows with the
 * number of subjects — at two subjects the constellation already spans wider
 * than a z=36 camera can see, and every edge ran off the side of the screen.
 *
 * Derived from the actual laid-out positions instead: take the furthest node,
 * and solve the vertical FOV for the distance that fits it with headroom. The
 * horizontal axis is the tighter constraint on a wide viewport, so the margin
 * is generous rather than exact.
 */
function restDistanceFor(positions: Map<string, [number, number, number]>): number {
  let maxR = 0;
  for (const [x, y, z] of positions.values()) {
    maxR = Math.max(maxR, Math.hypot(x, y, z));
  }
  if (maxR === 0) return 36; // empty graph — keep the old default
  const halfFov = (CAMERA_FOV / 2) * (Math.PI / 180);
  // 1.3 gives real breathing room without shrinking every node to a dot. It was
  // 1.8, chosen when cluster anchors sprawled to radius 78 for 13 subjects; now
  // that useGraphLayout derives the ring from a constant arc gap the extra 40%
  // of empty space just pushed the camera into the clamp below.
  return Math.min(140, Math.max(28, (maxR / Math.tan(halfFov)) * 1.3));
}

/**
 * One-shot camera dolly-in on mount: starts pulled back, eases into its
 * resting distance over ~1.8s. Must run (and be declared) *before*
 * <OrbitControls> in the tree — r3f fires useFrame subscriptions in
 * registration order, so this repositions the camera first each frame and
 * OrbitControls.update() picks up the new position as its base radius.
 */
function CameraDolly({ restZ }: { restZ: number }) {
  const { camera } = useThree();
  const elapsed = useRef(0);
  const done = useRef(false);
  const startZ = restZ * 1.65;

  useFrame((_state, delta) => {
    if (done.current) return;
    elapsed.current += delta;
    const raw = Math.min(1, elapsed.current / DOLLY_DURATION);
    const eased = 1 - (1 - raw) ** 3; // ease-out cubic
    camera.position.z = startZ + (restZ - startZ) * eased;
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
  const restZ = restDistanceFor(positions);

  return (
    <Canvas
      className="absolute inset-0"
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      camera={{ position: [0, restZ * CAMERA_Y, restZ * 1.65], fov: CAMERA_FOV, near: 0.1, far: 400 }}
      onPointerMissed={() => onSelectNode(null)}
      onCreated={({ gl }) => {
        // Survive a lost GPU context instead of going black forever.
        //
        // The browser only fires `webglcontextrestored` if something called
        // preventDefault() on `webglcontextlost` — otherwise the context is
        // gone for good and the canvas stays blank with nothing in the console
        // but "THREE.WebGLRenderer: Context Lost". This is not exotic: a driver
        // hiccup, the tab backgrounding, or another canvas mounting can all
        // trigger it, and on this screen it means the entire product disappears
        // while every API call keeps succeeding.
        const canvas = gl.domElement;
        canvas.addEventListener(
          'webglcontextlost',
          (event) => {
            event.preventDefault();
            console.warn('[graph] WebGL context lost — waiting for restore');
          },
          false,
        );
        canvas.addEventListener('webglcontextrestored', () => {
          console.warn('[graph] WebGL context restored');
        });
      }}
    >
      {/* Fog has to track the camera distance. Pinned at its old [46, 130] it
          swallowed the far half of any graph the moment the camera pulled back
          far enough to actually frame it. */}
      <fog attach="fog" args={['#04050c', restZ * 1.05, restZ * 3.2]} />
      <ambientLight intensity={0.32} color="#8fa8ff" />
      <pointLight position={[24, 22, 18]} intensity={22} color="#67e8f9" distance={140} decay={2} />
      <pointLight position={[-24, -12, -20]} intensity={18} color="#a78bfa" distance={140} decay={2} />
      <Stars radius={150} depth={80} count={1600} factor={2.0} saturation={0} fade speed={0.22} />

      <CameraDolly restZ={restZ} />

      <Edges edges={edges} positions={positions} />
      <GhostPath positions={positions} />

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

      {/* Zoom bounds derive from the graph's own size, not fixed numbers. A
          hardcoded maxDistance of 70 fought the dolly on any large graph: rest
          distance for 13 subjects computes well past it, so OrbitControls
          clamped the camera back every frame while CameraDolly pushed it out.

          The range is deliberately wide — 0.06x lets you get right inside a
          single constellation to read individual nodes, 3.2x pulls back far
          enough to see all thirteen at once. Panning is enabled so you can move
          the centre of rotation to the subject you care about instead of
          always orbiting the origin, and maxPolarAngle is gone so you can go
          over the top and look straight down at the map. */}
      <OrbitControls
        autoRotate
        autoRotateSpeed={0.35}
        enableDamping
        dampingFactor={0.08}
        enablePan
        panSpeed={0.8}
        zoomSpeed={1.15}
        minDistance={Math.max(3, restZ * 0.06)}
        maxDistance={restZ * 3.2}
      />

      <EffectComposer>
        <Bloom luminanceThreshold={0.9} intensity={0.7} mipmapBlur luminanceSmoothing={0.2} radius={0.7} />
      </EffectComposer>
    </Canvas>
  );
}
