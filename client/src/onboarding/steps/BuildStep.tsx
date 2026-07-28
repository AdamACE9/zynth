import { DoneStep } from './DoneStep';

export type BuildPhase = 'building' | 'error' | 'done';

export interface BuildStepProps {
  mode: 'full' | 'newWorkspace';
  phase: BuildPhase;
  subjects: string[];
  /** Which subject is currently being mapped (simulated pacing — see Onboarding.tsx). */
  activeIndex: number;
  error: string | null;
  workspaceName: string;
  name: string;
  /** Wall-clock duration of the real request, once it's settled. Null while
   * still in flight — never faked, so the closing log line only ever reports
   * something that actually happened. */
  elapsedMs: number | null;
}

/** Formats a millisecond duration as a build-log-style seconds readout. */
function formatElapsed(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/**
 * The build step. Onboarding.tsx kicks off POST /api/workspaces the moment
 * this step mounts and owns all the async state — this component is purely
 * presentational so the actual request lifecycle lives in one place.
 *
 * Progress here is a paced simulation (the backend does one Gemini call per
 * subject with no per-subject event stream to hook into), but it always
 * resolves to the REAL outcome: the moment the request settles we jump
 * straight to 'done' or 'error', we never just sit on a fake number.
 *
 * Styled as a real build log rather than a spinner — mono status lines with
 * leader dots, a blinking caret, and a closing line that reports genuine
 * elapsed time. "No spinners-only" per the brief: the per-subject list IS the
 * spinner, and it says something true.
 */
export function BuildStep({ mode, phase, subjects, activeIndex, error, workspaceName, name, elapsedMs }: BuildStepProps) {
  if (phase === 'done') {
    if (mode === 'newWorkspace') {
      return (
        <div className="flex flex-col gap-8">
          <header>
            <span className="ob-eyebrow">Ready</span>
            <h2 className="ob-display ob-h2 mt-3">&quot;{workspaceName}&quot; is mapped.</h2>
            <p className="ob-lede mt-4" style={{ maxWidth: '48ch' }}>
              {subjects.length} subject{subjects.length === 1 ? '' : 's'}, every node red. Switch to it any time from
              the tabs at the top.
            </p>
          </header>
          <p className="ob-mono">
            [ok] build complete{elapsedMs !== null ? ` in ${formatElapsed(elapsedMs)}` : ''}
          </p>
        </div>
      );
    }
    return <DoneStep name={name} />;
  }

  if (phase === 'error') {
    return (
      <div className="flex flex-col gap-8">
        <header>
          {/* No status-red here — a failed request is a chrome-level severity, not
              a mastery reading, so it stays inside the cyan eyebrow idiom and
              lets the copy itself carry the bad news. */}
          <span className="ob-eyebrow">Setup hit a snag</span>
          <h2 className="ob-display ob-h2 mt-3">Couldn&apos;t build the graph.</h2>
          <p className="ob-lede mt-4" style={{ maxWidth: '48ch' }}>
            {error ?? 'Something went wrong reaching the server.'}
          </p>
        </header>
        <p className="ob-mono">[!!] build failed — nothing was saved</p>
        <p className="ob-micro">
          Hit &quot;Retry&quot; below, or use &quot;Skip setup&quot; to continue with whatever graph is already there.
        </p>
      </div>
    );
  }

  const current = subjects[activeIndex];

  return (
    <div className="flex flex-col gap-8">
      <header>
        <span className="ob-eyebrow">Building</span>
        <h2 className="ob-display ob-h2 mt-3">Mapping your subjects.</h2>
        <p className="ob-lede mt-4" style={{ maxWidth: '48ch' }} aria-live="polite">
          {current
            ? `Mapping ${current}… ${Math.min(activeIndex + 1, subjects.length)} of ${subjects.length} subjects`
            : 'Talking to Gemini…'}
        </p>
      </header>

      <div>
        <p className="ob-mono">
          $ zynth build --subjects={subjects.length}
          <span className="ob-caret" aria-hidden />
        </p>
        <ul className="ob-buildlog mt-3" aria-label="Build progress">
          {subjects.map((subject, i) => {
            const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'todo';
            // Chrome only — cyan/violet, never a mastery colour, per
            // DESIGN-LANGUAGE.md: this is build progress, not a proof state.
            const tag = state === 'done' ? '[ok]' : state === 'active' ? '[..]' : '[  ]';
            const status = state === 'done' ? 'mapped' : state === 'active' ? 'mapping…' : 'queued';
            return (
              <li key={subject} className="ob-logline" data-state={state}>
                <span className="ob-logline-tag">{tag}</span>
                <span className="ob-logline-name">{subject}</span>
                <span className="ob-logline-dots" aria-hidden />
                <span className="ob-logline-status">{status}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
