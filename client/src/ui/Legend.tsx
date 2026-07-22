import type { Status } from '@zynth/shared';
import { STATUS_COLORS } from '@zynth/shared';

const ITEMS: Array<{ status: Status; label: string }> = [
  { status: 'red', label: 'Untouched / unproven' },
  { status: 'amber', label: 'Engaged, not proven' },
  { status: 'green', label: 'Passed a quiz' },
];

/** Small, unobtrusive key explaining the status color language. */
export function Legend() {
  return (
    <div className="pointer-events-none fixed bottom-6 left-6 z-10 rounded-xl border border-white/10 bg-white/5 px-4 py-3 backdrop-blur-md">
      <div className="mb-2 text-[10px] uppercase tracking-[0.2em] text-white/35">Mastery legend</div>
      <div className="flex flex-col gap-1.5">
        {ITEMS.map((item) => (
          <div key={item.status} className="flex items-center gap-2 text-xs text-white/70">
            <span
              className="h-2 w-2 rounded-full"
              style={{ backgroundColor: STATUS_COLORS[item.status], boxShadow: `0 0 6px ${STATUS_COLORS[item.status]}` }}
            />
            {item.label}
          </div>
        ))}
      </div>
    </div>
  );
}
