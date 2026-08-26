import { db } from '../db';
import {
  createTodo, createIdea, createBuyItem, createList, addListItem,
  createProject, completeTodo, toggleHabitLog, today
} from '../store';
import { activeProjects, openTodos, closedTodos } from '../queries';
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
  'create_todo', 'create_idea', 'create_buy_item', 'add_list_item',
  'create_list', 'create_project', 'complete_todo', 'log_habit'
] as const;

export type WriteTool = (typeof WRITE_TOOLS)[number];

export const isWrite = (name: string): name is WriteTool =>
  (WRITE_TOOLS as readonly string[]).includes(name);

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
    description: 'Record a thought with no action attached to it.',
    parameters: {
      type: 'object',
      properties: { text: str('The thought.'), projectId: str('Optional.') },
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
    name: 'add_list_item',
    description: 'Add to an existing list, e.g. books or albums.',
    parameters: {
      type: 'object',
      properties: { listId: str('Id of the list.'), text: str('The entry.'), url: str('Optional.') },
      required: ['listId', 'text']
    }
  },
  {
    name: 'create_list',
    description: 'Create a new list.',
    parameters: {
      type: 'object',
      properties: { name: str('List name.') },
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
    name: 'query_state',
    description:
      "Read current state. Use this before answering anything about what's open, " +
      'and to find ids before completing something.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['projects', 'open_todos', 'closed_todos', 'lists', 'habits', 'buy']
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
    case 'lists':
      return (await db.lists.toArray())
        .filter((l) => !l.deletedAt)
        .map((l) => ({ id: l.id, name: l.name }));
    case 'habits':
      return (await db.habits.toArray())
        .filter((h) => !h.deletedAt)
        .map((h) => ({ id: h.id, name: h.name, state: h.state }));
    case 'buy':
      return (await db.buyItems.toArray())
        .filter((b) => !b.deletedAt && !b.purchasedAt)
        .map((b) => ({ id: b.id, name: b.name, project: nameFor(b.projectId) }));
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
    case 'create_idea':
      return `Idea: ${s(args.text) ?? '?'}`;
    case 'create_buy_item':
      return `Buy: ${s(args.name) ?? '?'}`;
    case 'add_list_item':
      return `List entry: ${s(args.text) ?? '?'}`;
    case 'create_list':
      return `New list: ${s(args.name) ?? '?'}`;
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
      await createIdea(s(args.text) ?? '', s(args.projectId));
      break;
    case 'create_buy_item':
      await createBuyItem(s(args.name) ?? '', {
        url: s(args.url),
        priceCents: typeof args.priceCents === 'number' ? args.priceCents : undefined,
        projectId: s(args.projectId)
      });
      break;
    case 'add_list_item':
      await addListItem(s(args.listId) ?? '', s(args.text) ?? '', s(args.url));
      break;
    case 'create_list':
      await createList(s(args.name) ?? '');
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
  }
}
