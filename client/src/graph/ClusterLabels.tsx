import { useRef } from 'react';
import { Billboard, Text } from '@react-three/drei';
import { useFrame } from '@react-three/fiber';
import type { Mesh } from 'three';
import type { PositionMap } from './useGraphLayout';

interface ClusterLabelsProps {
  anchors: PositionMap;
}

/** How far outside its cluster the label sits, in world units. */
const OUTWARD_OFFSET = 7;
/** Past this fraction of the graph's own scale, a label starts fading out. */
const FADE_START = 0.55;
const BASE_OPACITY = 0.62;

interface ClusterLabelProps {
  text: string;
  anchor: readonly [number, number, number];
}

/**
 * One subject label.
 *
 * Two things stop these turning into an unreadable pile, both learned from a
 * 13-subject graph where "TRIGONOMETRY" sat on top of "ALGEBRA" and "DATA
 * STRUCTURES" on top of "COMPUTER SCIENCE":
 *
 * 1. The label is pushed radially OUTWARD from the ring's centre, not just up.
 *    Cluster anchors lie on a ring around the origin, so offsetting in y alone
 *    left every label hanging over the middle of the map — precisely where the
 *    other twelve labels and every cross-subject edge already converge.
 *
 * 2. It fades with depth. A billboard always faces the camera, so labels on the
 *    FAR side of the ring draw at full strength directly behind the near ones and
 *    collide in screen space however well the anchors are spaced. Fading by
 *    distance means you only read the half of the map facing you.
 */
function ClusterLabel({ text, anchor }: ClusterLabelProps) {
  const ref = useRef<Mesh>(null);

  const [ax, ay, az] = anchor;
  // Radial direction from the ring's centre. Falls back to +x for a cluster
  // sitting on the origin (single-subject graphs).
  const horizontal = Math.hypot(ax, az);
  const dirX = horizontal > 0.001 ? ax / horizontal : 1;
  const dirZ = horizontal > 0.001 ? az / horizontal : 0;

  const position: [number, number, number] = [
    ax + dirX * OUTWARD_OFFSET,
    ay + 5.5,
    az + dirZ * OUTWARD_OFFSET,
  ];

  useFrame((state) => {
    const mesh = ref.current;
    if (!mesh) return;

    // Normalised against the graph's own scale so this behaves the same on a
    // 2-subject graph as on a 13-subject one.
    const distance = state.camera.position.distanceTo(mesh.position);
    const ringScale = Math.max(horizontal, 12);
    const normalised = distance / (ringScale * 3);

    const opacity =
      normalised <= FADE_START
        ? BASE_OPACITY
        : Math.max(0, BASE_OPACITY * (1 - (normalised - FADE_START) / 0.5));

    const material = mesh.material as { opacity?: number; transparent?: boolean } | undefined;
    if (material && typeof material.opacity === 'number') {
      material.opacity = opacity;
      material.transparent = true;
    }
  });

  return (
    <Billboard position={position}>
      <Text
        ref={ref}
        fontSize={1.5}
        color="#c7d2fe"
        letterSpacing={0.32}
        anchorX="center"
        anchorY="middle"
        fillOpacity={BASE_OPACITY}
        outlineWidth={0.045}
        outlineColor="#030308"
        outlineOpacity={0.85}
      >
        {text}
      </Text>
    </Billboard>
  );
}

/**
 * Floating, low-opacity uppercase subject labels near each constellation's
 * anchor. A dark outline (rather than a custom font — fragile to load into
 * drei's <Text> and not worth risking the build over) keeps them legible
 * against the bright nebula washes and bloom without raising their opacity
 * enough to compete with the nodes.
 */
export function ClusterLabels({ anchors }: ClusterLabelsProps) {
  return (
    <>
      {Array.from(anchors.entries()).map(([cluster, anchor]) => (
        <ClusterLabel key={cluster} text={cluster.toUpperCase()} anchor={anchor} />
      ))}
    </>
  );
}
