import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Billboard, Line } from '@react-three/drei';
import { Bloom, EffectComposer } from '@react-three/postprocessing';
import * as THREE from 'three';

/**
 * The hero drawing: a real 3D knowledge graph rendered with the SAME
 * technique as the app's own KnowledgeGraph — glowing emissive spheres, a
 * canvas-generated radial halo behind each one (additive blend), cyan/violet
 * structural edges, and a bloom pass. This used to be a light "technical
 * drawing" (ink lines on paper); it is now visually the same object the
 * product shows after "Go to Zynth", just smaller and non-interactive.
 *
 * One node is driven red -> amber -> green by the parent, so the product's
 * core rule plays out inside the drawing itself.
 */

export type SpotStatus = 'red' | 'amber' | 'green';

const COLOR: Record<SpotStatus, string> = { red: '#ff3b5c', amber: '#ffb020', green: '#28e0a0' };

interface HNode {
  id: string;
  p: [number, number, number];
  r: number;
  status: SpotStatus | 'spot';
}

const NODES: HNode[] = [
  { id: 'limits', p: [-4.2, 2.5, 0.3], r: 0.15, status: 'green' },
  { id: 'integrals', p: [-2.4, 3.6, -0.9], r: 0.13, status: 'green' },
  { id: 'deriv', p: [-3.0, 0.9, 0.7], r: 0.2, status: 'green' },
  { id: 'chain', p: [-4.6, -1.0, 0.1], r: 0.23, status: 'spot' },
  { id: 'implicit', p: [-1.9, -1.7, -0.5], r: 0.15, status: 'red' },
  { id: 'related', p: [-4.0, -3.2, 0.8], r: 0.13, status: 'red' },
  { id: 'optimize', p: [-1.1, 0.6, 1.1], r: 0.16, status: 'amber' },
  { id: 'kinem', p: [2.3, 2.6, 0.5], r: 0.18, status: 'green' },
  { id: 'newton', p: [4.2, 1.1, -0.6], r: 0.2, status: 'amber' },
  { id: 'forces', p: [1.9, -0.6, 0.9], r: 0.15, status: 'red' },
  { id: 'energy', p: [3.6, -2.5, 0.2], r: 0.15, status: 'red' },
  { id: 'momentum', p: [5.2, 3.0, 0.7], r: 0.12, status: 'amber' },
  { id: 'circular', p: [4.8, -1.0, 1.0], r: 0.12, status: 'red' },
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

/** Same edge palette as the real graph (client/src/graph/Edges.tsx): cyan for
 * structural prerequisites, dim violet for loose relations, amber-dashed for
 * a correlated error — never red/amber/green, so edges never compete with
 * node status. */
const LINK_STYLE: Record<'pre' | 'rel' | 'corr', { color: string; opacity: number; width: number; dashed?: boolean }> = {
  pre: { color: '#7becff', opacity: 0.6, width: 1.6 },
  rel: { color: '#9b7bff', opacity: 0.24, width: 1 },
  corr: { color: '#f5a524', opacity: 0.65, width: 1.3, dashed: true },
};

function seedOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return (h / 997) * Math.PI * 2;
}

/** Runtime-generated radial white->transparent gradient, additive-blended
 * behind every node — identical recipe to NodeMesh.tsx's shared halo
 * texture, so the hero's nodes read as the same glowing orbs as the app's. */
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

/** A single glowing node: additive halo billboard + emissive sphere, both
 * lerping colour toward the current status/spotlight over ~0.6s. */
