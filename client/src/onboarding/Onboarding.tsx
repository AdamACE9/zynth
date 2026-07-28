import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'motion/react';
import type { OnboardingDraft, OnboardingMode, OnboardingPrefs } from '../lib/appView';
import { clearDraft, readDraft, writeDraft } from '../lib/appView';
import { activateWorkspace, createWorkspace, type Workspace, type WorkspaceDepth } from '../lib/api';
import './onboarding.css';
import { FOCUS_RING, MAX_SUBJECTS, SUBJECT_GROUPS } from './constants';
import { WelcomeStep } from './steps/WelcomeStep';
import { MasteryRuleStep } from './steps/MasteryRuleStep';
import { SubjectsStep } from './steps/SubjectsStep';
import { LevelStep } from './steps/LevelStep';
import { GoalStep } from './steps/GoalStep';
import { BuildStep, type BuildPhase } from './steps/BuildStep';

export interface OnboardingProps {
  /** Full first-run tour, or just enough to spin up one more graph. */
  mode: OnboardingMode;
  /** Carried over so a returning student adding a workspace doesn't have to re-type their name. */
  namePrefill?: string;
  /** Finish setup: the workspace is already created + activated by the time this fires. */
  onComplete: (prefs: OnboardingPrefs, workspace: Workspace | null) => void;
  /** Skip/abandon the whole flow — back to whatever's already there. */
  onSkip: () => void;
  /** Back out of the very first step. In 'full' mode: the public site. In 'newWorkspace' mode: same as onSkip. */
  onBackToSite: () => void;
}

type StepId = 'welcome' | 'subjects' | 'level' | 'goal' | 'mastery' | 'build';

const FULL_STEPS: { id: StepId; n: string; title: string }[] = [
  { id: 'welcome', n: '01', title: 'Welcome' },
  { id: 'subjects', n: '02', title: 'Your subjects' },
  { id: 'level', n: '03', title: 'Your level' },
  { id: 'goal', n: '04', title: 'Your goal' },
  { id: 'mastery', n: '05', title: 'The mastery rule' },
  { id: 'build', n: '06', title: 'Building' },
];

const NEW_WORKSPACE_STEPS: { id: StepId; n: string; title: string }[] = [
  { id: 'subjects', n: '01', title: 'Subjects' },
  { id: 'level', n: '02', title: 'Level' },
  { id: 'goal', n: '03', title: 'Goal' },
  { id: 'build', n: '04', title: 'Building' },
];

/** Roughly how long the simulated per-subject "mapping" pace runs — the real
 * call almost never lines up exactly, so the moment it settles we jump
 * straight to the true result rather than waiting out the clock. */
const BUILD_STEP_MS = 2400;

function deriveWorkspaceName(subjects: string[]): string {
  if (subjects.length === 0) return 'My Graph';
  if (subjects.length <= 2) return subjects.join(' & ');
  return `${subjects.slice(0, 2).join(', ')} +${subjects.length - 2}`;
}

/**
 * The backend's `depth` control only picks how MANY concepts get generated
 * per subject (light 5-7 / standard 8-14 / deep 15-20) — it has no separate
 * notion of academic level. Mapping study level onto it is the honest way to
 * make that question have a real effect on the graph: a University student
 * gets the fullest map, GCSE/IGCSE get just the essentials.
 */
function levelToDepth(level: string): WorkspaceDepth | undefined {
  switch (level) {
    case 'gcse':
    case 'igcse':
      return 'light';
    case 'a-level':
    case 'ib':
    case 'ap':
    case 'self-study':
      return 'standard';
    case 'university':
      return 'deep';
    default:
      return undefined;
  }
}

function composeGoal(goal: string, weeks: number | null, date: string): string | undefined {
  const trimmed = goal.trim();
  let suffix = '';
  if (weeks) {
    suffix = ` (in ${weeks} week${weeks === 1 ? '' : 's'})`;
  } else if (date) {
    const parsed = new Date(date);
    if (!Number.isNaN(parsed.getTime())) {
      suffix = ` (by ${parsed.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })})`;
    }
  }
  const combined = `${trimmed}${suffix}`.trim();
  return combined || undefined;
}

/**
 * Setup — either the full first-run product tour, or (mode='newWorkspace')
 * just the subjects/level/goal/build steps for adding another graph via the
 * WorkspaceTabs "+" control. No login, no accounts — everything here is
 * local state, persisted to localStorage as a draft on every change so a
 * refresh mid-flow resumes instead of restarting, and handed to the backend
 * exactly once at the end to build a REAL graph from what was picked.
 *
 * Layout is a two-column product tour at >=1024px (numbered narrative rail +
 * the step itself) and a single column with a slim numbered header below that.
 * The step column is the ONLY scroll container, so short viewports scroll the
 * content while the header and the Back/Next footer stay put.
 */
