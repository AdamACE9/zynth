import type { Status } from '@zynth/shared';
import { STATUS_COLORS } from '@zynth/shared';

const GLOW: Record<Status, string> = {
  red: 'var(--status-red-glow)',
  amber: 'var(--status-amber-glow)',
  green: 'var(--status-green-glow)',
};

const ITEMS: Array<{ status: Status; label: string }> = [
  { status: 'red', label: 'Untouched / unproven' },
  { status: 'amber', label: 'Engaged, not proven' },
  { status: 'green', label: 'Passed a quiz' },
];

/** Small, unobtrusive key explaining the status color language. */
export function Legend() {
  return (
    <div className="glass-chip pointer-events-none fixed bottom-6 left-6 z-10 px-4 py-3">
      <div className="section-label mb-2">Mastery legend</div>
      <div className="flex flex-col gap-1.5">
        {ITEMS.map((item) => (
          <div key={item.status} className="flex items-center gap-2 text-xs" style={{ color: 'var(--text-secondary)' }}>
            <span
              className="h-2 w-2 rounded-full"
              style={{
                backgroundColor: STATUS_COLORS[item.status],
                boxShadow: `0 0 8px ${GLOW[item.status]}, 0 0 2px ${GLOW[item.status]}`,
              }}
            />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
