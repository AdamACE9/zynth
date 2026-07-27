import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { DEMO_STATUS_META, DemoNode, type DemoStatus } from '../DemoNode';
import { FOCUS_RING } from '../constants';

type DemoAction = 'none' | 'warroom' | 'quiz' | 'retest';

const CAPTIONS: Record<DemoAction, { lead: string; body: string }> = {
  none: {
    lead: 'Nothing proven yet.',
    body: "Every concept starts here. Seeing it in a lecture doesn't move it — only evidence does.",
  },
  warroom: {
    lead: 'Engaged.',
    body: 'Five AI minds argued it out with you. Real work happened, but nothing has been proven yet.',
  },
  quiz: {
    lead: 'Proven.',
    body: 'You passed a quiz on it. This is the only door to green — there is no other way in.',
  },
  retest: {
    lead: 'Back to amber.',
    body: "Green isn't permanent. Fail a retest and the node drops back until you earn it again.",
  },
};

const STATUS_ORDER: DemoStatus[] = ['red', 'amber', 'green'];

/**
 * Step 02 — the single most important screen. A demo node the student
 * actually drives through red -> amber -> green, with an honest look at the
 * one way mastery can regress: a failed retest.
 *
 * Deliberately laid out as node-on-the-left / rule-on-the-right at >=640px so
 * the colour change and the sentence explaining it land in the same glance.
 */
export function MasteryRuleStep() {
  const [status, setStatus] = useState<DemoStatus>('red');
  const [action, setAction] = useState<DemoAction>('none');
  const [pulse, setPulse] = useState(0);

  const transition = useCallback((next: DemoStatus, act: DemoAction) => {
    setStatus(next);
    setAction(act);
    setPulse((p) => p + 1);
  }, []);

  const caption = CAPTIONS[action];
  const meta = DEMO_STATUS_META[status];

  return (
    <div className="flex flex-col gap-7">
      <header>
        <span className="ob-eyebrow">The one rule</span>
        <h2 className="ob-display ob-h2 mt-3">Green is earned, never given.</h2>
        <p className="ob-lede mt-4">
          A node&apos;s colour is <em style={{ color: 'var(--text-primary)', fontStyle: 'normal', fontWeight: 600 }}>evidence</em>,
          never exposure. Drive this one yourself.
        </p>
        <p className="ob-body mt-3" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>
          Your graph starts entirely red. Nothing is green until you prove it.
        </p>
      </header>

      <div className="grid items-center gap-7 sm:grid-cols-[176px_1fr]">
        {/* The living node + its identity chip. */}
        <div className="flex flex-col items-center gap-3">
          <DemoNode status={status} pulseKey={pulse} size={176} />
          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Chain Rule
            </span>
            <span className="ob-micro" style={{ letterSpacing: '0.14em', textTransform: 'uppercase', fontSize: 10 }}>
              Calculus
            </span>
          </div>
        </div>

        {/* The three states, with the live one lit. */}
        <ul className="flex flex-col gap-1" aria-label="Mastery states">
          {STATUS_ORDER.map((s) => {
            const m = DEMO_STATUS_META[s];
            const active = status === s;
            return (
              <li key={s} className="ob-stage" data-active={active}>
                <span
                  aria-hidden
                  className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full"
                  style={{ background: m.color, boxShadow: active ? `0 0 12px ${m.glow}` : 'none' }}
                />
                <span className="min-w-0">
                  <span className="ob-stage-term block">{m.term}</span>
                  <span className="ob-stage-gloss block">{m.gloss}</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>

      {/* Live commentary — fixed min-height so the layout never jumps. */}
      <div style={{ minHeight: 66 }} aria-live="polite">
        <AnimatePresence mode="wait">
          <motion.p
            key={action}
            initial={{ opacity: 0, y: 5 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -5 }}
            transition={{ duration: 0.2 }}
            className="ob-body"
          >
            <span className="font-semibold" style={{ color: meta.color }}>
              {caption.lead}{' '}
            </span>
            {caption.body}
          </motion.p>
        </AnimatePresence>
      </div>

      <div className="flex flex-col gap-3">
        <span className="ob-eyebrow ob-eyebrow-quiet">Try it</span>
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            disabled={status !== 'red'}
            data-live={status === 'red'}
            onClick={() => transition('amber', 'warroom')}
            className={`ob-demo-btn ${FOCUS_RING}`}
          >
            Open War Room
          </button>
          <button
            type="button"
            disabled={status !== 'amber'}
            data-live={status === 'amber'}
            onClick={() => transition('green', 'quiz')}
            className={`ob-demo-btn ${FOCUS_RING}`}
          >
            Pass a quiz
          </button>
          {status === 'green' && (
            <button
              type="button"
              onClick={() => transition('amber', 'retest')}
              className={`ob-quiet rounded-md px-2 py-2 underline-offset-4 hover:underline ${FOCUS_RING}`}
            >
              Fail a retest
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
