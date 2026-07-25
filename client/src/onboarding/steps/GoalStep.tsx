import { useEffect, useRef } from 'react';
import { FOCUS_RING, GOAL_EXAMPLES } from '../constants';

export interface GoalStepProps {
  goal: string;
  onGoalChange: (goal: string) => void;
}

/** Step 04 — free-text goal, seeded with clickable examples. Feeds the Study-Plan module later. */
export function GoalStep({ goal, onGoalChange }: GoalStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <span className="ob-eyebrow">Why you&apos;re here</span>
        <h2 className="ob-display ob-h2 mt-3">What are you aiming at?</h2>
        <p className="ob-lede mt-4" style={{ maxWidth: '48ch' }}>
          One line is plenty. It steers the Study-Plan module later, and you can change it any time.
        </p>
      </header>

      <div>
        <label htmlFor="onboarding-goal" className="ob-eyebrow ob-eyebrow-quiet">
          Your goal
        </label>
        <input
          ref={inputRef}
          id="onboarding-goal"
          type="text"
          value={goal}
          onChange={(event) => onGoalChange(event.target.value)}
          placeholder="Ace the Physics mock in 3 weeks"
          autoComplete="off"
          className={`ob-field mt-3 ${FOCUS_RING}`}
          style={{ maxWidth: 480 }}
        />

        <div className="mt-5">
          <span className="ob-micro">Or borrow one:</span>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {GOAL_EXAMPLES.map((example) => (
              <button
                key={example}
                type="button"
                aria-pressed={goal === example}
                onClick={() => onGoalChange(example)}
                className={`ob-chip ob-chip-sm ${FOCUS_RING}`}
              >
                {example}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
