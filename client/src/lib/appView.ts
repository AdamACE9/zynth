import { useCallback, useEffect, useState } from 'react';

/**
 * Which top-level surface is showing. Zynth requires NO LOGIN — this is the
 * whole navigation model:
 *
 *   landing  → the public marketing site (client/src/site/Landing.tsx)
 *   onboarding → first-run setup (client/src/onboarding/Onboarding.tsx)
 *   graph    → the app itself (the 3D knowledge graph + its rooms)
 *
 * A returning visitor who already onboarded skips straight past onboarding
 * when they enter, so the demo never makes you sit through setup twice.
 */
export type AppView = 'landing' | 'onboarding' | 'graph';

const ONBOARDED_KEY = 'zynth.onboarded.v1';
const PREFS_KEY = 'zynth.prefs.v1';

export interface OnboardingPrefs {
  /** Display name the student gave (optional — no account, purely local). */
  name?: string;
  /** Subjects they said they're studying. */
  subjects?: string[];
  /** Free-text goal, e.g. "ace the Physics mock in 3 weeks". */
  goal?: string;
  completed_at?: string;
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

export interface AppViewState {
  view: AppView;
  prefs: OnboardingPrefs;
  hasOnboarded: boolean;
  /** From the landing site's CTA — goes to onboarding, or straight to the graph if already done. */
  enterApp: () => void;
  /** Force the onboarding flow even for a returning visitor ("replay the tour"). */
  startOnboarding: () => void;
  /** Finish onboarding with the collected prefs and drop into the graph. */
  completeOnboarding: (prefs: OnboardingPrefs) => void;
  /** Skip setup entirely — straight to the graph, still marked onboarded. */
  skipOnboarding: () => void;
  /** Back to the public site. */
  goLanding: () => void;
}

/**
 * Top-level view state, persisted to localStorage so a refresh doesn't dump a
 * returning user back onto the marketing page mid-demo.
 */
export function useAppView(): AppViewState {
  const [hasOnboarded, setHasOnboarded] = useState<boolean>(() => readOnboarded());
  const [prefs, setPrefs] = useState<OnboardingPrefs>(() => readPrefs());
  const [view, setView] = useState<AppView>('landing');

  // Deep-link support: /#/app jumps straight into the graph (handy for the demo
  // video and for judges who don't want to click through the site first).
  useEffect(() => {
    const hash = window.location.hash;
    if (hash === '#/app') setView('graph');
    else if (hash === '#/onboarding') setView('onboarding');
  }, []);

  const persistOnboarded = useCallback((next: OnboardingPrefs) => {
    try {
      localStorage.setItem(ONBOARDED_KEY, '1');
      localStorage.setItem(PREFS_KEY, JSON.stringify({ ...next, completed_at: new Date().toISOString() }));
    } catch {
      /* private mode / storage disabled — state still lives in memory this session */
    }
  }, []);

  const enterApp = useCallback(() => {
    setView(readOnboarded() ? 'graph' : 'onboarding');
  }, []);

  const startOnboarding = useCallback(() => setView('onboarding'), []);

  const completeOnboarding = useCallback(
    (next: OnboardingPrefs) => {
      setPrefs(next);
      setHasOnboarded(true);
      persistOnboarded(next);
      setView('graph');
    },
    [persistOnboarded],
  );

  const skipOnboarding = useCallback(() => {
    setHasOnboarded(true);
    persistOnboarded(prefs);
    setView('graph');
  }, [persistOnboarded, prefs]);

  const goLanding = useCallback(() => setView('landing'), []);

  return { view, prefs, hasOnboarded, enterApp, startOnboarding, completeOnboarding, skipOnboarding, goLanding };
}
