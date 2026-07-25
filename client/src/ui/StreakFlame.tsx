/**
 * Mastery Streak indicator — a small flame shown next to a node's status/
 * mastery figure once it has survived retest(s) while staying green. Purely
 * derived from `masteryStreak()` (shared/src/index.ts): no schema change, no
 * status write, nothing to fetch. Renders nothing when count < 1 so callers
 * can mount it unconditionally next to the mastery score.
 */
export interface StreakFlameProps {
  count: number;
}

export function StreakFlame({ count }: StreakFlameProps) {
  if (count < 1) return null;

  return (
    <span
      className="inline-flex shrink-0 items-center gap-1"
      title={`Proven ${count} time${count === 1 ? '' : 's'} running`}
      aria-label={`Mastery streak: proven ${count} times running`}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        aria-hidden="true"
        focusable="false"
        style={{ filter: 'drop-shadow(0 0 5px var(--status-amber-glow))' }}
      >
        <path
          d="M12 2.5c.6 2.4-.5 3.9-1.8 5.4-1.5 1.7-3 3.5-3 6.1a4.8 4.8 0 0 0 9.6 0c0-1.7-.7-2.9-1.6-4 .3 1.6-.2 2.6-1 3.3-.1-1.4-.6-2.3-1.6-3.2-1.4-1.3-2-2.7-1.6-4.6a5.7 5.7 0 0 0 3 5c1.1 1 1.8 2.2 1.8 3.5a3.8 3.8 0 0 1-7.6 0c0-2 1.1-3.4 2.4-4.8 1.1-1.2 2-2.5 1.4-6.7Z"
          fill="var(--status-amber)"
        />
      </svg>
      <span
        className="tabular-nums"
        style={{ color: 'var(--status-amber)', fontSize: 11, fontWeight: 700 }}
      >
        {count}
      </span>
    </span>
  );
}

export default StreakFlame;
