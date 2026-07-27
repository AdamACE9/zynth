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
 */
export function BuildStep({ mode, phase, subjects, activeIndex, error, workspaceName, name }: BuildStepProps) {
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
        </div>
      );
    }
    return <DoneStep name={name} />;
  }

  if (phase === 'error') {
    return (
      <div className="flex flex-col gap-8">
        <header>
          <span className="ob-eyebrow" style={{ color: 'var(--status-red)' }}>
            Setup hit a snag
          </span>
          <h2 className="ob-display ob-h2 mt-3">Couldn&apos;t build the graph.</h2>
          <p className="ob-lede mt-4" style={{ maxWidth: '48ch' }}>
            {error ?? 'Something went wrong reaching the server.'}
          </p>
        </header>
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

      <ul className="flex flex-col gap-1" aria-label="Build progress">
        {subjects.map((subject, i) => {
          const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'todo';
          return (
            <li key={subject} className="ob-stage" data-active={state !== 'todo'}>
              <span
                aria-hidden
                className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                style={{
                  background:
                    state === 'done' ? 'var(--status-green)' : state === 'active' ? 'var(--accent-cyan)' : 'var(--text-muted)',
                  boxShadow: state === 'active' ? '0 0 12px var(--accent-cyan)' : 'none',
                }}
              />
              <span className="min-w-0">
                <span className="ob-stage-term block">{subject}</span>
                <span className="ob-stage-gloss block">
                  {state === 'done' ? 'Mapped' : state === 'active' ? 'Mapping now…' : 'Queued'}
                </span>
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