export function Onboarding({ mode, namePrefill, onComplete, onSkip, onBackToSite }: OnboardingProps) {
  const steps = mode === 'full' ? FULL_STEPS : NEW_WORKSPACE_STEPS;

  const initialDraft = useMemo(() => {
    const draft = readDraft();
    return draft && draft.mode === mode ? draft : null;
  }, [mode]);

  const [stepIndex, setStepIndex] = useState(() => {
    const idx = initialDraft?.stepIndex ?? 0;
    return idx >= 0 && idx < steps.length ? idx : 0;
  });
  /** Furthest step reached — earlier steps stay clickable in the rail. */
  const [furthest, setFurthest] = useState(stepIndex);
  const [direction, setDirection] = useState(1);
  const [name, setName] = useState(initialDraft?.name ?? namePrefill ?? '');
  const [subjects, setSubjects] = useState<string[]>(initialDraft?.subjects ?? []);
  const [otherSubject, setOtherSubject] = useState(initialDraft?.otherSubject ?? '');
  const [level, setLevel] = useState(initialDraft?.level ?? '');
  const [goal, setGoal] = useState(initialDraft?.goal ?? '');
  const [timeframeWeeks, setTimeframeWeeks] = useState<number | null>(initialDraft?.timeframeWeeks ?? null);
  const [timeframeDate, setTimeframeDate] = useState(initialDraft?.timeframeDate ?? '');

  const [buildPhase, setBuildPhase] = useState<BuildPhase>('building');
  const [buildActiveIndex, setBuildActiveIndex] = useState(0);
  const [buildError, setBuildError] = useState<string | null>(null);
  const [builtWorkspace, setBuiltWorkspace] = useState<Workspace | null>(null);
  /** Wall-clock time the real build took, for the build log's closing line —
   * genuine telemetry rather than an invented number, in keeping with "colour
   * is evidence." */
  const [buildElapsedMs, setBuildElapsedMs] = useState<number | null>(null);
  const buildStartedRef = useRef(false);
  const buildTimerRef = useRef<number | null>(null);
  const buildStartedAtRef = useRef(0);
  const shouldReduceMotion = useReducedMotion();

  // Always safe: stepIndex is clamped to [0, steps.length - 1] everywhere below.
  const step = steps[stepIndex]!;
  const isFirst = stepIndex === 0;
  const isLast = stepIndex === steps.length - 1;
  const onBuildStep = step.id === 'build';

  const allSubjects = useMemo(() => {
    const other = otherSubject.trim();
    const combined = other ? [...subjects, other] : [...subjects];
    return Array.from(new Set(combined)).slice(0, MAX_SUBJECTS);
  }, [subjects, otherSubject]);

  // Persist a draft continuously — a refresh mid-flow resumes exactly here
  // instead of losing every answer and restarting the tour from step one.
  useEffect(() => {
    if (buildPhase === 'done') return; // finished — completeOnboarding already clears the draft
    const draft: OnboardingDraft = {
      mode,
      stepIndex,
      name,
      subjects,
      otherSubject,
      level,
      goal,
      timeframeWeeks,
      timeframeDate,
    };
    writeDraft(draft);
  }, [mode, stepIndex, name, subjects, otherSubject, level, goal, timeframeWeeks, timeframeDate, buildPhase]);

  const toggleSubject = useCallback((subject: string) => {
    setSubjects((prev) => {
      if (prev.includes(subject)) return prev.filter((s) => s !== subject);
      if (prev.length >= MAX_SUBJECTS) return prev;
      return [...prev, subject];
    });
  }, []);

  const buildPrefs = useCallback(
    (): OnboardingPrefs => ({
      name: name.trim() || undefined,
      subjects: allSubjects.length ? allSubjects : undefined,
      level: level || undefined,
      goal: goal.trim() || undefined,
      timeframe_weeks: timeframeWeeks ?? undefined,
      timeframe_date: timeframeDate || undefined,
    }),
    [name, allSubjects, level, goal, timeframeWeeks, timeframeDate],
  );

  const workspaceName = useMemo(() => deriveWorkspaceName(allSubjects), [allSubjects]);

  // Kicks off the real build the moment the build step is reached. Guarded so
  // it only ever runs once per mount (re-entering the step after a retry goes
  // through `runBuild` directly, not this effect).
  const runBuild = useCallback(() => {
    setBuildPhase('building');
    setBuildError(null);
    setBuildActiveIndex(0);
    setBuildElapsedMs(null);
    buildStartedAtRef.current = performance.now();

    if (buildTimerRef.current) window.clearInterval(buildTimerRef.current);
    const subjectCount = allSubjects.length;
    if (subjectCount > 1) {
      buildTimerRef.current = window.setInterval(() => {
        setBuildActiveIndex((i) => Math.min(i + 1, subjectCount - 1));
      }, BUILD_STEP_MS);
    }

    let cancelled = false;
    (async () => {
      try {
        const ws = await createWorkspace({
          name: workspaceName,
          subjects: allSubjects,
          goal: composeGoal(goal, timeframeWeeks, timeframeDate),
          depth: levelToDepth(level),
        });
        try {
          // Required: POST /api/workspaces creates the row but does NOT make
          // it active (server/src/config.ts#getActiveStudentId is untouched
          // by creation) — without this, GET /api/graph would keep serving
          // whatever was active before, and the student would never see the
          // graph they just built. Treated as non-fatal below purely so a
          // flaky activate call doesn't strand an otherwise-successful
          // creation — the workspace still exists and can be activated from
          // the tab strip.
          await activateWorkspace(ws.id);
        } catch (activateErr) {
          console.warn('[Zynth] activate after create failed — workspace exists but is not yet active:', activateErr);
        }
        if (cancelled) return;
        if (buildTimerRef.current) window.clearInterval(buildTimerRef.current);
        setBuildActiveIndex(subjectCount);
        setBuiltWorkspace(ws);
        setBuildElapsedMs(performance.now() - buildStartedAtRef.current);
        setBuildPhase('done');
      } catch (err) {
        if (cancelled) return;
        if (buildTimerRef.current) window.clearInterval(buildTimerRef.current);
        console.warn('[Zynth] workspace build failed:', err);
        setBuildError(err instanceof Error ? err.message : 'Something went wrong reaching the server.');
        setBuildPhase('error');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allSubjects, workspaceName, goal, timeframeWeeks, timeframeDate, level]);

  useEffect(() => {
    if (!onBuildStep || buildStartedRef.current) return;
    buildStartedRef.current = true;
    const cleanup = runBuild();
    return cleanup;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onBuildStep]);

  useEffect(
    () => () => {
      if (buildTimerRef.current) window.clearInterval(buildTimerRef.current);
    },
    [],
  );

  const finish = useCallback(() => {
    clearDraft();
    onComplete(buildPrefs(), builtWorkspace);
  }, [onComplete, buildPrefs, builtWorkspace]);

  const goNext = useCallback(() => {
    if (onBuildStep) {
      if (buildPhase === 'done') finish();
      else if (buildPhase === 'error') runBuild();
      return; // 'building' — no-op, nothing to advance to yet
    }
    if (isLast) {
      finish();
      return;
    }
    const next = Math.min(stepIndex + 1, steps.length - 1);
    setDirection(1);
    setStepIndex(next);
    setFurthest((f) => Math.max(f, next));
  }, [onBuildStep, buildPhase, finish, runBuild, isLast, stepIndex, steps.length]);

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

  const nextLabel = onBuildStep
    ? buildPhase === 'building'
      ? 'Building…'
      : buildPhase === 'error'
        ? 'Retry'
        : 'Enter my graph'
    : isLast
      ? 'Enter my graph'
      : 'Continue';
  const nextDisabled = onBuildStep && buildPhase === 'building';

  // The last step's zero-padded label ("06", "04") doubles as the total for
  // the mono "01 / 06" progress readout — no separate padding logic needed.
  const totalN = steps[steps.length - 1]?.n ?? String(steps.length).padStart(2, '0');
  const progressPct = ((stepIndex + 1) / steps.length) * 100;

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
              {mode === 'full' ? 'Setup takes about a minute. Nothing leaves this device.' : 'A new graph, same rules.'}
            </p>
          </div>

          {/* Precise sense of place: a mono count plus one hairline that fills —
              never a chunky bar. The step list below is the menu; this is the ruler. */}
          <div
            className="mt-7 shrink-0"
            role="progressbar"
            aria-valuenow={stepIndex + 1}
            aria-valuemin={1}
            aria-valuemax={steps.length}
            aria-label={`Setup progress: ${step.title}`}
          >
            <span className="ob-mono">
              {step.n} / {totalN}
            </span>
            <div className="ob-progress-rule mt-2.5">
              <span style={{ width: `${progressPct}%` }} />
            </div>
          </div>

          <nav className="mt-6 flex flex-1 flex-col gap-0.5" aria-label="Setup steps">
            {steps.map((s, i) => {
              const locked = onBuildStep && buildPhase === 'building';
              const reachable = i <= furthest && !locked;
              const state = i === stepIndex ? 'active' : i <= furthest ? 'done' : 'todo';
              return (
                <button
                  key={s.id}
                  type="button"
                  data-state={state}
                  disabled={!reachable || i === stepIndex}
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
              <span className="truncate text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
                {step.title}
              </span>
              {skipButton('shrink-0')}
            </div>
            <div
              className="ob-progress-head mt-3"
              role="progressbar"
              aria-valuenow={stepIndex + 1}
              aria-valuemin={1}
              aria-valuemax={steps.length}
              aria-label={`Setup progress: ${step.title}`}
            >
              <span className="ob-mono">
                {step.n} / {totalN}
              </span>
            </div>
            <div className="ob-progress-rule mt-2">
              <span style={{ width: `${progressPct}%` }} />
            </div>
          </header>

          <span className="sr-only" aria-live="polite">
            {`Step ${stepIndex + 1} of ${steps.length}: ${step.title}`}
          </span>

          <div className="ob-pad min-h-0 flex-1 overflow-y-auto">
            {/* Deliberately NOT wrapped in <AnimatePresence mode="wait">: the exit
                animation could stall, leaving the outgoing step mounted forever so
                the flow silently refused to advance (header moved to step 2 while
                the body still showed step 1). Re-keying on step.id remounts the
                panel and plays an enter-only transition — nothing to get stuck on.
                Travel distance (24px) and duration (--t-base) match the reveal
                rule in index.css/site.css; direction-aware via `direction`, set
                wherever stepIndex changes. `initial={false}` under reduced motion
                means the panel is simply present at its resting state — no motion
                to reduce. */}
            <motion.div
              key={step.id}
              initial={shouldReduceMotion ? false : { opacity: 0, x: direction >= 0 ? 24 : -24 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: shouldReduceMotion ? 0 : 0.32, ease: [0.22, 1, 0.36, 1] }}
            >
              {step.id === 'welcome' && <WelcomeStep name={name} onNameChange={setName} />}
              {step.id === 'subjects' && (
                <SubjectsStep
                  groups={SUBJECT_GROUPS}
                  selected={subjects}
                  onToggle={toggleSubject}
                  otherText={otherSubject}
                  onOtherTextChange={setOtherSubject}
                />
              )}
              {step.id === 'level' && <LevelStep level={level} onLevelChange={setLevel} />}
              {step.id === 'goal' && (
                <GoalStep
                  goal={goal}
                  onGoalChange={setGoal}
                  timeframeWeeks={timeframeWeeks}
                  onTimeframeWeeksChange={setTimeframeWeeks}
                  timeframeDate={timeframeDate}
                  onTimeframeDateChange={setTimeframeDate}
                />
              )}
              {step.id === 'mastery' && <MasteryRuleStep />}
              {step.id === 'build' && (
                <BuildStep
                  mode={mode}
                  phase={buildPhase}
                  subjects={allSubjects}
                  activeIndex={buildActiveIndex}
                  error={buildError}
                  workspaceName={workspaceName}
                  name={name.trim()}
                  elapsedMs={buildElapsedMs}
                />
              )}
            </motion.div>
          </div>

          <footer className="ob-foot flex shrink-0 items-center justify-between gap-3">
            <button
              type="button"
              onClick={goBack}
              disabled={onBuildStep && buildPhase === 'building'}
              className={`ob-ghost ${FOCUS_RING} disabled:opacity-40`}
            >
              {isFirst ? (mode === 'full' ? 'Back to site' : 'Cancel') : 'Back'}
            </button>
            <button type="button" onClick={goNext} disabled={nextDisabled} className={`ob-cta ${FOCUS_RING} disabled:opacity-60`}>
              {nextLabel}
              <span aria-hidden style={{ fontSize: 15, opacity: 0.7 }}>
                {onBuildStep ? (buildPhase === 'done' ? '→' : buildPhase === 'error' ? '↻' : '') : isLast ? '→' : '↵'}
              </span>
            </button>
          </footer>
        </section>
      </div>
    </div>
  );
}

export default Onboarding;
