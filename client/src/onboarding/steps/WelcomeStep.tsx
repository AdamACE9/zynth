import { useEffect, useRef } from 'react';
import { FOCUS_RING } from '../constants';

export interface WelcomeStepProps {
  name: string;
  onNameChange: (name: string) => void;
}

/** Step 01 — the hook, plus an optional first name. No account, ever. */
export function WelcomeStep({ name, onNameChange }: WelcomeStepProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div className="flex flex-col gap-9">
      <header>
        <span className="ob-eyebrow">Welcome</span>
        <h1 className="ob-display ob-h1 mt-3">
          The truth about what you
          <br className="hidden sm:block" /> actually know.
        </h1>
        <p className="ob-lede mt-5" style={{ maxWidth: '46ch' }}>
          In about a minute you&apos;ll drop into a living 3D map of your knowledge — every concept a node,
          coloured by whether you&apos;ve <strong style={{ color: 'var(--text-primary)', fontWeight: 600 }}>proven</strong> it,
          not whether you&apos;ve seen it.
        </p>
      </header>

      <hr className="ob-rule" />

      <div>
        <label htmlFor="onboarding-name" className="ob-eyebrow ob-eyebrow-quiet">
          What should we call you?
        </label>
        <input
          ref={inputRef}
          id="onboarding-name"
          type="text"
          value={name}
          onChange={(event) => onNameChange(event.target.value)}
          placeholder="First name — optional"
          autoComplete="off"
          className={`ob-field mt-3 ${FOCUS_RING}`}
          style={{ maxWidth: 420 }}
        />
        <p className="ob-micro mt-3">No account. No email. Nothing leaves this device.</p>
      </div>
    </div>
  );
}
