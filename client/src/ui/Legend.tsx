import type { Status } from '@zynth/shared';
import { STATUS_COLORS } from '@zynth/shared';

const GLOW: Record<Status, string> = {
  red: 'var(--status-red-glow)',
  amber: 'var(--status-amber-glow)',
  green: 'var(--status-green-glow)',
};

/** Term = the state. Gloss = the evidence that produces it. */
const ITEMS: Array<{ status: Status; term: string; gloss: string }> = [
  { status: 'red', term: 'Unproven', gloss: 'never touched' },
  { status: 'amber', term: 'Engaged', gloss: 'not proven yet' },
  { status: 'green', term: 'Proven', gloss: 'passed a quiz' },
];

/**
 * The quiet key to the only colour language in the app. Hidden below 1024px:
 * the graph's first-run hint sits bottom-centre and would collide with it on
 * narrow viewports, and the NodePanel spells the same states out anyway.
 */
export function Legend() {
  return (
    <aside
      aria-label="Mastery colour key"
      className="glass-chip pointer-events-none fixed bottom-6 left-6 z-10 hidden px-4 py-3.5 lg:block"
    >
      <div className="section-label" style={{ fontSize: 10 }}>
        Mastery
      </div>
      <dl className="mt-3 flex flex-col gap-2">
        {ITEMS.map((item) => (
          <div key={item.status} className="flex items-center gap-2.5">
            <span
              aria-hidden
              className="h-2 w-2 shrink-0 rounded-full"
              style={{
                backgroundColor: STATUS_COLORS[item.status],
                boxShadow: `0 0 9px ${GLOW[item.status]}, 0 0 2px ${GLOW[item.status]}`,
              }}
            />
            <dt style={{ color: 'var(--text-primary)', fontSize: 12.5, fontWeight: 600, lineHeight: 1.2 }}>{item.term}</dt>
            <dd style={{ color: 'var(--text-muted)', fontSize: 11.5, lineHeight: 1.2 }}>{item.gloss}</dd>
          </div>
        ))}
      </dl>
    </aside>
  );
}
