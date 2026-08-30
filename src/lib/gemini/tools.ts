import { db } from '../db';
import {
  createTodo, createIdea, createBuyItem,
  createProject, completeTodo, toggleHabitLog, today, createHabit,
  getNote, saveNote
} from '../store';
import { activeProjects, openTodos, closedTodos } from '../queries';
import { allMemos, displayTitle } from '../memos';
import type { FunctionDeclaration } from './client';
import type { Energy } from '../types';

/**
 * The assistant's tools (spec 7.1).
 *
 * Two kinds, and the distinction is the whole safety model:
 *
 *  - READS run immediately. Nothing can go wrong that a second question can't
 *    fix.
 *  - WRITES are never executed here. They are returned as proposals, shown as
 *    editable chips, and only committed when the user taps once. The spec is
 *    explicit: the user is forgetful, not careless, and a silent AI write would
 *    erode trust in the store — which is the entire product.
 *
 * Everything that does eventually write goes through store.ts, the same path a
 * manual edit takes, so it queues offline and syncs identically.
 */

export const WRITE_TOOLS = [
  'create_todo', 'create_idea', 'create_buy_item',
  'create_project', 'complete_todo', 'log_habit',
  'create_habit', 'append_note'
] as const;

export type WriteTool = (typeof WRITE_TOOLS)[number];

/**
 * Tools that touch nothing and may run the moment the model asks.
 *
 * `navigate` is here rather than in WRITE_TOOLS because it changes no data —
 * but it is still not executed automatically. It comes back as a link the user
 * taps, because a model that can move the screen mid-sentence would take the
 * conversation away from under them. Reads answer in place; navigation is
 * offered.
 */
export const SAFE_TOOLS = ['query_state', 'navigate'] as const;

export type SafeTool = (typeof SAFE_TOOLS)[number];

export const isWrite = (name: string): name is WriteTool =>
  (WRITE_TOOLS as readonly string[]).includes(name);

export const isNavigation = (name: string): boolean => name === 'navigate';

const str = (description: string) => ({ type: 'string', description });

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'create_todo',
    description: 'Add a to-do. Only title is required; leave the rest out unless stated.',
    parameters: {
      type: 'object',
      properties: {
        title: str('What to do, in their words.'),
        projectId: str('Only if they named a project.'),
        energy: { type: 'string', enum: ['quick', 'moderate', 'focus'] },
        date: str('YYYY-MM-DD. ONLY for a real obligation they stated. Never inferred.')
      },
      required: ['title']
    }
  },
  {
    name: 'create_idea',
    description:
      'Record a thought with no action attached to it — including a want, like a ' +
      'book to read or an album to hear, which is not a task.',
    parameters: {
      type: 'object',
      properties: {
        text: str('The thought.'),
        projectId: str('Optional.'),
        group: str('Optional named collection, e.g. Books. Reuse an existing name.')
      },
      required: ['text']
    }
  },
  {
    name: 'create_buy_item',
    description: 'Something to buy.',
    parameters: {
      type: 'object',
      properties: {
        name: str('What to buy.'),
        url: str('Optional link.'),
        priceCents: { type: 'integer', description: 'Optional, in cents.' },
        projectId: str('Optional.')
      },
      required: ['name']
    }
  },
  {
    name: 'create_project',
    description: 'Create a new project. Flat — there are no sub-projects.',
    parameters: {
      type: 'object',
      properties: { name: str('Project name.') },
      required: ['name']
    }
  },
  {
    name: 'complete_todo',
    description: 'Mark a to-do done. Use query_state first to find its id.',
    parameters: {
      type: 'object',
      properties: { id: str('The to-do id.') },
      required: ['id']
    }
  },
  {
    name: 'log_habit',
    description: 'Log a habit for a day.',
    parameters: {
      type: 'object',
      properties: { habitId: str('The habit id.'), date: str('YYYY-MM-DD, default today.') },
      required: ['habitId']
    }
  },
  {
    name: 'create_habit',
    description:
      'Start tracking a new habit. Habits have no streaks and no targets here — ' +
      'it is only a thing they want to keep doing.',
    parameters: {
      type: 'object',
      properties: { name: str('What the habit is called.') },
      required: ['name']
    }
  },
  {
    name: 'append_note',
    description:
      "Add a few lines to the end of a project's notes. Never rewrites or " +
      'replaces what is already there.',
    parameters: {
      type: 'object',
      properties: {
        projectId: str('Id of the project. Use query_state to find it.'),
        text: str('The lines to add, in their words.')
      },
      required: ['projectId', 'text']
    }
  },
  {
    name: 'navigate',
    description:
      'Offer to take them to a screen, when seeing the list themselves is more ' +
      'useful than hearing it read out. Answer the question as well.',
    parameters: {
      type: 'object',
      properties: {
        screen: {
          type: 'string',
          enum: ['today', 'projects', 'project', 'brain', 'memos', 'lists', 'buy', 'habits']
        },
        projectId: str("Required when screen is 'project'.")
      },
      required: ['screen']
    }
  },
  {
    name: 'query_state',
    description:
      "Read current state. Use this before answering anything about what's open, " +
      'and to find ids before completing something.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: [
            'projects', 'open_todos', 'closed_todos', 'habits', 'buy',
            'ideas', 'memos'
          ]
        },
        projectName: str('Optional filter by project name.')
      },
      required: ['kind']
    }
  }
];

