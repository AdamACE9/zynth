import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Billboard, Line, Stars } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';

/**
 * The landing-page hero: a real WebGL knowledge graph — the same visual
 * language as the product itself, not a flat mock.
 *
 * One node (the "spotlight") is driven through red → amber → green by the
 * parent, so the core mechanic plays out live in the first seconds on the page.
 * Wrapped in Suspense with a graceful CSS fallback so a machine without WebGL
 * degrades instead of white-screening.
 */

export type SpotStatus = 'red' | 'amber' | 'green';

const COLOR: Record<SpotStatus, string> = {
  red: '#ff3b5c',
  amber: '#ffb020',
  green: '#28e0a0',
};

interface HNode {
  id: string;
  p: [number, number, number];
  r: number;
  status: SpotStatus | 'spot';
}

/** Two loose constellations, hand-placed so the composition reads well on camera. */
const NODES: HNode[] = [
  // Calculus (left)
  { id: 'limits', p: [-6.6, 2.6, 0.4], r: 0.36, status: 'green' },
  { id: 'integrals', p: [-4.2, 3.9, -1.2], r: 0.32, status: 'green' },
  { id: 'deriv', p: [-5.0, 0.9, 0.9], r: 0.5, status: 'green' },
  { id: 'chain', p: [-6.9, -1.1, 0.2], r: 0.54, status: 'spot' },
  { id: 'implicit', p: [-3.9, -1.9, -0.6], r: 0.36, status: 'red' },
  { id: 'related', p: [-6.2, -3.5, 1.0], r: 0.32, status: 'red' },
  { id: 'optimize', p: [-2.9, 0.6, 1.4], r: 0.4, status: 'amber' },
  // Physics (right)
  { id: 'kinem', p: [4.0, 2.7, 0.6], r: 0.44, status: 'green' },
  { id: 'newton', p: [6.2, 1.2, -0.7], r: 0.5, status: 'amber' },
  { id: 'forces', p: [3.6, -0.5, 1.1], r: 0.36, status: 'red' },
  { id: 'energy', p: [5.6, -2.4, 0.3], r: 0.36, status: 'red' },
  { id: 'momentum', p: [7.4, 3.0, 0.8], r: 0.3, status: 'amber' },
  { id: 'circular', p: [7.0, -0.9, 1.2], r: 0.3, status: 'red' },
];

const LINKS: [string, string, 'pre' | 'rel' | 'corr'][] = [
  ['limits', 'deriv', 'pre'],
  ['deriv', 'integrals', 'pre'],
  ['deriv', 'chain', 'pre'],
  ['chain', 'implicit', 'pre'],
  ['implicit', 'related', 'pre'],
  ['deriv', 'optimize', 'pre'],
  ['kinem', 'newton', 'pre'],
  ['newton', 'forces', 'pre'],
  ['forces', 'energy', 'pre'],
  ['newton', 'momentum', 'pre'],
  ['newton', 'circular', 'pre'],
  ['deriv', 'kinem', 'rel'],
  ['chain', 'related', 'corr'],
];

let haloTex: THREE.Texture | null = null;
function getHalo(): THREE.Texture {
  if (haloTex) return haloTex;
  const s = 128;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.45)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}

function seedOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return (h / 997) * Math.PI * 2;
}

