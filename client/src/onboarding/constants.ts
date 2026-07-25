/** Shared visual/interaction constants for the onboarding flow. */

/** Accessible focus ring, since index.css doesn't define a default one. */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-deep)]';

/** The subjects step's chip options — "Other" is handled separately as free text. */
export const SUBJECT_OPTIONS = [
  'Calculus',
  'Physics',
  'Chemistry',
  'Biology',
  'Computer Science',
  'Economics',
  'History',
  'English',
] as const;

/** The demo graph is seeded with these — pre-select them and say so honestly. */
export const DEFAULT_SUBJECTS: string[] = ['Calculus', 'Physics'];

/** Example goals shown as clickable chips on the goal step. */
export const GOAL_EXAMPLES = [
  'Ace the Physics mock in 3 weeks',
  'Survive calc finals',
  'Actually understand derivatives',
] as const;
