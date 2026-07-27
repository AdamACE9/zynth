import { useEffect, useRef, useState } from 'react';
import { FOCUS_RING, MAX_SUBJECTS, type SubjectGroup } from '../constants';

export interface SubjectsStepProps {
  groups: readonly SubjectGroup[];
  selected: string[];
  onToggle: (subject: string) => void;
  otherText: string;
  onOtherTextChange: (text: string) => void;
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
              <span className="ob-micro" style={{ letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 10 }}>
                {group.label}
              </span>
              <div className="mt-2.5 flex flex-wrap gap-2" role="group" aria-label={group.label}>
                {group.subjects.map((subject) => {
                  const isSelected = selected.includes(subject);
                  const disabled = !isSelected && atCap;
                  return (
                    <button
                      key={subject}
                      type="button"
                      aria-pressed={isSelected}
                      disabled={disabled}
                      onClick={() => onToggle(subject)}
                      className={`ob-chip ${FOCUS_RING}`}
                      style={disabled ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
                    >
                      {subject}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}

          <div>
            <span className="ob-micro" style={{ letterSpacing: '0.12em', textTransform: 'uppercase', fontSize: 10 }}>
              Something else
            </span>
            <div className="mt-2.5 flex flex-wrap gap-2">
              <button
                type="button"
                aria-pressed={otherOpen}
                disabled={!otherOpen && atCap}
                onClick={() => setOtherOpen((v) => !v)}
                className={`ob-chip ${FOCUS_RING}`}
                style={!otherOpen && atCap ? { opacity: 0.35, cursor: 'not-allowed' } : undefined}
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
