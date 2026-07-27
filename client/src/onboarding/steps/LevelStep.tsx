import { FOCUS_RING, LEVEL_OPTIONS } from '../constants';

export interface LevelStepProps {
  level: string;
  onLevelChange: (level: string) => void;
}

/**
 * Study level — a single select. This isn't decoration: GCSE Calculus and
 * University Calculus are different graphs entirely, so this genuinely
 * changes what concepts get generated for the same subject list.
 */
export function LevelStep({ level, onLevelChange }: LevelStepProps) {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <span className="ob-eyebrow">How deep to go</span>
        <h2 className="ob-display ob-h2 mt-3">What level are you studying at?</h2>
        <p className="ob-lede mt-4" style={{ maxWidth: '48ch' }}>
          This decides how much of the syllabus gets mapped — GCSE gets the essentials, University
          gets the full depth of the subject.
        </p>
      </header>

      <div>
        <span className="ob-eyebrow ob-eyebrow-quiet">Level</span>
        <div className="mt-4 flex flex-wrap gap-2" role="radiogroup" aria-label="Study level">
          {LEVEL_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              role="radio"
              aria-checked={level === option.id}
              aria-pressed={level === option.id}
              onClick={() => onLevelChange(option.id)}
              className={`ob-chip ${FOCUS_RING}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {!level && (
          <p className="ob-micro mt-3">Skippable — Zynth will default to a general level.</p>
        )}
      </div>
    </div>
  );
}
