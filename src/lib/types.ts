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
  /** Cover photo, as a hard-resized data URL. See images.ts for the cap.
   *  Recognising a logo or a photo of the actual campervan is faster than
   *  reading a word, which is the whole point of the picture grid. */
  image?: string;
  /**
   * Named sections within the project — Creating / Mixing / Mastering for
   * Music, one per song or side-project for Coding.
   *
   * This is NOT a second level of hierarchy, and the difference matters. Tags
   * are a filter over one flat list, so the project still has exactly three
   * tabs and nothing is ever more than two taps deep. The old system's fatal
   * move was making each of these a page you had to navigate into; here the
   * whole set is visible as a row of chips and switching is one tap with no
   * navigation at all.
   *
   * Ordered, because the order is the user's, and stored on the project rather
   * than derived from the to-dos so a section can exist before it has anything
   * in it and does not vanish when it is emptied.
   */
  tags?: string[];
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
  /** One of the parent project's `tags`. One at a time, deliberately: a to-do
   *  that is in three sections at once is how a filter row stops being a
   *  glance and becomes a query builder. Nothing requires it. */
  tag?: string;
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
 * One entry per explicit state change, so the detail view can show a real cycle
 * history rather than just the current state.
 *
 * `Habit.stateChangedAt` only records when the CURRENT cycle began, which is
 * enough to say "dormant since March" but not "this is the fourth time you have
 * come back to it" — and that second framing is the entire point of showing
 * cycles instead of streaks. Only the app's own state changes are recorded;
 * nothing is ever inferred from a gap in logging (spec 3.6).
 */
export interface HabitStateChange extends Base {
  habitId: string;
  state: HabitState;
  at: string; // ISO
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

/**
 * A recording waiting to be transcribed (spec 7.2).
 *
 * Queued whenever the app is offline or Gemini fails. The spec is emphatic
 * about this: losing a brain-dump because there was no signal is the worst
 * possible failure for this app, so the bytes are written to IndexedDB before
 * anything is attempted over the network.
 */
export interface QueuedAudio extends Base {
  /** 16 kHz mono WAV, ready to send. Stored as a Blob — IndexedDB takes them
   *  natively, so there is no base64 inflation sitting on disk. */
  blob: Blob;
  durationMs: number;
  attempts: number;
  lastError?: string;
  processedAt?: string;
}

/**
 * A kept audio recording (a song idea, a riff, a melody hummed at a bus stop).
 *
 * Structurally separate from QueuedAudio, and the difference is the point:
 * QueuedAudio is a brain-dump on its way to becoming to-dos, and its bytes are
 * thrown away once it has been transcribed. A Memo IS the artifact. Nothing
 * consumes it, nothing converts it, and it is never deleted for being old.
 *
 * WHY THE METADATA. The voice-memo app this replaces records perfectly well
 * and then loses the recording, because an untitled file among two hundred
 * untitled files is not findable. Time, date and place are captured
 * automatically precisely so that nothing has to be typed at the moment of
 * recording — you can name it later, or never, and still find it by "August,
 * somewhere near Marseille".
 */
export interface Memo extends Base {
  /**
   * As the browser recorded it — opus in webm on Chrome and Android, aac in
   * mp4 on Safari. Deliberately NOT re-encoded the way Gemini audio is: this
   * is the master, and every re-encode is a generation of quality gone.
   *
   * Optional only because deleting a memo clears the bytes while keeping the
   * row. A tombstone has to survive to propagate, but keeping tens of
   * megabytes of audio the user explicitly deleted would be a strange reading
   * of "nothing is ever hard-deleted".
   */
  blob?: Blob;
  mime: string;
  durationMs: number;
  /** Local ISO time. The single most useful thing about a recording. */
  recordedAt: string;
  /** Optional, always. An untitled memo is findable by when and where. */
  title?: string;
  projectId?: string;
  /** A section of that project — in practice, which song it belongs to. */
  tag?: string;

