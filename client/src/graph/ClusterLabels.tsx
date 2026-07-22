import { Billboard, Text } from '@react-three/drei';
import type { PositionMap } from './useGraphLayout';

interface ClusterLabelsProps {
  anchors: PositionMap;
}

/** Floating, low-opacity uppercase subject labels near each constellation's anchor. */
export function ClusterLabels({ anchors }: ClusterLabelsProps) {
  return (
    <>
      {Array.from(anchors.entries()).map(([cluster, anchor]) => (
        <Billboard key={cluster} position={[anchor[0], anchor[1] + 6.5, anchor[2]]}>
          <Text
            fontSize={1.3}
            color="#93a5d8"
            letterSpacing={0.28}
            anchorX="center"
            anchorY="middle"
            fillOpacity={0.4}
          >
            {cluster.toUpperCase()}
          </Text>
        </Billboard>
      ))}
    </>
  );
}
