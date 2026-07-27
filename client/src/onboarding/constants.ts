/** Shared visual/interaction constants for the onboarding flow. */

/** Accessible focus ring, since index.css doesn't define a default one. */
export const FOCUS_RING =
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-cyan)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--bg-deep)]';

export interface SubjectGroup {
  label: string;
  subjects: readonly string[];
}

/**
 * The real subject library — ~24 options across the subjects Zynth can
 * actually map a syllabus for. Grouped purely for scanability in the UI;
 * `SUBJECT_OPTIONS` below is the flattened form for anything that just wants
 * a flat list. "Other" is handled separately in SubjectsStep as free text.
 */
export const SUBJECT_GROUPS: readonly SubjectGroup[] = [
  { label: 'Maths', subjects: ['Calculus', 'Algebra', 'Statistics', 'Geometry', 'Trigonometry'] },
  { label: 'Sciences', subjects: ['Physics', 'Chemistry', 'Biology'] },
  { label: 'Computer Science', subjects: ['Computer Science', 'Data Structures'] },
  { label: 'Humanities', subjects: ['History', 'Geography', 'Economics', 'Psychology', 'Philosophy'] },
  { label: 'Languages', subjects: ['English Literature', 'English Language', 'Spanish', 'French', 'Arabic'] },
  { label: 'Other', subjects: ['Business', 'Accounting', 'Art', 'Music'] },
] as const;

export const SUBJECT_OPTIONS: readonly string[] = SUBJECT_GROUPS.flatMap((g) => g.subjects);

/** Hard cap — keeps the generated graph (and the Gemini call fan-out) sane. */
export const MAX_SUBJECTS = 13;

/** Nothing is pre-selected anymore — an empty start is honest; the graph it
 * produces should match exactly what the student picked, nothing more. */
export const DEFAULT_SUBJECTS: string[] = [];

/** Example goals shown as clickable chips on the goal step. */
export const GOAL_EXAMPLES = [
  'Ace the Physics mock in 3 weeks',
  'Survive calc finals',
  'Actually understand derivatives',
] as const;

/** Quick-pick week counts for the goal step's timeframe control. */
export const TIMEFRAME_WEEK_OPTIONS = [1, 2, 3, 4, 6, 8, 12] as const;

export interface LevelOption {
  id: string;
  label: string;
}

/**
 * Study level — genuinely changes what concepts get generated (an A-Level
 * Calculus graph and a University Calculus graph are different graphs), so
 * this earns its place as a real onboarding step.
 */
export const LEVEL_OPTIONS: readonly LevelOption[] = [
  { id: 'gcse', label: 'GCSE' },
  { id: 'igcse', label: 'IGCSE' },
  { id: 'a-level', label: 'A-Level' },
  { id: 'ib', label: 'IB' },
  { id: 'ap', label: 'AP' },
  { id: 'university', label: 'University' },
  { id: 'self-study', label: 'Self-study' },
] as const;
