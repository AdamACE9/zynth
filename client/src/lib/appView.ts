import { useCallback, useEffect, useState } from 'react';
import { listWorkspaces } from './api';

/**
 * Which top-level surface is showing. Zynth requires NO LOGIN — this is the
 * whole navigation model:
 *
 *   loading    → briefly, while we ask the server whether a workspace exists
 *   landing    → the public marketing site (client/src/site/Landing.tsx)
 *   onboarding → setup — either the full first-run tour, or (in
 *                'newWorkspace' mode) just the subjects/level/goal/build
 *                steps for adding another graph
 *   graph      → the app itself (the 3D knowledge graph + its rooms)
 *
 * The source of truth for "has this student already got a graph?" is the
 * SERVER's workspace list, not localStorage — a stale/cleared/incognito
 * localStorage must never re-run onboarding for someone who already has a
 * real workspace, and a localStorage flag left over from a wiped database
 * must never skip onboarding for someone who actually has nothing yet.
 */
export type AppView = 'loading' | 'landing' | 'onboarding' | 'graph';

/** Full first-run tour vs. just enough steps to spin up one more graph. */
export type OnboardingMode = 'full' | 'newWorkspace';

const ONBOARDED_KEY = 'zynth.onboarded.v1';
const PREFS_KEY = 'zynth.prefs.v1';
const DRAFT_KEY = 'zynth.onboarding.draft.v1';

export interface OnboardingPrefs {
  /** Display name the student gave (optional — no account, purely local). */
  name?: string;
  /** Subjects they said they're studying. */
  subjects?: string[];
  /** Study level — GCSE/A-Level/IB/etc. (see onboarding/constants.ts#LEVEL_OPTIONS). */
  level?: string;
  /** Free-text goal, e.g. "ace the Physics mock in 3 weeks". */
  goal?: string;
  /** Timeframe as a week count, if that's how they expressed it. */
  timeframe_weeks?: number;
  /** Timeframe as an ISO date, if that's how they expressed it instead. */
  timeframe_date?: string;
  completed_at?: string;
}

/**
 * In-progress onboarding answers, persisted continuously so a refresh
 * mid-flow resumes exactly where the student left off instead of losing
 * everything and restarting the tour from step one.
 */
export interface OnboardingDraft {
  mode: OnboardingMode;
  stepIndex: number;
  name: string;
  subjects: string[];
  otherSubject: string;
  level: string;
  goal: string;
  timeframeWeeks: number | null;
  timeframeDate: string;
}

function readOnboarded(): boolean {
  try {
    return localStorage.getItem(ONBOARDED_KEY) === '1';
  } catch {
    return false;
  }
}

export function readPrefs(): OnboardingPrefs {
  try {
    const raw = localStorage.getItem(PREFS_KEY);
    return raw ? (JSON.parse(raw) as OnboardingPrefs) : {};
  } catch {
    return {};
  }
}

export function readDraft(): OnboardingDraft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<OnboardingDraft>;
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      mode: parsed.mode === 'newWorkspace' ? 'newWorkspace' : 'full',
      stepIndex: typeof parsed.stepIndex === 'number' ? parsed.stepIndex : 0,
      name: parsed.name ?? '',
      subjects: Array.isArray(parsed.subjects) ? parsed.subjects : [],
      otherSubject: parsed.otherSubject ?? '',
      level: parsed.level ?? '',
      goal: parsed.goal ?? '',
      timeframeWeeks: typeof parsed.timeframeWeeks === 'number' ? parsed.timeframeWeeks : null,
      timeframeDate: parsed.timeframeDate ?? '',
    };
  } catch {
    return null;
  }
}

export function writeDraft(draft: OnboardingDraft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
  } catch {
    /* private mode / storage disabled — the draft just won't survive a refresh */
  }
}

export function clearDraft(): void {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* nothing to clean up */
  }
}