  /**
   * Where it was recorded, if the device offered it in time. Never waited for:
   * the permission sheet can sit there for ten seconds and the recording has
   * to start immediately, so location is attached if it arrives and silently
   * skipped if it does not.
   */
  lat?: number;
  lng?: number;
  /** Human-readable, filled in later when there is a connection. */
  place?: string;

  /**
   * The audio's own file in Drive.
   *
   * The bytes never go into memos.json — an hour of recordings would make the
   * metadata file bigger than the entire rest of the database, and base64 adds
   * a third on top. They are uploaded as real audio files instead, so they can
   * be played and shared straight from Drive by someone who has never heard of
   * this app. Present on a memo means "the audio exists in Drive"; combined
   * with a missing `blob` it means "not on this device yet", which is a
   * different thing from gone.
   */
  driveFileId?: string;
}

/**
 * A block on a project page.
 *
 * These sit ABOVE the project's three tabs rather than becoming a fourth one.
 * The spec says a project has exactly three tabs and means it — depth is what
 * killed the last system — so the widgets are a header you arrange, and Notes /
 * To-dos / Buy stay exactly as they were.
 *
 * Deliberately absent from the kinds below: anything that renders as progress.
 * No percentage, no bar, no target. `counts` shows two plain numbers and
 * `activity` is a heatmap of what happened, neither measured against a goal.
 */
export type WidgetKind =
  | 'countdown' | 'note' | 'activity' | 'counts' | 'links' | 'image' | 'memos';

export interface WidgetLink {
  label: string;
  url: string;
}

export interface Widget extends Base {
  projectId: string;
  kind: WidgetKind;
  /** Shown as the block's small caps header. Optional. */
  title?: string;
  size: 'small' | 'wide';
  order: number;

  /** countdown */
  date?: string; // YYYY-MM-DD
  /** note — plain text pinned to the top of the project */
  text?: string;
  /** links */
  links?: WidgetLink[];
  /** image — a resized data URL. See widgets.ts for why it is capped. */
  image?: string;
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

  /**
   * Google gives a browser app a 1-hour access token and no refresh token —
   * the spec's original plan (PKCE, public client, store a refresh token) is
   * not something Google supports for a static site. So this is short-lived by
   * nature and is renewed by a full-page redirect; see google/auth.ts.
   */
  googleAccessToken?: string;
  googleTokenExpiresAt?: string;
  googleGrantedScopes?: string;
  /** Has the user ever completed consent? Gates silent renewal attempts. */
  googleConnected?: boolean;
  /** Backoff marker so a failing silent renewal can't loop. */
  lastSilentAuthAt?: string;
  /** Google's own error code from the last failed sign-in, shown in Settings.
   *  Worth surfacing verbatim: the useful ones are self-explanatory
   *  (redirect_uri_mismatch, access_denied) and guessing at them wastes time. */
  lastAuthError?: string;

  /** Drive ids, remembered to save a lookup. Rediscoverable if lost. */
  driveFolderId?: string;
  driveNotesFolderId?: string;
  driveFileIds?: Record<string, string>;

  lastSyncAt?: string;
  lastMonthlySummaryShown?: string; // YYYY-MM
  /** questionId -> ISO timestamp last shown, so nothing repeats within 7 days. */
  questionHistory?: Record<string, string>;
  updatedAt: string;
}

// -------------------------------------------------- the Free Time flow (5)

/** Always asked, though the wording varies. */
export type TimeBucket = '20min' | '1-2h' | 'half day' | 'all day';
export type BrainState = 'fried' | 'normal' | 'sharp';

/**
 * What the flow learned. `projectPullId` comes from the "what do you secretly
 * wish you were working on" question and drives the pull slot; undefined means
 * they skipped it or said nothing in particular.
 */
export interface FreeTimeAnswers {
  time: TimeBucket;
  brain: BrainState;
  projectPullId?: string;
}

export type SlotKind = 'pull' | 'neglected' | 'obligation';

export interface PlannedSlot {
  kind: SlotKind;
  todo: Todo;
  /** One line, shown under the title. Deterministic — no model involved. */
  reason: string;
}
