import { Suspense, useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Billboard, Line } from '@react-three/drei';
import * as THREE from 'three';

/**
 * The hero drawing: a real 3D knowledge graph rendered as a TECHNICAL
 * DRAWING — ink hairlines and precise nodes on paper, not glowing bloom orbs
 * on a nebula. No postprocessing, no emissive haze; the only colour in the
 * whole plate is the red/amber/green of the evidence itself.
 *
 * One node is driven red → amber → green by the parent, so the product's core
 * rule plays out inside the drawing.
 */

export type SpotStatus = 'red' | 'amber' | 'green';

const INK = '#16150F';
const COLOR: Record<SpotStatus, string> = { red: '#D21F43', amber: '#B87206', green: '#0B8F63' };

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

function seedOf(id: string) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 997;
  return (h / 997) * Math.PI * 2;
}

/** A node: a filled disc with a thin ink ring — a plotted point, not a light source. */
function Point({ node, spotlight }: { node: HNode; spotlight: SpotStatus }) {
  const g = useRef<THREE.Group>(null);
  const inner = useRef<THREE.MeshBasicMaterial>(null);
  const isSpot = node.status === 'spot';
  const target = useMemo(
    () => new THREE.Color(isSpot ? COLOR[spotlight] : COLOR[node.status as SpotStatus]),
    [isSpot, spotlight, node.status],
  );
  const seed = useMemo(() => seedOf(node.id), [node.id]);

  useFrame((state, delta) => {
    const t = state.clock.elapsedTime;
    if (g.current) {
      g.current.position.set(
        node.p[0] + Math.sin(t * 0.24 + seed) * 0.09,
        node.p[1] + Math.cos(t * 0.2 + seed) * 0.1,
        node.p[2],
      );
    }
    if (inner.current) inner.current.color.lerp(target, Math.min(1, delta / 0.5));
  });

  const c = isSpot ? COLOR[spotlight] : COLOR[node.status as SpotStatus];

  return (
    <group ref={g} position={node.p}>
      <Billboard>
        {/* ink ring */}
        <mesh>
          <ringGeometry args={[node.r * 1.75, node.r * 1.95, 48]} />
          <meshBasicMaterial color={INK} transparent opacity={isSpot ? 0.55 : 0.28} />
        </mesh>
        {/* filled point */}
        <mesh>
          <circleGeometry args={[node.r, 40]} />
          <meshBasicMaterial ref={inner} color={c} />
        </mesh>
      </Billboard>
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
        return (
          <Line
            key={`${a}-${b}`}
            points={[na.p, nb.p]}
            color={kind === 'corr' ? COLOR.amber : INK}
            lineWidth={kind === 'pre' ? 1 : 0.9}
            transparent
            opacity={kind === 'corr' ? 0.75 : touches ? 0.55 : kind === 'rel' ? 0.22 : 0.34}
            dashed={kind !== 'pre'}
            dashSize={kind === 'corr' ? 0.22 : 0.3}
            gapSize={kind === 'corr' ? 0.14 : 0.22}
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
        <Plate spotlight={spotlight} />
      </Canvas>
    </Suspense>
  );
}

export default Hero3D;
