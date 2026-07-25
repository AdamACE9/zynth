import { useEffect, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Line } from '@react-three/drei';
import type { GhostPath as GhostPathData, GhostVerdict } from '@zynth/shared';
import { getSocket } from '../lib/socket';
import type { PositionMap } from './useGraphLayout';

interface GhostPathProps {
  /** Node id -> 3D position, straight from useGraphLayout (computed by KnowledgeGraph). */
  positions: PositionMap;
}

/** Route tint by GPS-ETA verdict — green reads as "ahead" everywhere else in
 * the app, amber as "behind", so Ghost Path reuses those hues rather than
 * inventing a fourth palette. */
const VERDICT_COLOR: Record<GhostVerdict, string> = {
  ahead: '#28e0a0',
  on_track: '#52e5e8',
  behind: '#ffb020',
};

async function fetchGhostPath(): Promise<GhostPathData | null> {
  try {
    const res = await fetch('/api/plan');
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`GET /api/plan responded ${res.status}`);
    return (await res.json()) as GhostPathData;
  } catch (err) {
    console.warn('[Zynth] /api/plan unreachable — Ghost Path stays hidden.', err);
    return null;
  }
}

interface GhostSegmentProps {
  points: [number, number, number][];
  color: string;
  opacity: number;
  dashed?: boolean;
}

/** One glowing polyline stretch of the route — traveled (solid, cyan) or
 * remaining (dashed, verdict-tinted). Dashed segments animate their dash
 * offset for a subtle "still moving" feel, mirroring Edges.tsx's treatment
 * of correlated_error edges. */
function GhostSegment({ points, color, opacity, dashed }: GhostSegmentProps) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lineRef = useRef<any>(null);

  useFrame((_state, delta) => {
    if (dashed && lineRef.current?.material) {
      lineRef.current.material.dashOffset -= delta * 0.45;
    }
  });

  if (points.length < 2) return null;

  return (
    <Line
      ref={lineRef}
      points={points}
      color={color}
      transparent
      opacity={opacity}
      lineWidth={dashed ? 2.4 : 3.2}
      dashed={dashed ?? false}
      dashSize={dashed ? 0.42 : undefined}
      gapSize={dashed ? 0.26 : undefined}
      toneMapped={false}
    />
  );
}

/**
 * The GPS-ETA route overlay: a glowing polyline threading through the
 * planned node sequence's 3D positions, self-fetching the active plan on
 * mount and staying live via the 'plan:updated' socket event (the same
 * silent-replan signal the Study Plan Board listens for). Renders nothing
 * without an active plan, or once fewer than two of its nodes have known
 * positions yet.
 *
 * The completed stretch (steps already reached, per GhostPath.actual_position)
 * renders solid and bright; the remaining stretch renders dashed and tinted
 * by the ahead/on_track/behind verdict — the same "GPS recalculating" read
 * the Study Plan Board describes in words, drawn straight onto the graph.
 */
export function GhostPath({ positions }: GhostPathProps) {
  const [ghost, setGhost] = useState<GhostPathData | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchGhostPath().then((g) => {
      if (!cancelled) setGhost(g);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const socket = getSocket();
    function handlePlanUpdated(payload: { ghost: GhostPathData; because: string }) {
      setGhost(payload.ghost);
    }
    socket.on('plan:updated', handlePlanUpdated);
    return () => {
      socket.off('plan:updated', handlePlanUpdated);
    };
  }, []);

  if (!ghost || ghost.steps.length < 2) return null;

  const stepPositions = ghost.steps.map((step) => positions.get(step.node_id) ?? null);
  const travelIndex = Math.min(ghost.actual_position, ghost.steps.length - 1);

  // Both segments include the point at travelIndex on purpose — a shared
  // vertex so the two colored stretches read as one continuous route instead
  // of leaving a gap at the "you are here" point.
  const traveled = stepPositions
    .slice(0, travelIndex + 1)
    .filter((p): p is [number, number, number] => p !== null);
  const remaining = stepPositions.slice(travelIndex).filter((p): p is [number, number, number] => p !== null);

  return (
    <group>
      <GhostSegment points={traveled} color="#52e5e8" opacity={0.85} />
      <GhostSegment points={remaining} color={VERDICT_COLOR[ghost.verdict]} opacity={0.55} dashed />
    </group>
  );
}

export default GhostPath;
