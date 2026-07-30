import { useMemo, useRef, useState, useEffect, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import * as THREE from 'three';
import { STATUS_COLORS } from '@zynth/shared';

/**
 * Small inline 3D moments for the marketing page.
 *
 * Deliberately NO EffectComposer/Bloom here, unlike Constellation. A bloom pass
 * is by far the most expensive thing in that scene, and running three or four
 * of them on one page was never going to hold frame rate. Instead each orb
 * stacks two additive halo billboards at different scales, which reproduces
 * most of the app's glow for a small fraction of the cost — the halo was
 * always doing more of that work than the bloom was.
 *
 * Both scenes stop rendering entirely when scrolled off screen.
 */

type Status = 'red' | 'amber' | 'green';

/* One shared radial texture across every orb on the page. */
let haloTex: THREE.Texture | null = null;
function getHalo(): THREE.Texture {
  if (haloTex) return haloTex;
  const size = 128;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.35, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}

/** Gates rendering on visibility — every scene on this page must do this. */
function useLive() {
  const ref = useRef<HTMLDivElement>(null);
  const [live, setLive] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setLive(entries.some((e) => e.isIntersecting)),
      { rootMargin: '140px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, live };
}

function useReduced() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

/* ===========================================================================
   Orb — one glowing node. The app's NodeMesh, minus the bloom dependency.
   ======================================================================== */
function Orb({
  color,
  radius = 0.6,
  hovered = false,
  flashKey,
  emissive = 2.3,
}: {
  color: string;
  radius?: number;
  hovered?: boolean;
  /** Changing this triggers the one-shot emissive spike. */
  flashKey?: string;
  /**
   * At the app's ~10px node size, 2.3 plus a bloom pass reads as a glowing orb.
   * Rendered large and bloomless it just saturates the whole surface flat, so
   * the sphere loses all form and reads as a coloured disc. Big inline orbs
   * therefore run far lower and let the lights actually shade them.
   */
  emissive?: number;
}) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const mesh = useRef<THREE.Mesh>(null);
  const inner = useRef<THREE.Mesh>(null);
  const outer = useRef<THREE.Mesh>(null);
  const innerMat = useRef<THREE.MeshBasicMaterial>(null);
  const outerMat = useRef<THREE.MeshBasicMaterial>(null);

  const tex = useMemo(getHalo, []);
  const target = useMemo(() => new THREE.Color(color), [color]);
  const prevFlash = useRef(flashKey);
  const flash = useRef(0);

  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    if (prevFlash.current !== flashKey) {
      prevFlash.current = flashKey;
      flash.current = 0.2; // a flash, not confetti
    }
    const flashing = flash.current > 0;
    if (flashing) flash.current = Math.max(0, flash.current - dt);

    const t = state.clock.elapsedTime;
    const pulse = 1 + Math.sin(t * 1.4) * 0.045;
    const k = Math.min(1, dt / 0.6);

    if (mat.current) {
      mat.current.emissive.lerp(target, k);
      mat.current.color.lerp(target, k);
      const rest = emissive * (hovered ? 1.35 : 1);
      mat.current.emissiveIntensity = THREE.MathUtils.lerp(
        mat.current.emissiveIntensity, flashing ? rest * 1.4 : rest, Math.min(1, dt * (flashing ? 12 : 3)),
      );
    }
    if (mesh.current) {
      mesh.current.scale.setScalar(
        THREE.MathUtils.lerp(mesh.current.scale.x, radius * pulse * (hovered ? 1.08 : 1), Math.min(1, dt * 6)),
      );
    }
    // Two halos: a tight bright core and a wide soft atmosphere. Together they
    // read as bloom without a post pass.
    if (inner.current && innerMat.current) {
      innerMat.current.color.lerp(target, k);
      inner.current.scale.setScalar(radius * 2.6 * pulse);
      innerMat.current.opacity = flashing ? 0.46 : 0.3 + Math.sin(t * 1.4) * 0.04;
    }
    if (outer.current && outerMat.current) {
      outerMat.current.color.lerp(target, k);
      outer.current.scale.setScalar(radius * 5.2 * pulse);
      outerMat.current.opacity = flashing ? 0.2 : 0.12;
    }
  });

  return (
    <group>
      <Billboard>
        <mesh ref={outer}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={outerMat} map={tex} color={color} transparent opacity={0.12}
            depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false}
          />
        </mesh>
        <mesh ref={inner}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={innerMat} map={tex} color={color} transparent opacity={0.3}
            depthWrite={false} blending={THREE.AdditiveBlending} toneMapped={false}
          />
        </mesh>
      </Billboard>
      <mesh ref={mesh}>
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial
          ref={mat} color={color} emissive={color} emissiveIntensity={emissive}
          roughness={0.34} metalness={0.2} toneMapped={false}
        />
      </mesh>
    </group>
  );
}

