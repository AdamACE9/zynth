import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Billboard, Line } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';

/**
 * The site's SECOND 3D moment (Hero3D is the first) — a tiny, self-driving
 * three-node constellation for the "01 — standard of proof" section. Same
 * technique as Hero3D/the app's real graph.NodeMesh: emissive sphere +
 * additive canvas-halo billboard + a bloom pass — just three nodes instead
 * of thirteen, and no props: each node free-runs its own red -> amber ->
 * green -> (hold) -> red loop on a phase offset so the little cluster
 * always has at least one node mid-transition, which is what makes it read
 * as "alive" rather than a static illustration.
 *
 * Kept deliberately cheap: 3 nodes, dpr capped at 1.5, one bloom pass. If a
 * second live canvas ever proves too heavy alongside Hero3D, cut this
 * first — it's decoration, Hero3D is the centerpiece.
 */

type Phase = 'red' | 'amber' | 'green';
const COLOR: Record<Phase, string> = { red: '#ff3b5c', amber: '#ffb020', green: '#28e0a0' };
const CYCLE: Phase[] = ['red', 'amber', 'green'];
const HOLD = 2.6; // seconds per phase

let sharedHalo: THREE.Texture | null = null;
function getHaloTexture(): THREE.Texture {
  if (sharedHalo) return sharedHalo;
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  sharedHalo = texture;
  return texture;
}

function phaseAt(t: number, offset: number): { phase: Phase; frac: number } {
  const total = HOLD * CYCLE.length;
  const local = ((t + offset) % total + total) % total;
  const idx = Math.floor(local / HOLD);
  const frac = (local % HOLD) / HOLD;
  return { phase: CYCLE[idx]!, frac };
}

function Node({ position, offset, r }: { position: [number, number, number]; offset: number; r: number }) {
  const core = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  const haloTexture = useMemo(() => getHaloTexture(), []);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const { phase } = phaseAt(t, offset);
    const target = new THREE.Color(COLOR[phase]);
    if (core.current) {
      core.current.color.lerp(target, 0.06);
      core.current.emissive.lerp(target, 0.06);
      core.current.emissiveIntensity = 2.2 + Math.sin(t * 1.4 + offset) * 0.3;
    }
    if (halo.current) {
      halo.current.color.lerp(target, 0.06);
      halo.current.opacity = 0.34 + Math.sin(t * 1.2 + offset) * 0.08;
    }
  });

  return (
    <group position={position}>
      <Billboard>
        <mesh scale={r * 6.2}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial ref={halo} map={haloTexture} transparent opacity={0.32} depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false} />
        </mesh>
      </Billboard>
      <mesh>
        <sphereGeometry args={[r, 20, 20]} />
        <meshStandardMaterial ref={core} roughness={0.35} metalness={0.1} toneMapped={false} />
      </mesh>
    </group>
  );
}

const NODES: Array<{ position: [number, number, number]; offset: number; r: number }> = [
  { position: [-1.15, 0.55, 0], offset: 0, r: 0.34 },
  { position: [0.95, 0.75, -0.4], offset: HOLD, r: 0.3 },
  { position: [0.1, -0.85, 0.3], offset: HOLD * 2, r: 0.38 },
];

const EDGES: [number, number][] = [
  [0, 1],
  [1, 2],
  [2, 0],
];

function Cluster() {
  const world = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!world.current) return;
    const t = state.clock.elapsedTime;
    world.current.rotation.y = Math.sin(t * 0.15) * 0.5;
    world.current.rotation.x = Math.sin(t * 0.11) * 0.18;
  });
  return (
    <group ref={world}>
      {EDGES.map(([a, b]) => (
        <Line key={`${a}-${b}`} points={[NODES[a]!.position, NODES[b]!.position]} color="#9b7bff" lineWidth={1} transparent opacity={0.3} toneMapped={false} />
      ))}
      {NODES.map((n, i) => (
        <Node key={i} {...n} />
      ))}
    </group>
  );
}

function Fallback() {
  return <div style={{ width: '100%', height: '100%' }} aria-hidden />;
}

export function MiniNode3D() {
  const [failed, setFailed] = useState(false);
  if (failed) return <Fallback />;

  return (
    <Suspense fallback={<Fallback />}>
      <Canvas
        dpr={[1, 1.5]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 0, 4.6], fov: 42 }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', () => setFailed(true), { once: true });
        }}
        style={{ pointerEvents: 'none' }}
      >
        <ambientLight intensity={0.45} color="#8fa8ff" />
        <pointLight position={[3, 2, 3]} intensity={9} color="#67e8f9" distance={20} decay={2} />
        <Cluster />
        <EffectComposer>
          <Bloom luminanceThreshold={0.7} intensity={0.5} mipmapBlur luminanceSmoothing={0.2} radius={0.6} />
        </EffectComposer>
      </Canvas>
    </Suspense>
  );
}

export default MiniNode3D;
