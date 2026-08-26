/**
 * The complete data model (spec section 3).
 *
 * Two rules run through all of it:
 *  - Nothing is ever hard-deleted. `deletedAt` is a tombstone, so a delete on
 *    one device can propagate to another instead of the record silently
 *    reappearing on the next sync.
 *  - `updatedAt` is the sync tiebreaker. Every write must bump it.
 */
export interface Base {
  id: string;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
}

/** Flat. One level. No workstreams, no sub-projects. (spec 3.1) */
export interface Project extends Base {
  name: string;
  color?: string;
  archived: boolean;
}

/**
 * No priority field, by design. `energy` and `date` carry the load.
 * `date` is ONLY for real obligations — an undated todo waits patiently
 * forever and is never "overdue".
 */
export type Energy = 'quick' | 'moderate' | 'focus';

export interface Todo extends Base {
  title: string;
  notes?: string;
  projectId?: string;
  energy?: Energy;
  date?: string; // YYYY-MM-DD
  completedAt?: string;
}

/** A thought with no action attached. Promoting keeps a backlink. (spec 3.3) */
export interface Idea extends Base {
  text: string;
  projectId?: string;
  promotedToTodoId?: string;
}

export interface BuyItem extends Base {
  name: string;
  url?: string;
  priceCents?: number;
  currency?: string;
  projectId?: string;
  purchasedAt?: string;
}

export interface List extends Base {
  name: string;
  icon?: string;
}

/**
 * Structurally separate from Todo and never shown on Today. A book you want to
 * read is a want, not a task — surfacing it as a task turns it into a debt.
 */
export type ListItemState = 'want' | 'doing' | 'done';

export interface ListItem extends Base {
  listId: string;
  text: string;
  url?: string;
  state: ListItemState;
}

/**
 * Three states, never inferred. Moving a habit to dormant is always an explicit
 * user choice — the app does not decide you've abandoned something.
 */
export type HabitState = 'active' | 'dormant' | 'retired';

export interface Habit extends Base {
  name: string;
  state: HabitState;
  stateChangedAt: string;
}

/** Append-only. Survives every state change, forever. */
export interface HabitLog extends Base {
  habitId: string;
  date: string; // YYYY-MM-DD
}

/**
 * The unlock mechanic (spec 5.3) lives here. `slots.length` may never exceed
 * `unlockedCount`, which starts at 3 and only ever grows one at a time, after
 * the day has already been marked closed.
 */
export interface Day extends Base {
  date: string; // YYYY-MM-DD
  slots: string[];
  unlockedCount: number;
  closedAt?: string;
}

/**
 * Anything typed into the capture box before it's been sorted. Living in the
 * inbox is a valid resting state, not a backlog to clear.
 */
export interface Capture extends Base {
  text: string;
  sortedAt?: string;
}

/**
 * Project notes are plain markdown, one per project, and sync to Drive as real
 * .md files. Kept as a row here only so it works offline; the Drive copy is the
 * readable artifact. If this app is abandoned, the notes are not trapped in it.
 */
export interface Note extends Base {
  projectId: string;
  markdown: string;
}

/** Quiet insurance for the rare sync overwrite (spec 8.3). Surfaced in Settings. */
export interface ConflictLog extends Base {
  table: string;
  recordId: string;
  overwrittenJson: string;
}

/** Single-row app config. Secrets stay in IndexedDB, never in the repo. */
export interface Settings {
  id: 'settings';
  geminiApiKey?: string;
  googleRefreshToken?: string;
  lastSyncAt?: string;
  lastMonthlySummaryShown?: string; // YYYY-MM
  updatedAt: string;
}
