import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { FOCUS_RING, MAX_SUBJECTS, type SubjectGroup } from '../constants';

export interface SubjectsStepProps {
  groups: readonly SubjectGroup[];
  selected: string[];
  onToggle: (subject: string) => void;
  otherText: string;
  onOtherTextChange: (text: string) => void;
}

/** Cap on how many chips get a staggered delay — past this the entrance is
 * simultaneous rather than making the student wait out a long cascade. */
const MAX_STAGGER = 14;

/** Sets --mx/--my directly on the element from the pointer position, no
 * re-render — the cursor-tracked glow reads these in onboarding.css
 * (`.ob-chip::after`), same technique as `.card::after` in site.css. */
function trackGlow(event: MouseEvent<HTMLButtonElement>) {
  const rect = event.currentTarget.getBoundingClientRect();
  event.currentTarget.style.setProperty('--mx', `${event.clientX - rect.left}px`);
  event.currentTarget.style.setProperty('--my', `${event.clientY - rect.top}px`);
}

/** Step — multi-select subject chips, grouped by discipline, capped so the graph (and the
 * Gemini call fan-out that builds it) stays sane. "Other" is a free-text chip that adds a
 * custom subject and counts toward the same cap. */
export function SubjectsStep({ groups, selected, onToggle, otherText, onOtherTextChange }: SubjectsStepProps) {
  const [otherOpen, setOtherOpen] = useState(otherText.length > 0);
  const otherInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (otherOpen) otherInputRef.current?.focus();
  }, [otherOpen]);

  const otherCounted = otherOpen && otherText.trim().length > 0 ? 1 : 0;
  const count = selected.length + otherCounted;
  const atCap = count >= MAX_SUBJECTS;

  // Flattened index across every group, so the stagger reads as one cascade
  // down the whole library rather than restarting per group.
  const flatIndex = useMemo(() => {
    const order = new Map<string, number>();
    let i = 0;
    for (const g of groups) {
      for (const subject of g.subjects) {
        order.set(subject, i);
        i += 1;
      }
    }
    return order;
  }, [groups]);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <span className="ob-eyebrow">What you&apos;re studying</span>
        <h2 className="ob-display ob-h2 mt-3">Pick your subjects.</h2>
        <p className="ob-lede mt-4" style={{ maxWidth: '48ch' }}>
          Zynth builds a real graph from whatever you pick here — nothing is pre-loaded. Pick up
          to {MAX_SUBJECTS}; add anything missing with &quot;Other&quot;.
        </p>
      </header>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="ob-eyebrow ob-eyebrow-quiet">Subjects</span>
          <span className="ob-micro tabular-nums" aria-live="polite">
            {count} / {MAX_SUBJECTS} selected
          </span>
        </div>

        <div className="mt-4 flex flex-col gap-5">
          {groups.map((group) => (
            <div key={group.label}>
              <span className="ob-mono">{group.label}</span>
              <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label={group.label}>
                {group.subjects.map((subject) => {
                  const isSelected = selected.includes(subject);
                  const disabled = !isSelected && atCap;
                  const i = Math.min(flatIndex.get(subject) ?? 0, MAX_STAGGER);
                  return (
                    <button
                      key={subject}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={disabled}
                      onClick={() => onToggle(subject)}
                      onMouseMove={trackGlow}
                      className={`ob-chip ${FOCUS_RING}`}
                      style={{ ['--i' as string]: i }}
                    >
                      {subject}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <span className="ob-mono">Something else</span>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={otherOpen}
                disabled={!otherOpen && atCap}
                onClick={() => setOtherOpen((v) => !v)}
                onMouseMove={trackGlow}
                className={`ob-chip ${FOCUS_RING}`}
                style={{ ['--i' as string]: Math.min(flatIndex.size, MAX_STAGGER) }}
              >
                + Other
              </button>
            </div>
          </div>
        </div>

        {otherOpen && (
          <input
            ref={otherInputRef}
            type="text"
            value={otherText}
            onChange={(event) => onOtherTextChange(event.target.value)}
            placeholder="e.g. Organic Chemistry"
            autoComplete="off"
            aria-label="Other subject"
            className={`ob-field mt-4 ${FOCUS_RING}`}
            style={{ maxWidth: 420 }}
          />
        )}

        {atCap && (
          <p className="ob-micro mt-3" style={{ color: 'var(--accent-cyan)' }}>
            That&apos;s {MAX_SUBJECTS} — deselect one to swap it for another.
          </p>
        )}
      </div>
    </div>
  );
}
