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
 * A single glowing concept node. Color comes from STATUS_COLORS[status];
 * `toneMapped={false}` on the material is required for the Bloom pass in
 * KnowledgeGraph.tsx to actually pick it up. Status color transitions are
 * animated (lerped) over ~0.6s in useFrame instead of snapping instantly —
 * this is the understated "case closed" beat referenced in the brief, no
 * confetti.
 */
export function NodeMesh({ node, position, isSelected, onSelect }: NodeMeshProps) {
  const meshRef = useRef<THREE.Mesh>(null);
  const materialRef = useRef<THREE.MeshStandardMaterial>(null);
  const [hovered, setHovered] = useState(false);

  const seedOffset = useMemo(() => hashSeed(node.id) * Math.PI * 2, [node.id]);
  const targetColor = useMemo(() => new THREE.Color(STATUS_COLORS[node.status]), [node.status]);
  const baseRadius = 0.32 + (node.mastery_score / 100) * 0.3;

  useFrame((state, delta) => {
    const material = materialRef.current;
    const mesh = meshRef.current;

    if (material) {
      const colorLerp = Math.min(1, delta / 0.6);
      material.emissive.lerp(targetColor, colorLerp);
      material.color.lerp(targetColor, colorLerp);
      const targetIntensity = isSelected ? 3.4 : hovered ? 2.8 : 2.0;
      material.emissiveIntensity = THREE.MathUtils.lerp(
        material.emissiveIntensity,
        targetIntensity,
        Math.min(1, delta * 3),
      );
    }

    if (mesh) {
      const t = state.clock.elapsedTime;
      const pulse = 1 + Math.sin(t * 1.4 + seedOffset) * 0.045;
      const hoverScale = isSelected ? 1.55 : hovered ? 1.25 : 1;
      const target = baseRadius * pulse * hoverScale;
      const next = THREE.MathUtils.lerp(mesh.scale.x, target, Math.min(1, delta * 6));
      mesh.scale.setScalar(next);
    }
  });

  return (
    <group position={position}>
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
          emissiveIntensity={2}
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
              color={STATUS_COLORS[node.status]}
              transparent
              opacity={0.55}
              toneMapped={false}
              side={THREE.DoubleSide}
            />
          </mesh>
        </Billboard>
      )}

      {(hovered || isSelected) && (
        <Html position={[0, baseRadius + 0.55, 0]} center distanceFactor={12}>
          <div className="pointer-events-none select-none whitespace-nowrap rounded-md border border-white/10 bg-black/70 px-2 py-1 text-[11px] font-medium tracking-wide text-white/90 shadow-lg shadow-black/40 backdrop-blur-sm">
            {node.label}
          </div>
        </Html>
      )}
    </group>
  );
}
