import { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import type { OnboardingPrefs } from '../lib/appView';
import './onboarding.css';
import { DEFAULT_SUBJECTS, FOCUS_RING, SUBJECT_OPTIONS } from './constants';
import { WelcomeStep } from './steps/WelcomeStep';
import { MasteryRuleStep } from './steps/MasteryRuleStep';
import { SubjectsStep } from './steps/SubjectsStep';
import { GoalStep } from './steps/GoalStep';
import { DoneStep } from './steps/DoneStep';

export interface OnboardingProps {
  /** Finish setup with the collected prefs — drops the student into the graph. */
  onComplete: (prefs: OnboardingPrefs) => void;
  /** Skip the whole flow — straight to the graph. */
  onSkip: () => void;
  /** Back out to the public site. */
  onBackToSite: () => void;
}

type StepId = 'welcome' | 'mastery' | 'subjects' | 'goal' | 'done';

/** `n` is the narrative numeral shown in the rail — `[01] Welcome`, etc. */
const STEPS: { id: StepId; n: string; title: string }[] = [
  { id: 'welcome', n: '01', title: 'Welcome' },
  { id: 'mastery', n: '02', title: 'The mastery rule' },
  { id: 'subjects', n: '03', title: 'Your subjects' },
  { id: 'goal', n: '04', title: 'Your goal' },
  { id: 'done', n: '05', title: "You're set" },
];

/**
 * First-run experience between the marketing site and the graph. No login,
 * no accounts — everything here is local state handed to `onComplete` once,
 * then persisted by the caller (see lib/appView.ts). Every step is
 * skippable: the persistent "Skip setup" control and Escape both drop
 * straight into the graph via `onSkip`.
 *
 * Layout is a two-column product tour at >=1024px (numbered narrative rail +
 * the step itself) and a single column with a slim numbered header below that.
 * The step column is the ONLY scroll container, so short viewports scroll the
 * content while the header and the Back/Next footer stay put.
 */
export function Onboarding({ onComplete, onSkip, onBackToSite }: OnboardingProps) {
  const [stepIndex, setStepIndex] = useState(0);
  /** Furthest step reached — earlier steps stay clickable in the rail. */
  const [furthest, setFurthest] = useState(0);
  const [direction, setDirection] = useState(1);
  const [name, setName] = useState('');
  const [subjects, setSubjects] = useState<string[]>(DEFAULT_SUBJECTS);
  const [otherSubject, setOtherSubject] = useState('');
  const [goal, setGoal] = useState('');

  // Always safe: stepIndex is clamped to [0, STEPS.length - 1] everywhere below.
  const step = STEPS[stepIndex]!;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === STEPS.length - 1;

  const toggleSubject = useCallback((subject: string) => {
    setSubjects((prev) => (prev.includes(subject) ? prev.filter((s) => s !== subject) : [...prev, subject]));
  }, []);

  const buildPrefs = useCallback((): OnboardingPrefs => {
    const allSubjects = [...subjects];
    const other = otherSubject.trim();
    if (other) allSubjects.push(other);
    return {
      name: name.trim() || undefined,
      subjects: allSubjects.length ? allSubjects : undefined,
      goal: goal.trim() || undefined,
    };
  }, [name, subjects, otherSubject, goal]);

  const finish = useCallback(() => onComplete(buildPrefs()), [onComplete, buildPrefs]);

  const goNext = useCallback(() => {
    if (isLast) {
      finish();
      return;
    }
    const next = Math.min(stepIndex + 1, STEPS.length - 1);
    setDirection(1);
    setStepIndex(next);
    setFurthest((f) => Math.max(f, next));
  }, [isLast, finish, stepIndex]);

  const goBack = useCallback(() => {
    if (isFirst) {
      onBackToSite();
      return;
    }
    setDirection(-1);
    setStepIndex((i) => Math.max(i - 1, 0));
  }, [isFirst, onBackToSite]);

  // Enter advances (from inputs / plain focus — not from buttons/links, which
  // already handle their own Enter via native click). Escape always skips.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        onSkip();
        return;
      }
      if (event.key === 'Enter') {
        const target = event.target as HTMLElement | null;
        const tag = target?.tagName;
        if (tag === 'BUTTON' || tag === 'TEXTAREA' || tag === 'A') return;
        event.preventDefault();
        goNext();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [goNext, onSkip]);

  const skipButton = (extra: string) => (
    <button type="button" onClick={onSkip} className={`ob-quiet ${extra} ${FOCUS_RING} rounded-md px-1 py-0.5`}>
      Skip setup
    </button>
  );

  return (
    <div className="zynth-ob flex h-full w-full items-center justify-center p-3 sm:p-6">
      <div className="ob-shell">
        {/* ---- Narrative rail (>=1024px) -------------------------------- */}
        <aside className="ob-rail">
          <div className="shrink-0">
            <span className="text-wordmark" style={{ fontSize: 24 }}>
              Zynth
            </span>
            <p className="ob-micro mt-2.5" style={{ maxWidth: 200 }}>
              Setup takes about a minute. Nothing leaves this device.
            </p>
          </div>

          <nav className="mt-8 flex flex-1 flex-col gap-0.5" aria-label="Setup steps">
            {STEPS.map((s, i) => {
              const reachable = i <= furthest;
              const state = i === stepIndex ? 'active' : reachable ? 'done' : 'todo';
              return (
                <button
                  key={s.id}
                  type="button"
                  data-state={state}
                  disabled={!reachable}
                  aria-current={i === stepIndex ? 'step' : undefined}
                  onClick={() => {
                    if (!reachable || i === stepIndex) return;
                    setDirection(i > stepIndex ? 1 : -1);
                    setStepIndex(i);
                  }}
                  className={`ob-step ${FOCUS_RING}`}
                >
                  <span className="ob-step-n">{s.n}</span>
                  <span className="min-w-0 flex-1 truncate">{s.title}</span>
                </button>
              );
            })}
          </nav>

          <div className="mt-8 shrink-0">
            <hr className="ob-rule" />
            <div className="mt-4 flex items-center justify-between gap-2">
              <p className="ob-micro">
                <kbd className="font-semibold" style={{ color: 'var(--text-secondary)' }}>
                  Enter
                </kbd>{' '}
                to continue
              </p>
              {skipButton('')}
            </div>
          </div>
        </aside>

        {/* ---- Step column ---------------------------------------------- */}
        <section className="flex min-h-0 min-w-0 flex-col">
          {/* Compact numbered header — replaces the rail under 1024px. */}
          <header className="ob-head-m shrink-0 lg:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-baseline gap-2.5">
                <span className="ob-num">{step.n}</span>
                <span className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                  {step.title}
                </span>
              </div>
              {skipButton('shrink-0')}
            </div>
            <div
              className="mt-3 flex items-center gap-1.5"
              role="progressbar"
              aria-valuenow={stepIndex + 1}
              aria-valuemin={1}
              aria-valuemax={STEPS.length}
              aria-label={`Onboarding progress: ${step.title}`}
            >
              {STEPS.map((s, i) => (
                <span key={s.id} className="ob-tick" data-on={i <= stepIndex} />
              ))}
            </div>
          </header>

          <span className="sr-only" aria-live="polite">
            {`Step ${stepIndex + 1} of ${STEPS.length}: ${step.title}`}
          </span>

          <div className="ob-pad min-h-0 flex-1 overflow-y-auto">
            {/* Deliberately NOT wrapped in <AnimatePresence mode="wait">: the exit
                animation could stall, leaving the outgoing step mounted forever so
                the flow silently refused to advance (header moved to step 2 while
                the body still showed step 1). Re-keying on step.id remounts the
                panel and plays an enter-only transition — nothing to get stuck on. */}
            <motion.div
              key={step.id}
              initial={{ opacity: 0, x: direction >= 0 ? 18 : -18 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.26, ease: [0.22, 1, 0.36, 1] }}
            >
              {step.id === 'welcome' && <WelcomeStep name={name} onNameChange={setName} />}
              {step.id === 'mastery' && <MasteryRuleStep />}
              {step.id === 'subjects' && (
                <SubjectsStep
                  options={SUBJECT_OPTIONS}
                  selected={subjects}
                  onToggle={toggleSubject}
                  otherText={otherSubject}
                  onOtherTextChange={setOtherSubject}
                />
              )}
              {step.id === 'goal' && <GoalStep goal={goal} onGoalChange={setGoal} />}
              {step.id === 'done' && <DoneStep name={name.trim()} />}
            </motion.div>
          </div>

          <footer className="ob-foot flex shrink-0 items-center justify-between gap-3">
            <button type="button" onClick={goBack} className={`ob-ghost ${FOCUS_RING}`}>
              {isFirst ? 'Back to site' : 'Back'}
            </button>
            <button type="button" onClick={goNext} className={`ob-cta ${FOCUS_RING}`}>
              {isLast ? 'Enter my graph' : 'Continue'}
              <span aria-hidden style={{ fontSize: 15, opacity: 0.7 }}>
                {isLast ? '→' : '↵'}
              </span>
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
}

export default Onboarding;
