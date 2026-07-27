import { useEffect, useRef } from 'react';
import { FOCUS_RING, GOAL_EXAMPLES, TIMEFRAME_WEEK_OPTIONS } from '../constants';

export interface GoalStepProps {
  goal: string;
  onGoalChange: (goal: string) => void;
  timeframeWeeks: number | null;
  onTimeframeWeeksChange: (weeks: number | null) => void;
  timeframeDate: string;
  onTimeframeDateChange: (date: string) => void;
}

/** Step — free-text goal plus a timeframe, seeded with clickable examples.
 * Feeds the Study-Plan module and Time-Machine later. */
export function GoalStep({
  goal,
  onGoalChange,
  timeframeWeeks,
  onTimeframeWeeksChange,
  timeframeDate,
  onTimeframeDateChange,
}: GoalStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  function pickWeeks(weeks: number) {
    onTimeframeWeeksChange(timeframeWeeks === weeks ? null : weeks);
    if (timeframeDate) onTimeframeDateChange('');
  }

  function handleDateChange(value: string) {
    onTimeframeDateChange(value);
    if (value && timeframeWeeks !== null) onTimeframeWeeksChange(null);
  }

  return (
    <div className="flex flex-col gap-8">
      <header>
        <span className="ob-eyebrow">Why you&apos;re here</span>
        <h2 className="ob-display ob-h2 mt-3">What are you aiming at?</h2>
        <p className="ob-lede mt-4" style={{ maxWidth: '48ch' }}>
          One line is plenty. It steers the Study-Plan module and the Time-Machine, and you can
          change it any time.
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
          placeholder="Ace the Physics mock"
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

      <div>
        <span className="ob-eyebrow ob-eyebrow-quiet">By when</span>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {TIMEFRAME_WEEK_OPTIONS.map((weeks) => (
            <button
              key={weeks}
              type="button"
              aria-pressed={timeframeWeeks === weeks}
              onClick={() => pickWeeks(weeks)}
              className={`ob-chip ob-chip-sm ${FOCUS_RING}`}
            >
              {weeks} {weeks === 1 ? 'week' : 'weeks'}
            </button>
          ))}
          <span className="ob-micro">or</span>
          <input
            type="date"
            value={timeframeDate}
            onChange={(event) => handleDateChange(event.target.value)}
            aria-label="Target date"
            className={`ob-field ${FOCUS_RING}`}
            style={{ width: 'auto', maxWidth: 190, padding: '9px 12px', fontSize: 14 }}
          />
        </div>
        <p className="ob-micro mt-3">Skippable — you can set a timeframe later from the Study Plan.</p>
      </div>
    </div>
  );
}
