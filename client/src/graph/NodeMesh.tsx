import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Billboard, Html } from '@react-three/drei';
import * as THREE from 'three';
import type { Node } from '@zynth/shared';
import { STATUS_COLORS } from '@zynth/shared';

interface NodeMeshProps {
  node: Node;
  position: [number, number, number];
  isSelected: boolean;
  onSelect: (id: string) => void;
}

/** Deterministic 0..1 seed per node id, so idle pulses don't all sync up. */
function hashSeed(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) % 1000;
  }
  return h / 1000;
}

/**
 * Runtime-generated (no asset) radial white->transparent gradient, used as an
 * additive-blended billboard behind every node to turn a bare glowing sphere
 * into a "premium orb with atmosphere." Built once and shared across every
 * NodeMesh instance — only the tint (material.color) and scale/opacity differ
 * per node.
 */
let sharedHaloTexture: THREE.Texture | null = null;
function getHaloTexture(): THREE.Texture {
  if (sharedHaloTexture) return sharedHaloTexture;
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
  sharedHaloTexture = texture;
  return texture;
}

const IDLE_EMISSIVE = 1.6;
const HOVER_EMISSIVE = 2.8;
const SELECTED_EMISSIVE = 3.4;
const FLASH_DURATION = 0.2; // seconds — single "case closed" spike, not a loop

/**
 * A single glowing concept node. Color comes from STATUS_COLORS[status];
 * `toneMapped={false}` on the material is required for the Bloom pass in
 * KnowledgeGraph.tsx to actually pick it up. Status color transitions are
 * animated (lerped) over ~0.6s in useFrame instead of snapping instantly —
 * and paired with a brief one-shot emissive flash (~1.4x baseline for
 * ~200ms) on the frame the status actually changes. This is the understated
 * "case closed" beat referenced in the brief — a flash, not confetti.
 */
export function NodeMesh({ node, position, isSelected, onSelect }: NodeMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const haloRef = useRef<THREE.Mesh>(null);
  const haloMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const ringMaterialRef = useRef<THREE.MeshBasicMaterial>(null);
  const [hovered, setHovered] = useState(false);

  const prevStatusRef = useRef(node.status);
  const flashRemainingRef = useRef(0);

  const seedOffset = useMemo(() => hashSeed(node.id) * Math.PI * 2, [node.id]);
  const targetColor = useMemo(() => new THREE.Color(STATUS_COLORS[node.status]), [node.status]);
  const haloTexture = useMemo(() => getHaloTexture(), []);
  // Wider spread so mastery differences read clearly at a glance.
  const baseRadius = 0.28 + (node.mastery_score / 100) * 0.55;

  useFrame((state, delta) => {
    const material = materialRef.current;
    const mesh = meshRef.current;
    const halo = haloRef.current;
    const haloMaterial = haloMaterialRef.current;

    if (prevStatusRef.current !== node.status) {
      prevStatusRef.current = node.status;
      flashRemainingRef.current = FLASH_DURATION;
    }
    const flashing = flashRemainingRef.current > 0;
    if (flashing) {
      flashRemainingRef.current = Math.max(0, flashRemainingRef.current - delta);
    }

    const t = state.clock.elapsedTime;
    const pulse = 1 + Math.sin(t * 1.4 + seedOffset) * 0.045;

    if (material) {
      const colorLerp = Math.min(1, delta / 0.6);
      material.emissive.lerp(targetColor, colorLerp);
      material.color.lerp(targetColor, colorLerp);
      const restingIntensity = isSelected ? SELECTED_EMISSIVE : hovered ? HOVER_EMISSIVE : IDLE_EMISSIVE;
      const target = flashing ? restingIntensity * 1.4 : restingIntensity;
      material.emissiveIntensity = THREE.MathUtils.lerp(
        material.emissiveIntensity,
        target,
        Math.min(1, delta * (flashing ? 12 : 3)),
      );
    }

    if (mesh) {
      const hoverScale = isSelected ? 1.55 : hovered ? 1.25 : 1;
      const target = baseRadius * pulse * hoverScale;
      const next = THREE.MathUtils.lerp(mesh.scale.x, target, Math.min(1, delta * 6));
      mesh.scale.setScalar(next);
    }

    if (halo && haloMaterial) {
      haloMaterial.color.lerp(targetColor, Math.min(1, delta / 0.6));
      const haloHoverScale = isSelected ? 1.3 : hovered ? 1.15 : 1;
      const haloTarget = baseRadius * 4.5 * pulse * haloHoverScale;
      halo.scale.setScalar(THREE.MathUtils.lerp(halo.scale.x, haloTarget, Math.min(1, delta * 6)));
      const opacityPulse = 0.42 + Math.sin(t * 1.4 + seedOffset) * 0.08;
      const opacityTarget = flashing ? Math.min(0.75, opacityPulse * 1.4) : opacityPulse;
      haloMaterial.opacity = THREE.MathUtils.lerp(haloMaterial.opacity, opacityTarget, Math.min(1, delta * 6));
    }

    // Select ring fades in over ~150ms rather than snapping on mount.
    if (ringMaterialRef.current) {
      ringMaterialRef.current.opacity = THREE.MathUtils.lerp(ringMaterialRef.current.opacity, 0.55, Math.min(1, delta * 7));
    }
  });

  return (
    <group position={position}>
      <Billboard>
        <mesh ref={haloRef}>
          <planeGeometry args={[1, 1]} />
          <meshBasicMaterial
            ref={haloMaterialRef}
            map={haloTexture}
            color={STATUS_COLORS[node.status]}
            transparent
            opacity={0.42}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
            toneMapped={false}
          />
        </mesh>
      </Billboard>

      <mesh
        ref={meshRef}
        onClick={(e) => {
          e.stopPropagation();
          onSelect(node.id);
        }}
        onPointerOver={(e) => {
          e.stopPropagation();
          setHovered(true);
          document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => {
          setHovered(false);
          document.body.style.cursor = 'auto';
        }}
      >
        <sphereGeometry args={[1, 32, 32]} />
        <meshStandardMaterial
          ref={materialRef}
          color={STATUS_COLORS[node.status]}
          emissive={STATUS_COLORS[node.status]}
          emissiveIntensity={IDLE_EMISSIVE}
          roughness={0.25}
          metalness={0.5}
          toneMapped={false}
        />
      </mesh>

      {isSelected && (
        <Billboard>
          <mesh>
            <ringGeometry args={[baseRadius * 2.0, baseRadius * 2.35, 64]} />
            <meshBasicMaterial
              ref={ringMaterialRef}
              color={STATUS_COLORS[node.status]}
              transparent
              opacity={0}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </Billboard>
      )}

      {(hovered || isSelected) && (
        <Html position={[0, baseRadius + 0.55, 0]} center distanceFactor={12}>
          <div className="glass-chip pointer-events-none select-none whitespace-nowrap px-2 py-1 text-[11px] font-medium tracking-wide" style={{ color: 'var(--text-primary)' }}>
            {node.label}
          </div>
        </Html>
      )}
    </group>
  );
}