function Point({ node, spotlight }: { node: HNode; spotlight: SpotStatus }) {
  const g = useRef<THREE.Group>(null);
  const core = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.MeshBasicMaterial>(null);
  const isSpot = node.status === 'spot';
  const target = useMemo(
    () => new THREE.Color(isSpot ? COLOR[spotlight] : COLOR[node.status as SpotStatus]),
    [isSpot, spotlight, node.status],
  );
  const seed = useMemo(() => seedOf(node.id), [node.id]);
  const haloTexture = useMemo(() => getHaloTexture(), []);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (g.current) {
      g.current.position.set(
        node.p[0] + Math.sin(t * 0.24 + seed) * 0.09,
        node.p[1] + Math.cos(t * 0.2 + seed) * 0.1,
        node.p[2],
      );
    }
    const lerpAmt = Math.min(1, delta / 0.6);
    if (core.current) {
      core.current.color.lerp(target, lerpAmt);
      core.current.emissive.lerp(target, lerpAmt);
      const pulse = isSpot ? 1 + Math.sin(t * 1.6 + seed) * 0.35 : 1;
      core.current.emissiveIntensity = (isSpot ? 2.6 : 1.9) * pulse;
    }
    if (halo.current) {
      halo.current.color.lerp(target, lerpAmt);
      const opacityPulse = 0.3 + Math.sin(t * 1.4 + seed) * 0.06;
      halo.current.opacity = isSpot ? Math.min(0.55, opacityPulse * 1.4) : opacityPulse;
    }
  });

  return (
    <group ref={g} position={node.p}>
      <Billboard>
        <mesh scale={node.r * 5.4}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={halo}
            map={haloTexture}
            color={isSpot ? COLOR[spotlight] : COLOR[node.status as SpotStatus]}
            transparent
            opacity={0.3}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </Billboard>
      <mesh>
        <sphereGeometry args={[node.r, 24, 24]} />
        <meshStandardMaterial
          ref={core}
          color={isSpot ? COLOR[spotlight] : COLOR[node.status as SpotStatus]}
          emissive={isSpot ? COLOR[spotlight] : COLOR[node.status as SpotStatus]}
          emissiveIntensity={isSpot ? 2.6 : 1.9}
          roughness={0.35}
          metalness={0.1}
          toneMapped={false}
        />
      </mesh>
    </group>
  );
}

function Plate({ spotlight }: { spotlight: SpotStatus }) {
  const world = useRef<THREE.Group>(null);
  const byId = useMemo(() => new Map(NODES.map((n) => [n.id, n])), []);

  useFrame((state) => {
    if (!world.current) return;
    const t = state.clock.elapsedTime;
    // A slow survey of the model — a turntable, not a spin.
    world.current.rotation.y = Math.sin(t * 0.1) * 0.42;
    world.current.rotation.x = Math.sin(t * 0.07) * 0.12;
  });

  return (
    <group ref={world}>
      {LINKS.map(([a, b, kind]) => {
        const na = byId.get(a);
        const nb = byId.get(b);
        if (!na || !nb) return null;
        const touches = na.status === 'spot' || nb.status === 'spot';
        const style = LINK_STYLE[kind];
        return (
          <Line
            key={`${a}-${b}`}
            points={[na.p, nb.p]}
            color={style.color}
            lineWidth={style.width}
            transparent
            opacity={touches ? Math.min(1, style.opacity * 1.3) : style.opacity}
            dashed={style.dashed ?? false}
            dashSize={style.dashed ? 0.22 : undefined}
            gapSize={style.dashed ? 0.14 : undefined}
            toneMapped={false}
          />
        );
      })}
      {NODES.map((n) => (
        <Point key={n.id} node={n} spotlight={spotlight} />
      ))}
    </group>
  );
}

function Fallback() {
  return <div className="h-full w-full" aria-hidden />;
}

export function Hero3D({ spotlight }: { spotlight: SpotStatus }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Fallback />;

  return (
    <Suspense fallback={<Fallback />}>
      <Canvas
        dpr={[1, 2]}
        gl={{ antialias: true, alpha: true }}
        camera={{ position: [0, 0, 13.5], fov: 44 }}
        onCreated={({ gl }) => {
          gl.domElement.addEventListener('webglcontextlost', () => setFailed(true), { once: true });
        }}
        style={{ pointerEvents: 'none' }}
      >
        <ambientLight intensity={0.4} color="#8fa8ff" />
        <pointLight position={[8, 6, 6]} intensity={12} color="#67e8f9" distance={40} decay={2} />
        <pointLight position={[-8, -4, -6]} intensity={10} color="#a78bfa" distance={40} decay={2} />
        <Plate spotlight={spotlight} />
        <EffectComposer>
          <Bloom luminanceThreshold={0.7} intensity={0.65} mipmapBlur luminanceSmoothing={0.2} radius={0.7} />
        </EffectComposer>
      </Canvas>
    </Suspense>
  );
}

export default Hero3D;