function Orb({ node, spotlight }: { node: HNode; spotlight: SpotStatus }) {
  const group = useRef<THREE.Group>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null);
  const isSpot = node.status === 'spot';
  const target = useMemo(
    () => new THREE.Color(isSpot ? COLOR[spotlight] : COLOR[node.status as SpotStatus]),
    [isSpot, spotlight, node.status],
  );
  const seed = useMemo(() => seedOf(node.id), [node.id]);
  const tex = useMemo(() => getHalo(), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (group.current) {
      // gentle organic drift so the constellation feels alive
      group.current.position.set(
        node.p[0] + Math.sin(t * 0.32 + seed) * 0.18,
        node.p[1] + Math.cos(t * 0.27 + seed) * 0.2,
        node.p[2] + Math.sin(t * 0.22 + seed) * 0.14,
      );
    }
    const k = Math.min(1, delta / 0.5);
    if (mat.current) {
      mat.current.color.lerp(target, k);
      mat.current.emissive.lerp(target, k);
      const pulse = 1 + Math.sin(t * 1.5 + seed) * 0.06;
      mat.current.emissiveIntensity = THREE.MathUtils.lerp(
        mat.current.emissiveIntensity,
        (isSpot ? 3.4 : 2.4) * pulse,
        Math.min(1, delta * 4),
      );
    }
    if (haloMat.current) {
      haloMat.current.color.lerp(target, k);
      haloMat.current.opacity = (isSpot ? 0.4 : 0.26) + Math.sin(t * 1.5 + seed) * 0.05;
    }
  });

  const c = isSpot ? COLOR[spotlight] : COLOR[node.status as SpotStatus];

  return (
    <group ref={group} position={node.p}>
      <Billboard>
        <mesh scale={node.r * (isSpot ? 3.4 : 2.9)}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={haloMat}
            map={tex}
            color={c}
            transparent
            opacity={0.3}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </Billboard>
      <mesh scale={node.r}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial
          ref={mat}
          color={c}
          emissive={c}
          emissiveIntensity={2.4}
          roughness={0.4}
          metalness={0.15}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function Scene({ spotlight }: { spotlight: SpotStatus }) {
  const world = useRef<THREE.Group>(null);
  const byId = useMemo(() => new Map(NODES.map((n) => [n.id, n])), []);

  useFrame((state) => {
    if (!world.current) return;
    const t = state.clock.elapsedTime;
    // slow, cinematic sway rather than a full spin — keeps text legible beside it
    world.current.rotation.y = Math.sin(t * 0.13) * 0.28;
    world.current.rotation.x = Math.sin(t * 0.09) * 0.09;
  });

  return (
    <group ref={world}>
      <ambientLight intensity={0.35} color="#8fa8ff" />
      <pointLight position={[10, 8, 10]} intensity={26} color="#67e8f9" distance={90} decay={2} />
      <pointLight position={[-10, -6, -8]} intensity={20} color="#a78bfa" distance={90} decay={2} />
      <Stars radius={90} depth={60} count={900} factor={2} saturation={0} fade speed={0.2} />

      {LINKS.map(([a, b, kind]) => {
        const na = byId.get(a);
        const nb = byId.get(b);
        if (!na || !nb) return null;
        const touches = na.status === 'spot' || nb.status === 'spot';
        const color = kind === 'corr' ? '#f5a524' : kind === 'rel' ? '#9b7bff' : touches ? COLOR[spotlight] : '#7becff';
        return (
          <Line
            key={`${a}-${b}`}
            points={[na.p, nb.p]}
            color={color}
            lineWidth={kind === 'pre' ? 1.4 : 1.1}
            transparent
            opacity={touches ? 0.75 : kind === 'rel' ? 0.32 : 0.5}
            dashed={kind === 'corr'}
            dashSize={0.35}
            gapSize={0.22}
            toneMapped={false}
          />
        );
      })}

      {NODES.map((n) => (
        <Orb key={n.id} node={n} spotlight={spotlight} />
      ))}

      <EffectComposer>
        <Bloom luminanceThreshold={0.85} intensity={0.85} mipmapBlur luminanceSmoothing={0.2} radius={0.75} />
      </EffectComposer>
    </group>
  );
}

/** Static CSS stand-in shown while the canvas boots or if WebGL is unavailable. */
function Fallback() {
  return (
    <div className="h-full w-full" aria-hidden>
      <div
        className="h-full w-full"
        style={{
          background:
            'radial-gradient(circle at 30% 45%, rgba(82,229,232,0.16), transparent 55%), radial-gradient(circle at 72% 40%, rgba(155,123,255,0.14), transparent 55%)',
        }}
      />
    </div>
  );
}

export function Hero3D({ spotlight }: { spotlight: SpotStatus }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Fallback />;

  return (
    <Suspense fallback={<Fallback />}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 0.5, 17], fov: 42 }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', () => setFailed(true), { once: true });
        }}
        style={{ pointerEvents: 'none' }}
      >
        <Scene spotlight={spotlight} />
      </Canvas>
    </Suspense>
  );
}

export default Hero3D;
