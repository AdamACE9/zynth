import { useMemo, useRef, useState, useEffect, useCallback, Suspense } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Billboard } from '@react-three/drei';
import { EffectComposer, Bloom } from '@react-three/postprocessing';
import * as THREE from 'three';
import { STATUS_COLORS } from '@zynth/shared';

/**
 * The marketing site's knowledge graph.
 *
 * Not a picture of the product — the product's own rendering language, rebuilt
 * at a size the page can carry. Every visual constant is lifted from
 * graph/NodeMesh.tsx so the site and the app read as one object: emissive
 * spheres at 2.3 intensity, an additive radial halo at 2.7x radius, a
 * desynchronised idle pulse, and a single 200ms emissive flash (never a
 * celebration) on the frame a status actually changes.
 *
 * It is also playable. Hovering names a concept; clicking advances it along the
 * real state machine — red engages to amber, amber proves to green — so a
 * visitor learns the product's central rule by doing it, in the hero, before
 * reading a word about it. Dragging orbits the whole constellation.
 *
 * Layout is hand-authored rather than force-simulated: at this node count a
 * solver buys nothing but jitter, and a fixed layout means the hero composes
 * identically on every load.
 */

type Status = 'red' | 'amber' | 'green';

interface Spec {
  id: string;
  label: string;
  p: [number, number, number];
  status: Status;
  /** 0..1 — drives node size, exactly as mastery_score does in the app. */
  mastery: number;
}

/* Two constellations mirroring the seeded demo graph: Calculus left of centre,
   Physics right, joined by one cross-subject link. */
const NODES: Spec[] = [
  { id: 'limits',     label: 'Limits',              p: [-2.10,  0.95, -0.30], status: 'green', mastery: 0.92 },
  { id: 'continuity', label: 'Continuity',          p: [-2.72,  0.05,  0.55], status: 'green', mastery: 0.88 },
  { id: 'deriv',      label: 'Derivatives',         p: [-1.35,  0.20,  0.15], status: 'green', mastery: 0.90 },
  { id: 'power',      label: 'Power Rule',          p: [-2.05, -0.85,  0.70], status: 'green', mastery: 0.95 },
  { id: 'chain',      label: 'Chain Rule',          p: [-0.62, -0.30, -0.45], status: 'amber', mastery: 0.55 },
  { id: 'product',    label: 'Product & Quotient',  p: [-1.28, -1.15, -0.20], status: 'amber', mastery: 0.48 },
  { id: 'implicit',   label: 'Implicit Diff.',      p: [-0.15, -1.05,  0.40], status: 'red',   mastery: 0.20 },
  { id: 'related',    label: 'Related Rates',       p: [ 0.35, -0.25,  0.85], status: 'red',   mastery: 0.18 },
  { id: 'integral',   label: 'Definite Integrals',  p: [-1.85,  1.75,  0.30], status: 'amber', mastery: 0.52 },
  { id: 'ftc',        label: 'Fundamental Theorem', p: [-0.90,  1.35,  0.75], status: 'red',   mastery: 0.15 },
  { id: 'optim',      label: 'Optimization',        p: [ 0.10,  0.75, -0.70], status: 'amber', mastery: 0.44 },
  { id: 'kinematics', label: 'Kinematics',          p: [ 1.75,  0.30,  0.10], status: 'green', mastery: 0.86 },
  { id: 'forces',     label: 'Forces & Free-Body',  p: [ 2.55, -0.45, -0.35], status: 'green', mastery: 0.81 },
  { id: 'work',       label: 'Work & Energy',       p: [ 2.10, -1.25,  0.45], status: 'amber', mastery: 0.50 },
  { id: 'momentum',   label: 'Momentum',            p: [ 3.05,  0.45,  0.60], status: 'amber', mastery: 0.46 },
  { id: 'circular',   label: 'Circular Motion',     p: [ 2.35,  1.30, -0.15], status: 'red',   mastery: 0.16 },
  { id: 'shm',        label: 'Simple Harmonic',     p: [ 3.25,  1.35,  0.35], status: 'red',   mastery: 0.12 },
];

const EDGES: [string, string][] = [
  ['limits', 'continuity'], ['continuity', 'deriv'], ['limits', 'deriv'],
  ['deriv', 'power'], ['deriv', 'chain'], ['chain', 'product'],
  ['chain', 'implicit'], ['implicit', 'related'], ['deriv', 'related'],
  ['integral', 'ftc'], ['ftc', 'deriv'], ['optim', 'deriv'], ['optim', 'chain'],
  ['kinematics', 'forces'], ['forces', 'work'], ['work', 'momentum'],
  ['forces', 'circular'], ['circular', 'shm'], ['momentum', 'kinematics'],
  ['deriv', 'kinematics'],
];