type Args = Record<string, unknown>;
const s = (v: unknown): string | undefined =>
  typeof v === 'string' && v.trim() ? v.trim() : undefined;

/** Read-only. Safe to run without asking. */
export async function runQuery(args: Args): Promise<unknown> {
  const kind = s(args.kind);
  const projectName = s(args.projectName);
  const projects = await activeProjects();
  const projectId = projectName
    ? projects.find((p) => p.name.toLowerCase() === projectName.toLowerCase())?.id
    : undefined;
  const nameFor = (id?: string) => projects.find((p) => p.id === id)?.name;

  switch (kind) {
    case 'projects':
      return projects.map((p) => ({ id: p.id, name: p.name }));
    case 'open_todos':
      return (await openTodos(projectId))
        .slice(0, 100)
        .map((t) => ({ id: t.id, title: t.title, project: nameFor(t.projectId), date: t.date }));
    case 'closed_todos':
      return (await closedTodos(projectId))
        .slice(0, 50)
        .map((t) => ({ id: t.id, title: t.title, closedAt: t.completedAt }));
    case 'habits':
      return (await db.habits.toArray())
        .filter((h) => !h.deletedAt)
        .map((h) => ({ id: h.id, name: h.name, state: h.state }));
    case 'buy':
      return (await db.buyItems.toArray())
        .filter((b) => !b.deletedAt && !b.purchasedAt)
        .map((b) => ({ id: b.id, name: b.name, project: nameFor(b.projectId) }));
    case 'ideas':
      return (await db.ideas.toArray())
        .filter((i) => !i.deletedAt && (projectId ? i.projectId === projectId : true))
        .slice(0, 100)
        .map((i) => ({
          id: i.id,
          text: i.text,
          project: nameFor(i.projectId),
          group: i.group,
          done: !!i.doneAt
        }));
    case 'memos':
      // Metadata only. The audio never goes near the model — it is the
      // artifact, not something to be summarised.
      return (await allMemos())
        .filter((m) => (projectId ? m.projectId === projectId : true))
        .slice(0, 50)
        .map((m) => ({
          id: m.id,
          title: displayTitle(m),
          recordedAt: m.recordedAt,
          project: nameFor(m.projectId),
          section: m.tag,
          place: m.place
        }));
    default:
      return { error: `Unknown kind ${kind}` };
  }
}

