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
 */
const EDGE_STYLE: Record<RelationshipType, EdgeStyle> = {
  prerequisite: { color: '#67e8f9', opacity: 0.45, lineWidth: 1.1 },
  related_topic: { color: '#c4b5fd', opacity: 0.16, lineWidth: 0.8 },
  correlated_error: { color: '#fb7185', opacity: 0.35, lineWidth: 0.9, dashed: true },
};

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
          <Line
            key={edge.id}
            points={[from, to]}
            color={style.color}
            transparent
            opacity={style.opacity * (0.6 + edge.strength * 0.4)}
            lineWidth={style.lineWidth}
            dashed={style.dashed ?? false}
            dashSize={style.dashed ? 0.3 : undefined}
            gapSize={style.dashed ? 0.2 : undefined}
            toneMapped={false}
          />
        );
      })}
    </group>
  );
}
