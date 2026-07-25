import { useEffect, useRef, useState } from 'react';
import { FOCUS_RING } from '../constants';

export interface SubjectsStepProps {
  options: readonly string[];
  selected: string[];
  onToggle: (subject: string) => void;
  otherText: string;
  onOtherTextChange: (text: string) => void;
}

/** Step 03 — multi-select subject chips, with an honest note about the demo graph's seed data. */
export function SubjectsStep({ options, selected, onToggle, otherText, onOtherTextChange }: SubjectsStepProps) {
  const [otherOpen, setOtherOpen] = useState(otherText.length > 0);
  const otherInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (otherOpen) otherInputRef.current?.focus();
  }, [otherOpen]);

  const count = selected.length + (otherOpen && otherText.trim() ? 1 : 0);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <span className="ob-eyebrow">What you&apos;re studying</span>
        <h2 className="ob-display ob-h2 mt-3">Pick your subjects.</h2>
        <p className="ob-lede mt-4" style={{ maxWidth: '48ch' }}>
          Calculus and Physics are pre-selected — the demo graph you&apos;re about to see is seeded with those
          two. Add or swap in whatever you&apos;re actually studying.
        </p>
      </header>

      <div>
        <div className="flex items-baseline justify-between gap-3">
          <span className="ob-eyebrow ob-eyebrow-quiet">Subjects</span>
          <span className="ob-micro tabular-nums">{count} selected</span>
        </div>

        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Subjects">
          {options.map((subject) => (
            <button
              key={subject}
              type="button"
              aria-pressed={selected.includes(subject)}
              onClick={() => onToggle(subject)}
              className={`ob-chip ${FOCUS_RING}`}
            >
              {subject}
            </button>
          ))}
          <button
            type="button"
            aria-pressed={otherOpen}
            onClick={() => setOtherOpen((v) => !v)}
            className={`ob-chip ${FOCUS_RING}`}
          >
            + Other
          </button>
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
      </div>
    </div>
  );
}