export interface AppViewState {
  view: AppView;
  prefs: OnboardingPrefs;
  hasOnboarded: boolean;
  onboardingMode: OnboardingMode;
  /** From the landing site's CTA — goes to onboarding, or straight to the graph if already done. */
  enterApp: () => void;
  /** Force the FULL onboarding tour, e.g. "replay the tour" from the landing page. */
  startOnboarding: () => void;
  /** Enter onboarding in 'newWorkspace' mode — just subjects/level/goal/build, for the "+" tab. */
  startNewWorkspace: () => void;
  /** Finish onboarding with the collected prefs and drop into the graph. */
  completeOnboarding: (prefs: OnboardingPrefs) => void;
  /** Skip setup entirely — straight to the graph, still marked onboarded. */
  skipOnboarding: () => void;
  /** Abandon an in-progress 'newWorkspace' flow — back to the graph, nothing created. */
  cancelNewWorkspace: () => void;
  /** Back to the public site. */
  goLanding: () => void;
}

/**
 * Top-level view state. On mount this asks the SERVER whether any workspace
 * already exists (GET /api/workspaces) and routes accordingly — a workspace
 * means a refresh always lands straight on the graph, never back through
 * onboarding; no workspace means a fresh install, which sees onboarding (or
 * a resumed draft of it) or the landing page. localStorage is only used for
 * an optimistic first paint and as an offline fallback if the server can't
 * be reached at all — it is never trusted over the server once that answer
 * comes back.
 */
export function useAppView(): AppViewState {
  const [hasOnboarded, setHasOnboarded] = useState<boolean>(() => readOnboarded());
  const [prefs, setPrefs] = useState<OnboardingPrefs>(() => readPrefs());
  const [onboardingMode, setOnboardingMode] = useState<OnboardingMode>('full');

  const [view, setView] = useState<AppView>(() => {
    // Deep-link support: /#/app and /#/onboarding jump straight in (handy for
    // the demo video and for judges who don't want to click through the site).
    const hash = window.location.hash;
    if (hash === '#/app') return 'graph';
    if (hash === '#/onboarding') return 'onboarding';
    if (readOnboarded()) return 'graph';
    if (readDraft()) return 'onboarding';
    return 'landing';
  });

  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#/app' || hash === '#/onboarding') return; // deep link wins, skip the server check

    const draft = readDraft();
    if (draft) setOnboardingMode(draft.mode);

    let cancelled = false;
    listWorkspaces()
      .then((workspaces) => {
        if (cancelled) return;
        if (workspaces.length > 0) {
          setHasOnboarded(true);
          try {
            localStorage.setItem(ONBOARDED_KEY, '1');
          } catch {
            /* private mode / storage disabled */
          }
          setView('graph');
        } else {
          // Genuinely nothing on the server yet — a stale "onboarded" flag from
          // a wiped database must not skip real setup.
          setHasOnboarded(false);
          setView(draft ? 'onboarding' : 'landing');
        }
      })
      .catch((err) => {
        if (cancelled) return;
        // Server unreachable — fall back to whatever localStorage believes so
        // the app is still usable offline, rather than stranding the student.
        console.warn('[Zynth] could not verify workspaces with the server, using local state:', err);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persistOnboarded = useCallback((next: OnboardingPrefs) => {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...next, completed_at: new Date().toISOString() }));
    } catch {
      /* private mode / storage disabled — state still lives in memory this session */
    }
    clearDraft();
  }, []);

  const enterApp = useCallback(() => {
    setOnboardingMode('full');
    setView(readOnboarded() ? 'graph' : 'onboarding');
  }, []);

  const startOnboarding = useCallback(() => {
    setOnboardingMode('full');
    setView('onboarding');
  }, []);

  const startNewWorkspace = useCallback(() => {
    clearDraft();
    setOnboardingMode('newWorkspace');
    setView('onboarding');
  }, []);

  const completeOnboarding = useCallback(
    (next: OnboardingPrefs) => {
      setPrefs(next);
      setHasOnboarded(true);
      persistOnboarded(next);
      setOnboardingMode('full');
      setView('graph');
    },
    [persistOnboarded],
  );

  const skipOnboarding = useCallback(() => {
    setHasOnboarded(true);
    persistOnboarded(prefs);
    setOnboardingMode('full');
    setView('graph');
  }, [persistOnboarded, prefs]);

  const cancelNewWorkspace = useCallback(() => {
    clearDraft();
    setOnboardingMode('full');
    setView('graph');
  }, []);

  const goLanding = useCallback(() => setView('landing'), []);

  return {
    view,
    prefs,
    hasOnboarded,
    onboardingMode,
    enterApp,
    startOnboarding,
    startNewWorkspace,
    completeOnboarding,
    skipOnboarding,
    cancelNewWorkspace,
    goLanding,
  };
}
