import type { ReactNode } from 'react';

export interface DoneStepProps {
  name: string;
}

const STRONG = { color: 'var(--text-primary)', fontWeight: 600 } as const;

const LOOP_STEPS: { n: string; title: string; body: ReactNode; dot: string }[] = [
  {
    n: '01',
    title: 'Find a weak spot',
    body: 'Click any glowing node in the graph. Red ones are the concepts you have never proven.',
    dot: 'var(--status-red)',
  },
  {
    n: '02',
    title: 'Engage it',
    body: (
      <>
        Open <span style={STRONG}>Intuition</span> or <span style={STRONG}>Explain</span>. That&apos;s red to amber.
      </>
    ),
    dot: 'var(--status-amber)',
  },
  {
    n: '03',
    title: 'Prove it',
    body: (
      <>
        Pass a <span style={STRONG}>Quiz</span>. The only path to green — and a failed retest sends it back.
      </>
    ),
    dot: 'var(--status-green)',
  },
];

/** Step 05 — the recap. The big "Enter my graph" CTA lives in the shared footer. */
export function DoneStep({ name }: DoneStepProps) {
  return (
    <div className="flex flex-col gap-8">
      <header>
        <span className="ob-eyebrow">Ready</span>
        <h2 className="ob-display ob-h2 mt-3">{name ? `You're set, ${name}.` : "You're set."}</h2>
        <p className="ob-lede mt-4" style={{ maxWidth: '46ch' }}>
          Here&apos;s the loop you&apos;ll run, every single time.
        </p>
      </header>

      <ol className="flex flex-col">
        {LOOP_STEPS.map((step, i) => (
          <li key={step.n}>
            {i > 0 && <hr className="ob-rule" />}
            <div className="flex items-start gap-4 py-4">
              <span className="flex shrink-0 items-center gap-2 pt-0.5" aria-hidden style={{ width: 46 }}>
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{ background: step.dot, boxShadow: `0 0 10px ${step.dot}` }}
                />
                <span className="ob-num">{step.n}</span>
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {step.title}
                </span>
                <span className="ob-body mt-1 block">{step.body}</span>
              </span>
            </div>
          </li>
        ))}
      </ol>

      <p className="ob-micro" style={{ maxWidth: '54ch' }}>
        Made a mistake somewhere? Paste it into <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>Autopsy</span>{' '}
        in the top bar — it clusters your recurring errors into brand-new weak spots on the graph.
      </p>
    </div>
  );
}