/** A write the model wants to make, held until the user agrees to it. */
export interface ProposedWrite {
  name: WriteTool;
  args: Args;
  /** Human-readable, and editable in the review UI. */
  label: string;
}

export async function describeWrite(name: WriteTool, args: Args): Promise<string> {
  const projects = await activeProjects();
  const nameFor = (id?: string) => projects.find((p) => p.id === id)?.name;
  const inProject = (id?: string) => (nameFor(id) ? ` in ${nameFor(id)}` : '');

  switch (name) {
    case 'create_todo':
      return `To-do: ${s(args.title) ?? '?'}${inProject(s(args.projectId))}`;
    case 'create_idea': {
      const group = s(args.group);
      return `Idea: ${s(args.text) ?? '?'}${group ? ` (${group})` : ''}`;
    }
    case 'create_buy_item':
      return `Buy: ${s(args.name) ?? '?'}`;
    case 'create_project':
      return `New project: ${s(args.name) ?? '?'}`;
    case 'complete_todo': {
      const todo = await db.todos.get(s(args.id) ?? '');
      return `Complete: ${todo?.title ?? s(args.id)}`;
    }
    case 'log_habit': {
      const habit = await db.habits.get(s(args.habitId) ?? '');
      return `Log habit: ${habit?.name ?? s(args.habitId)}`;
    }
    case 'create_habit':
      return `New habit: ${s(args.name) ?? '?'}`;
    case 'append_note': {
      const text = s(args.text) ?? '';
      const short = text.length > 60 ? `${text.slice(0, 57)}…` : text;
      return `Note${inProject(s(args.projectId))}: ${short}`;
    }
  }
}

/** Runs a write the user has confirmed. Same store as every manual edit. */
export async function applyWrite(name: WriteTool, args: Args): Promise<void> {
  switch (name) {
    case 'create_todo':
      await createTodo(s(args.title) ?? '', {
        projectId: s(args.projectId),
        energy: s(args.energy) as Energy | undefined,
        date: s(args.date)
      });
      break;
    case 'create_idea':
      await createIdea(s(args.text) ?? '', { projectId: s(args.projectId), group: s(args.group) });
      break;
    case 'create_buy_item':
      await createBuyItem(s(args.name) ?? '', {
        url: s(args.url),
        priceCents: typeof args.priceCents === 'number' ? args.priceCents : undefined,
        projectId: s(args.projectId)
      });
      break;
    case 'create_project':
      await createProject(s(args.name) ?? '');
      break;
    case 'complete_todo':
      await completeTodo(s(args.id) ?? '');
      break;
    case 'log_habit':
      await toggleHabitLog(s(args.habitId) ?? '', s(args.date) ?? today());
      break;
    case 'create_habit':
      await createHabit(s(args.name) ?? '');
      break;
    case 'append_note': {
      // Append, never replace. A voice command that overwrites a page of notes
      // is unrecoverable, and there is no undo in this app.
      const projectId = s(args.projectId);
      const text = s(args.text);
      if (!projectId || !text) break;
      const existing = (await getNote(projectId))?.markdown ?? '';
      await saveNote(projectId, existing ? `${existing.trimEnd()}\n\n${text}` : text);
      break;
    }
  }
}

/** Where a `navigate` call wants to go, as a path this app understands. */
export function navigationTarget(args: Args): { label: string; path: string } | null {
  const screen = s(args.screen);
  const projectId = s(args.projectId);
  switch (screen) {
    case 'today':
      return { label: 'Today', path: '/' };
    case 'projects':
      return { label: 'Projects', path: '/projects' };
    case 'project':
      return projectId ? { label: 'the project', path: `/projects/${projectId}` } : null;
    case 'brain':
      return { label: 'Brain', path: '/brain' };
    case 'memos':
      return { label: 'Recordings', path: '/brain?section=memos' };
    case 'buy':
      return { label: 'the buy list', path: '/brain?section=buy' };
    case 'habits':
      return { label: 'Habits', path: '/me' };
    default:
      return null;
  }
}