/** Deterministic 0..1 per id, so idle pulses never synchronise. */
function seedOf(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 1000;
  return h / 1000;
}

/* Shared radial white->transparent texture, generated once — the difference
   between a bare sphere and an orb with atmosphere. */
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

const IDLE_EMISSIVE = 2.3;
const HOVER_EMISSIVE = 3.4;
const HALO_SCALE = 2.7;
const HALO_OPACITY = 0.26;

/** One legal step along the real state machine. */
function advance(s: Status): Status {
  return s === 'red' ? 'amber' : s === 'amber' ? 'green' : 'green';
}

function Node({
  spec,
  status,
  interactive,
  onHover,
  onSelect,
}: {
  spec: Spec;
  status: Status;
  interactive: boolean;
  onHover: (id: string | null) => void;
  onSelect: (id: string) => void;
}) {
  const mesh = useRef<THREE.Mesh>(null);
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  const halo = useRef<THREE.Mesh>(null);
  const haloMat = useRef<THREE.MeshBasicMaterial>(null);
  const [hovered, setHovered] = useState(false);

  const seed = useMemo(() => seedOf(spec.id) * Math.PI * 2, [spec.id]);
  const target = useMemo(() => new THREE.Color(STATUS_COLORS[status]), [status]);
  const tex = useMemo(getHalo, []);
  const r = 0.062 + spec.mastery * 0.052;

  const prev = useRef(status);
  const flash = useRef(0);

  useFrame((state, delta) => {
    // A backgrounded tab returns one enormous delta on return, which would snap
    // every lerp to its target at once and visibly jump the whole graph.
    const dt = Math.min(delta, 0.05);

    if (prev.current !== status) {
      prev.current = status;
      flash.current = 0.2; // one spike, ~200ms. A flash, not confetti.
    }
    const flashing = flash.current > 0;
    if (flashing) flash.current = Math.max(0, flash.current - dt);

    const t = state.clock.elapsedTime;
    const pulse = 1 + Math.sin(t * 1.4 + seed) * 0.045;

    if (mat.current) {
      const k = Math.min(1, dt / 0.6);
      mat.current.emissive.lerp(target, k);
      mat.current.color.lerp(target, k);
      const rest = hovered ? HOVER_EMISSIVE : IDLE_EMISSIVE;
      const want = flashing ? rest * 1.4 : rest;
      mat.current.emissiveIntensity = THREE.MathUtils.lerp(
        mat.current.emissiveIntensity, want, Math.min(1, dt * (flashing ? 12 : 3)),
      );
    }
    if (mesh.current) {
      const want = r * pulse * (hovered ? 1.35 : 1);
      mesh.current.scale.setScalar(THREE.MathUtils.lerp(mesh.current.scale.x, want, Math.min(1, dt * 6)));
    }
    if (halo.current && haloMat.current) {
      haloMat.current.color.lerp(target, Math.min(1, dt / 0.6));
      halo.current.scale.setScalar(r * HALO_SCALE * pulse * (hovered ? 1.18 : 1));
      const o = HALO_OPACITY + Math.sin(t * 1.4 + seed) * 0.05;
      haloMat.current.opacity = flashing ? Math.min(0.5, o * 1.5) : o;
    }
  });

  const enter = useCallback((e: { stopPropagation: () => void }) => {
    if (!interactive) return;
    e.stopPropagation();
    setHovered(true);
    onHover(spec.id);
    document.body.style.cursor = 'pointer';
  }, [interactive, onHover, spec.id]);

  const leave = useCallback(() => {
    if (!interactive) return;
    setHovered(false);
    onHover(null);
    document.body.style.cursor = 'auto';
  }, [interactive, onHover]);

  return (
    <group position={[spec.p[0], spec.p[1], spec.p[2]]}>
      <Billboard>
        <mesh ref={halo}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={haloMat}
            map={tex}
            color={STATUS_COLORS[status]}
            transparent
            opacity={HALO_OPACITY}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </Billboard>

      <mesh
        ref={mesh}
        onPointerOver={enter}
        onPointerOut={leave}
        onClick={(e) => {
          if (!interactive) return;
          e.stopPropagation();
          onSelect(spec.id);
        }}
      >
        <sphereGeometry args={[1, 16, 16]} />
        <meshStandardMaterial
          ref={mat}
          color={STATUS_COLORS[status]}
          emissive={STATUS_COLORS[status]}
          emissiveIntensity={IDLE_EMISSIVE}
          roughness={0.4}
          metalness={0.15}
          toneMapped={false}
        />
      </mesh>

      {/* A generous invisible hit sphere. The visible nodes are only ~10px
          across on screen; picking them precisely would be a chore. */}
      {interactive && (
        <mesh onPointerOver={enter} onPointerOut={leave} onClick={(e) => { e.stopPropagation(); onSelect(spec.id); }}>
          <sphereGeometry args={[0.24, 8, 8]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      )}
    </group>
  );
}

/** Edges as one merged buffer — 20 draw calls become 1. */
function Edges({ statuses }: { statuses: Record<string, Status> }) {
  const geom = useMemo(() => {
    const byId = new Map(NODES.map((n) => [n.id, n]));
    const pts: number[] = [];
    for (const [a, b] of EDGES) {
      const na = byId.get(a);
      const nb = byId.get(b);
      if (!na || !nb) continue;
      pts.push(na.p[0], na.p[1], na.p[2], nb.p[0], nb.p[1], nb.p[2]);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    return g;
  }, []);

  useEffect(() => () => geom.dispose(), [geom]);

  // Edge brightness tracks how much of the graph is proven — prove more, and
  // the structure itself lights up.
  const matRef = useRef<THREE.LineBasicMaterial>(null);
  const proven = useMemo(
    () => Object.values(statuses).filter((s) => s === 'green').length / NODES.length,
    [statuses],
  );
  useFrame((_, delta) => {
    if (!matRef.current) return;
    matRef.current.opacity = THREE.MathUtils.lerp(
      matRef.current.opacity, 0.1 + proven * 0.18, Math.min(delta, 0.05) * 2,
    );
  });

  return (
    <lineSegments geometry={geom}>
      <lineBasicMaterial ref={matRef} color="#8fa2ff" transparent opacity={0.14} depthWrite={false} toneMapped={false} />
    </lineSegments>
  );
}

/**
 * Slow drift, pointer parallax, and drag-to-orbit with inertia.
 * The ambient rotation is about a degree per second — enough that the graph is
 * never dead, slow enough that reading a headline over it is effortless.
 */
function Rig({ children, interactive }: { children: React.ReactNode; interactive: boolean }) {
  const group = useRef<THREE.Group>(null);
  const { pointer, gl } = useThree();

  const tilt = useRef({ x: 0, y: 0 });
  const drag = useRef({ active: false, lastX: 0, lastY: 0, vx: 0, vy: 0, x: 0, y: 0 });

  useEffect(() => {
    if (!interactive) return;
    const el = gl.domElement;
    const d = drag.current;

    const down = (e: PointerEvent) => {
      d.active = true;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      d.vx = 0;
      d.vy = 0;
      el.setPointerCapture(e.pointerId);
      el.style.cursor = 'grabbing';
    };
    const move = (e: PointerEvent) => {
      if (!d.active) return;
      const dx = e.clientX - d.lastX;
      const dy = e.clientY - d.lastY;
      d.lastX = e.clientX;
      d.lastY = e.clientY;
      d.y += dx * 0.005;
      d.x += dy * 0.005;
      d.vx = dy * 0.005;
      d.vy = dx * 0.005;
    };
    const up = (e: PointerEvent) => {
      d.active = false;
      try { el.releasePointerCapture(e.pointerId); } catch { /* pointer already gone */ }
      el.style.cursor = 'grab';
    };

    el.style.cursor = 'grab';
    el.addEventListener('pointerdown', down);
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
    return () => {
      el.removeEventListener('pointerdown', down);
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
    };
  }, [interactive, gl]);

  useFrame((state, delta) => {
    if (!group.current) return;
    const dt = Math.min(delta, 0.05);
    const t = state.clock.elapsedTime;
    const d = drag.current;

    // Inertia: keep coasting after release, bleeding off over ~1s.
    if (!d.active) {
      d.x += d.vx;
      d.y += d.vy;
      d.vx *= 0.94;
      d.vy *= 0.94;
    }
    // Vertical orbit is clamped so the graph can never tumble past its poles.
    d.x = THREE.MathUtils.clamp(d.x, -0.6, 0.6);

    // Pointer parallax trails the cursor with a ~0.4s time constant, so the
    // graph feels like it has mass rather than being welded to the mouse.
    const wantX = interactive ? pointer.y * 0.07 : 0;
    const wantY = interactive ? pointer.x * 0.1 : 0;
    const k = Math.min(1, dt * 2.4);
    tilt.current.x = THREE.MathUtils.lerp(tilt.current.x, wantX, k);
    tilt.current.y = THREE.MathUtils.lerp(tilt.current.y, wantY, k);

    group.current.rotation.y = t * 0.018 + tilt.current.y + d.y;
    group.current.rotation.x = Math.sin(t * 0.11) * 0.06 + tilt.current.x + d.x;
  });

  return <group ref={group}>{children}</group>;
}

export interface ConstellationProps {
  /** Pointer parallax, drag-orbit, hover/click. Off for the quieter outro. */
  interactive?: boolean;
  className?: string;
}

export function Constellation({ interactive = true, className }: ConstellationProps) {
  const host = useRef<HTMLDivElement>(null);
  const [reduced, setReduced] = useState(false);
  /* Rendering is gated on visibility. Two canvases each running a bloom pass
     for a page that only ever shows one of them at a time was the single
     biggest cost on this page. */
  const [live, setLive] = useState(false);
  const [hover, setHover] = useState<{ id: string; label: string; status: Status } | null>(null);
  const [engaged, setEngaged] = useState(false);

  const [statuses, setStatuses] = useState<Record<string, Status>>(
    () => Object.fromEntries(NODES.map((n) => [n.id, n.status])) as Record<string, Status>,
  );

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => setLive(entries.some((e) => e.isIntersecting)),
      { rootMargin: '160px' },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  /* The ambient proof loop, so the hero is never a still image.

     It only ever touches ACTIVE — a handful of concepts standing in for "what
     this student is working on right now". Everything else holds its seeded
     colour.

     That restriction is load-bearing, not decorative. An unrestricted walk
     drifts monotonically to all-green and stays there, because the real state
     machine has no legal route back to red: amber only ever comes from red or
     from a failed retest. A hero that ends up uniformly green contradicts the
     one claim the whole page is making, so the mix is bounded by construction
     — at least two red and several green are always on screen.

     It stops for good the moment the visitor clicks a node: from then on the
     graph is theirs, and having it shift under their hands reads as a glitch. */
  useEffect(() => {
    if (!live || reduced || engaged) return;
    const ACTIVE = ['chain', 'implicit', 'related', 'optim', 'work', 'circular'];
    let i = 0;
    const id = window.setInterval(() => {
      setStatuses((cur) => {
        const key = ACTIVE[i % ACTIVE.length];
        i++;
        if (!key) return cur;
        const from = cur[key] ?? 'red';
        // green cycles back to amber — a proven node that failed its retest.
        const to: Status = from === 'green' ? 'amber' : advance(from);
        return { ...cur, [key]: to };
      });
    }, 2600);
    return () => window.clearInterval(id);
  }, [live, reduced, engaged]);

  const onHover = useCallback((id: string | null) => {
    if (!id) return setHover(null);
    const spec = NODES.find((n) => n.id === id);
    if (spec) setHover({ id, label: spec.label, status: statuses[id] ?? spec.status });
  }, [statuses]);

  const onSelect = useCallback((id: string) => {
    setEngaged(true);
    setStatuses((cur) => ({ ...cur, [id]: advance(cur[id] ?? 'red') }));
  }, []);

  useEffect(() => () => { document.body.style.cursor = 'auto'; }, []);

  const proven = Object.values(statuses).filter((s) => s === 'green').length;

  return (
    <div className={className} ref={host} data-interactive={interactive}>
      <Canvas
        /* Rendering stops entirely when the canvas is off-screen. */
        frameloop={live && !reduced ? 'always' : 'never'}
        dpr={[1, 1.5]}
        /* The cluster spans ~6.5 world units; at fov 38 the camera has to sit
           back around 13 for it to read as a structure rather than a handful
           of lights pressed against the lens. */
        camera={{ position: [0.3, 0, 15], fov: 38 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        style={{ background: 'transparent' }}
      >
        <Suspense fallback={null}>
          <ambientLight intensity={0.55} />
          <pointLight position={[4, 4, 6]} intensity={22} color="#9b7bff" distance={22} />
          <pointLight position={[-5, -2, 4]} intensity={16} color="#52e5e8" distance={22} />

          <Rig interactive={interactive && !reduced}>
            <Edges statuses={statuses} />
            {NODES.map((n) => (
              <Node
                key={n.id}
                spec={n}
                status={statuses[n.id] ?? n.status}
                interactive={interactive && !reduced}
                onHover={onHover}
                onSelect={onSelect}
              />
            ))}
          </Rig>

          <EffectComposer>
            <Bloom intensity={0.85} luminanceThreshold={0.3} luminanceSmoothing={0.9} mipmapBlur radius={0.6} />
          </EffectComposer>
        </Suspense>
      </Canvas>

      {interactive && (
        <>
          {/* Hover readout. A DOM chip rather than drei's <Html> so it can
              never be clipped by the canvas mask. */}
          <div className="cst-readout" data-on={!!hover}>
            {hover && (
              <>
                <span className={`dot dot-${hover.status}`} />
                {hover.label}
                <em>
                  {hover.status === 'green' ? 'proven' : hover.status === 'amber' ? 'engaged — unproven' : 'untouched'}
                </em>
              </>
            )}
          </div>

          {/* Before the first click this teaches the interaction; after it,
              it becomes a live tally of what the visitor has proven. */}
          <div className="cst-hint" data-engaged={engaged}>
            {engaged ? `${proven} of ${NODES.length} proven` : 'Drag to orbit · click a node to prove it'}
          </div>
        </>
      )}
    </div>
  );
}
