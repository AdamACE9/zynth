import { Billboard, Text } from '@react-three/drei';
import type { PositionMap } from './useGraphLayout';

interface ClusterLabelsProps {
  anchors: PositionMap;
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
        <Billboard key={cluster} position={[anchor[0], anchor[1] + 6.5, anchor[2]]}>
          <Text
            fontSize={1.5}
            color="#c7d2fe"
            letterSpacing={0.32}
            anchorX="center"
            anchorY="middle"
            fillOpacity={0.55}
            outlineWidth={0.045}
            outlineColor="#030308"
            outlineOpacity={0.85}
          >
            {cluster.toUpperCase()}
          </Text>
        </Billboard>
      ))}
    </>
  );
}
