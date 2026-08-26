import Dexie, { type Table } from 'dexie';
import type {
  Project, Todo, Idea, BuyItem, List, ListItem,
  Habit, HabitLog, Day, Capture, Note, ConflictLog, Settings
} from './types';

/**
 * Dexie is a thin, typed wrapper over IndexedDB — the browser's own on-device
 * database. IndexedDB's raw API is callback soup; Dexie gives it promises and
 * queryable indexes. This is the single source of truth at runtime: every read
 * and every write in the app hits this and nothing else. Drive sync (phase 3)
 * reconciles into it in the background, but never sits in front of it.
 *
 * The strings in each `stores()` entry are INDEXES, not a column list — Dexie
 * stores the whole object regardless. `id` first means it's the primary key.
 * Only index what you actually query by; every index costs write time.
 */
export class FreeTimeDB extends Dexie {
  projects!: Table<Project, string>;
  todos!: Table<Todo, string>;
  ideas!: Table<Idea, string>;
  buyItems!: Table<BuyItem, string>;
  lists!: Table<List, string>;
  listItems!: Table<ListItem, string>;
  habits!: Table<Habit, string>;
  habitLogs!: Table<HabitLog, string>;
  days!: Table<Day, string>;
  captures!: Table<Capture, string>;
  notes!: Table<Note, string>;
  conflicts!: Table<ConflictLog, string>;
  settings!: Table<Settings, string>;

  constructor() {
    super('freetime');

    this.version(1).stores({
      projects: 'id, name, archived, updatedAt, deletedAt',
      // completedAt is indexed because the wins feed (spec 6) is derived
      // entirely from it — there is no separate "wins" table to fall out of date.
      todos: 'id, projectId, energy, date, completedAt, updatedAt, deletedAt',
      ideas: 'id, projectId, promotedToTodoId, updatedAt, deletedAt',
      buyItems: 'id, projectId, purchasedAt, updatedAt, deletedAt',
      lists: 'id, name, updatedAt, deletedAt',
      listItems: 'id, listId, state, updatedAt, deletedAt',
      habits: 'id, state, updatedAt, deletedAt',
      // [habitId+date] is a compound index — it makes "did I log this habit
      // today?" a single indexed lookup instead of a scan.
      habitLogs: 'id, habitId, date, [habitId+date], updatedAt, deletedAt',
      days: 'id, &date, closedAt, updatedAt, deletedAt',
      captures: 'id, sortedAt, createdAt, updatedAt, deletedAt',
      notes: 'id, &projectId, updatedAt, deletedAt',
      conflicts: 'id, table, recordId, createdAt',
      settings: 'id'
    });
  }
}

export const db = new FreeTimeDB();
