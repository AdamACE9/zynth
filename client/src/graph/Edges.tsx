import { useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { Edge, RelationshipType } from '@zynth/shared';
import type { PositionMap } from './useGraphLayout';

interface EdgesProps {
  edges: Edge[];
  positions: PositionMap;
}

interface EdgeStyle {
  color: string;
  opacity: number;
  lineWidth: number;
  dashed?: boolean;
}

/**
 * Accent chrome (cyan/violet) so edges never compete with the red/amber/green
 * status colors on the nodes themselves. Prerequisites read brighter/solid
 * (structural backbone), related topics stay dim (soft association).
 * correlated_error uses a distinct amber-orange rather than red/amber, so it
 * never reads as a node status color.
 */
const EDGE_STYLE: Record<RelationshipType, EdgeStyle> = {
  prerequisite: { color: '#7becff', opacity: 0.7, lineWidth: 1.7 },
  related_topic: { color: '#9b7bff', opacity: 0.32, lineWidth: 1.1 },
  correlated_error: { color: '#f5a524', opacity: 0.6, lineWidth: 1.4, dashed: true },
};

interface EdgeLineProps {
  points: [number, number, number][];
  style: EdgeStyle;
  opacity: number;
}

/** A single edge line. Dashed (correlated_error) edges animate their dash
 * offset for a subtle "marching ants" alive feel; all other edges are static. */
function EdgeLine({ points, style, opacity }: EdgeLineProps) {
  const lineRef = useRef<any>(null);

  useFrame((_state, delta) => {
    if (style.dashed && lineRef.current?.material) {
      lineRef.current.material.dashOffset -= delta * 0.6;
    }
  });

  return (
    <Line
      ref={lineRef}
      points={points}
      color={style.color}
      transparent
      opacity={opacity}
      lineWidth={style.lineWidth}
      dashed={style.dashed ?? false}
      dashSize={style.dashed ? 0.3 : undefined}
      gapSize={style.dashed ? 0.2 : undefined}
      toneMapped={false}
    />
  );
}

/** Faint glowing lines between node positions — kept subtle so nodes stay the stars. */
export function Edges({ edges, positions }: EdgesProps) {
  return (
    <group>
      {edges.map((edge) => {
        const from = positions.get(edge.source_node_id);
        const to = positions.get(edge.target_node_id);
        if (!from || !to) return null;
        const style = EDGE_STYLE[edge.relationship_type];
        return (
          <EdgeLine
            key={edge.id}
            points={[from, to]}
            style={style}
            opacity={style.opacity * (0.6 + edge.strength * 0.4)}
          />
        );
      })}
    </group>
  );
}