/** A thin ring that only appears once the concept is proven. */
function ProofRing({ shown }: { shown: boolean }) {
  const ref = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshBasicMaterial>(null);
  useFrame((state, delta) => {
    const dt = Math.min(delta, 0.05);
    if (ref.current) {
      ref.current.rotation.z = state.clock.elapsedTime * 0.25;
      const s = THREE.MathUtils.lerp(ref.current.scale.x, shown ? 1 : 0.72, dt * 5);
      ref.current.scale.setScalar(s);
    }
    if (mat.current) {
      mat.current.opacity = THREE.MathUtils.lerp(mat.current.opacity, shown ? 0.5 : 0, dt * 5);
    }
  });
  return (
    <Billboard>
      <mesh ref={ref}>
        <ringGeometry args={[1.05, 1.1, 64]} />
        <meshBasicMaterial
          ref={mat} color={STATUS_COLORS.green} transparent opacity={0}
          side={THREE.DoubleSide} toneMapped={false} depthWrite={false}
        />
      </mesh>
    </Billboard>
  );
}

function OrbScene({
  status,
  hovered,
  onClick,
  onOver,
  onOut,
}: {
  status: Status;
  hovered: boolean;
  onClick: () => void;
  onOver: () => void;
  onOut: () => void;
}) {
  return (
    <>
      {/* Low ambient plus a strong key gives the large orb actual form —
          without it the emissive term flattens the sphere into a disc. */}
      <ambientLight intensity={0.25} />
      <directionalLight position={[2.5, 3, 4]} intensity={2.6} color="#ffffff" />
      <pointLight position={[3, 2, 4]} intensity={10} color="#9b7bff" distance={18} />
      <pointLight position={[-4, -2, 3]} intensity={9} color="#52e5e8" distance={18} />
      <group
        onClick={(e) => { e.stopPropagation(); onClick(); }}
        onPointerOver={(e) => { e.stopPropagation(); onOver(); }}
        onPointerOut={onOut}
      >
        <Orb color={STATUS_COLORS[status]} radius={0.5} hovered={hovered} flashKey={status} emissive={0.85} />
        <ProofRing shown={status === 'green'} />
        {/* generous invisible hit area */}
        <mesh>
          <sphereGeometry args={[1.3, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
    </>
  );
}

const NEXT_LABEL: Record<Status, string> = {
  red: 'Build the intuition',
  amber: 'Pass a quiz on it',
  green: 'Fail a retest',
};
const STATE_LABEL: Record<Status, string> = {
  red: 'Untouched',
  amber: 'Engaged — unproven',
  green: 'Proven',
};

/**
 * A single concept the reader can actually move through the state machine.
 * Sits beside the written rule so the claim can be tested rather than taken on
 * trust — and it enforces the real transitions, including green decaying back
 * to amber on a failed retest.
 */
export function ProofOrb() {
  const { ref, live } = useLive();
  const reduced = useReduced();
  const [status, setStatus] = useState<Status>('red');
  const [hovered, setHovered] = useState(false);
  const [touched, setTouched] = useState(false);

  const step = useCallback(() => {
    setTouched(true);
    setStatus((s) => (s === 'red' ? 'amber' : s === 'amber' ? 'green' : 'amber'));
  }, []);

  useEffect(() => {
    document.body.style.cursor = hovered ? 'pointer' : 'auto';
    return () => { document.body.style.cursor = 'auto'; };
  }, [hovered]);

  return (
    <div className="orb-figure" ref={ref}>
      <div className="orb-canvas">
        <Canvas
          frameloop={live && !reduced ? 'always' : 'never'}
          dpr={[1, 1.5]}
          camera={{ position: [0, 0, 4.2], fov: 40 }}
          gl={{ antialias: true, alpha: true }}
          style={{ background: 'transparent' }}
        >
          <OrbScene
            status={status}
            hovered={hovered}
            onClick={step}
            onOver={() => setHovered(true)}
            onOut={() => setHovered(false)}
          />
        </Canvas>
      </div>

      <div className="orb-readout">
        <span className="mono">Chain Rule</span>
        <div className="orb-state">
          <span className={`dot dot-${status}`} />
          <b>{STATE_LABEL[status]}</b>
        </div>
        <button className="orb-step focus-ring" onClick={step}>
          {NEXT_LABEL[status]}
          <span aria-hidden="true">→</span>
        </button>
        <p className="mono orb-hint">
          {touched ? 'Click the node, or the button' : 'Try it — click the node'}
        </p>
      </div>
    </div>
  );
}

/* ===========================================================================
   PersonaRing — five minds orbiting one stuck concept.
   ======================================================================== */

const PERSONAS = [
  { key: 'analogist', label: 'The Analogist', tint: '#52e5e8' },
  { key: 'purist',    label: 'The Purist',    tint: '#9b7bff' },
  { key: 'real',      label: 'Real World',    tint: '#52e5e8' },
  { key: 'skeptic',   label: 'The Skeptic',   tint: '#9b7bff' },
  { key: 'synthesis', label: 'Synthesis',     tint: '#8fa2ff' },
];

function Ring({ active, onHover }: { active: number | null; onHover: (i: number | null) => void }) {
  const group = useRef<THREE.Group>(null);
  const R = 1.85;

  const positions = useMemo(
    () => PERSONAS.map((_, i) => {
      const a = (i / PERSONAS.length) * Math.PI * 2 - Math.PI / 2;
      return new THREE.Vector3(Math.cos(a) * R, Math.sin(a) * R * 0.62, Math.sin(a * 2) * 0.35);
    }),
    [],
  );

  const spokes = useMemo(() => {
    const pts: number[] = [];
    for (const p of positions) pts.push(0, 0, 0, p.x, p.y, p.z);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, [positions]);

  useEffect(() => () => spokes.dispose(), [spokes]);

  useFrame((state, delta) => {
    if (!group.current) return;
    const dt = Math.min(delta, 0.05);
    group.current.rotation.y = THREE.MathUtils.lerp(
      group.current.rotation.y, Math.sin(state.clock.elapsedTime * 0.12) * 0.34, dt * 2,
    );
  });

  return (
    <group ref={group}>
      <lineSegments geometry={spokes}>
        <lineBasicMaterial color="#8fa2ff" transparent opacity={0.16} depthWrite={false} toneMapped={false} />
      </lineSegments>

      {/* the stuck concept — larger, so it runs lower emissive to keep form */}
      <group>
        <Orb color={STATUS_COLORS.amber} radius={0.36} emissive={1.1} />
      </group>

      {PERSONAS.map((p, i) => {
        const pos = positions[i];
        if (!pos) return null;
        return (
          <group
            key={p.key}
            position={[pos.x, pos.y, pos.z]}
            onPointerOver={(e) => { e.stopPropagation(); onHover(i); }}
            onPointerOut={() => onHover(null)}
          >
            <Orb color={p.tint} radius={0.2} hovered={active === i} />
            <mesh>
              <sphereGeometry args={[0.5, 10, 10]} />
              <meshBasicMaterial transparent opacity={0} depthWrite={false} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}

/** Five personas circling the concept they are arguing about. */
