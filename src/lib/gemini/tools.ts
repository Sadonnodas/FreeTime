import { db } from '../db';
import {
  createTodo, createIdea, createBuyItem,
  createProject, completeTodo, toggleHabitLog, today, createHabit,
  getNote, saveNote, setProjectTags, setProjectTagDescription, promoteIdea, ideaToProject,
  setProjectTagFinished
} from '../store';
import { activeProjects, openTodos, closedTodos } from '../queries';
import { allMemos, displayTitle } from '../memos';
import type { FunctionDeclaration } from './client';
import type { Energy, Project } from '../types';

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
  'create_project', 'add_project_to_era', 'complete_todo', 'log_habit',
  'create_habit', 'append_note', 'idea_to_todo', 'idea_to_project', 'finish_project'
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

/**
 * Tools that change a PROPOSAL, never the store.
 *
 * Asked for as *"be able to adjust assistant entries with a follow-up recording
 * to tweak AI suggestions"*. Proposals used to be append-only: say "no, make it
 * Friday" and the model could only propose a second to-do beside the wrong
 * one, leaving you to find and × the first. Now the waiting proposals are
 * shown to the model, numbered, and it can revise or drop one by number.
 *
 * A third category rather than a write, because nothing they do reaches the
 * database — the edited proposal still waits for the same tap on Add. And not
 * a safe read either: treated as a read, the loop would run it through
 * `runQuery` and hand the model back an error.
 */
export const PENDING_TOOLS = ['revise_pending', 'drop_pending'] as const;

export type PendingTool = (typeof PENDING_TOOLS)[number];

export const isPendingEdit = (name: string): name is PendingTool =>
  (PENDING_TOOLS as readonly string[]).includes(name);

export type SafeTool = (typeof SAFE_TOOLS)[number];

export const isWrite = (name: string): name is WriteTool =>
  (WRITE_TOOLS as readonly string[]).includes(name);

export const isNavigation = (name: string): boolean => name === 'navigate';

const str = (description: string) => ({ type: 'string', description });

/*
 * THE ADDRESS OF A THING: an era, then optionally a project inside it.
 *
 * `projectId` is the ERA — a schema name that predates the vocabulary change,
 * kept because argument keys are schema, not copy (see CLAUDE.md on Eras and
 * Projects). `projectInEra` is the new half: the NAME of a project inside that
 * era, because a project is addressed by its name everywhere else in the app.
 *
 * `projectId` accepts the era's NAME as well as its id. That is what lets one
 * reply say "make a Coding era, and a project in it, and a to-do in that" —
 * the era's id does not exist yet when the model writes the later calls, but
 * its name does. Both halves are resolved when the user taps Add, in order,
 * so everything created earlier in the same batch is already there.
 */
const ERA = str(
  'The era: its id from the digest or query_state, or its exact name if it is ' +
    'being created earlier in this same reply. Leave out if they named no era.'
);
const PROJECT_IN_ERA = str(
  'Optional. The NAME of a project inside that era — FreeTime inside Coding, ' +
    'Furniture inside Campervan. Only if they named one, or it is being added ' +
    'earlier in this same reply. Never invent one.'
);

export const TOOL_DECLARATIONS: FunctionDeclaration[] = [
  {
    name: 'create_todo',
    description: 'Add a to-do. Only title is required; leave the rest out unless stated.',
    parameters: {
      type: 'object',
      properties: {
        title: str('What to do, in their words.'),
        projectId: ERA,
        projectInEra: PROJECT_IN_ERA,
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
        projectId: str(
          'Optional. The era, as for create_todo, if one obviously fits. Ideas are ' +
            'allowed to belong nowhere — leave it out rather than guessing.'
        ),
        projectInEra: PROJECT_IN_ERA
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
        projectId: ERA,
        projectInEra: PROJECT_IN_ERA
      },
      required: ['name']
    }
  },
  {
    name: 'create_project',
    description:
      'Create a new era — a lasting area of life such as Music, Family or ' +
      'Crafting. NOT for a single piece of work: "build a trigger pad" is a ' +
      'project, which lives inside an era and is not created this way.',
    parameters: {
      type: 'object',
      properties: { name: str('Name of the era.') },
      required: ['name']
    }
  },
  {
    name: 'add_project_to_era',
    description:
      'Add a PROJECT inside an existing era — a piece of work such as "MTG ' +
      'simulator" inside Coding, or "Trigger pad" inside Crafting. This is how ' +
      'projects are made; create_project makes an era and must not be used for ' +
      'this. Projects never go inside other projects.',
    parameters: {
      type: 'object',
      properties: {
        projectId: ERA,
        name: str('Name of the new project, short, in their words.'),
        description: str(
          'Optional one-line tagline shown under its name. Only if they gave a ' +
            'description. Something they want WRITTEN IN THE NOTES goes to ' +
            'append_note instead.'
        )
      },
      required: ['projectId', 'name']
    }
  },
  {
    name: 'finish_project',
    description:
      'Mark a whole project inside an era as FINISHED, when they say it is done ' +
      '— "I finished the closet". Nothing inside it changes; it moves to the ' +
      "era's finished list and counts as a win. Only when they say so.",
    parameters: {
      type: 'object',
      properties: {
        projectId: ERA,
        projectInEra: str('The NAME of the project that is finished.')
      },
      required: ['projectId', 'projectInEra']
    }
  },
  {
    name: 'idea_to_todo',
    description:
      'Turn an existing idea into a to-do, in the same era and project. Use ' +
      'query_state kind=ideas to find its id. Only when they say so: an idea is ' +
      'allowed to stay an idea.',
    parameters: {
      type: 'object',
      properties: { id: str('The idea id.') },
      required: ['id']
    }
  },
  {
    name: 'idea_to_project',
    description:
      'Grow an existing idea into a project of its own. The project is created ' +
      'next to the others in the era, never inside another project, and the idea ' +
      'moves into it. Use query_state kind=ideas to find its id.',
    parameters: {
      type: 'object',
      properties: {
        id: str('The idea id.'),
        name: str('Short name for the project. The idea text is kept as its description.'),
        projectId: str(
          "The era to create it in. Leave out to use the idea's own era; required " +
            'if the idea belongs to no era.'
        )
      },
      required: ['id', 'name']
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
      "Add a few lines to the end of the notes of an era, or of a project inside " +
      'one. Never rewrites or replaces what is already there.',
    parameters: {
      type: 'object',
      properties: {
        projectId: ERA,
        projectInEra: str(
          'The NAME of the project whose notes these are, if they are for a ' +
            'project rather than the era as a whole — including one added earlier ' +
            'in this same reply.'
        ),
        text: str('The lines to add, in their words.')
      },
      required: ['projectId', 'text']
    }
  },
  {
    name: 'revise_pending',
    description:
      'Change one of the proposals that are NOT SAVED YET, by its number — for ' +
      'follow-ups like "make that Friday", "no, put it in FreeTime" or "call it ' +
      'X instead". Give only the fields that change. Never propose the same thing ' +
      'again instead; that would leave the wrong one waiting beside it.',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'integer', description: 'Its number in the NOT SAVED YET list.' },
        title: str('New title, for a to-do.'),
        text: str('New wording, for an idea or a note.'),
        name: str('New name, for a buy item, project, era or habit.'),
        projectId: str('New era, as for create_todo.'),
        projectInEra: str('New project inside the era, by name.'),
        energy: { type: 'string', enum: ['quick', 'moderate', 'focus'] },
        date: str('YYYY-MM-DD, only for a real obligation they stated.'),
        description: str('New tagline, for a project.')
      },
      required: ['number']
    }
  },
  {
    name: 'drop_pending',
    description:
      'Remove one of the proposals that are NOT SAVED YET, by its number, when ' +
      'they say it is wrong or not wanted.',
    parameters: {
      type: 'object',
      properties: {
        number: { type: 'integer', description: 'Its number in the NOT SAVED YET list.' }
      },
      required: ['number']
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
        projectId: str("Required when screen is 'project' — the id of the era."),
        projectInEra: str('Optional, with screen project: the name of a project inside that era.')
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
        projectName: str('Optional filter by ERA name.')
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
      // "projects" here means ERAS, for schema reasons — so each one lists the
      // projects inside it, which is what the model needs to file into one.
      return projects.map((p) => ({ id: p.id, name: p.name, projects: p.tags ?? [] }));
    case 'open_todos':
      return (await openTodos(projectId)).slice(0, 100).map((t) => ({
        id: t.id,
        title: t.title,
        era: nameFor(t.projectId),
        projectInEra: t.tag,
        date: t.date
      }));
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
        .map((b) => ({ id: b.id, name: b.name, era: nameFor(b.projectId), projectInEra: b.tag }));
    case 'ideas':
      return (await db.ideas.toArray())
        .filter((i) => !i.deletedAt && (projectId ? i.projectId === projectId : true))
        .slice(0, 100)
        .map((i) => ({
          id: i.id,
          text: i.text,
          era: nameFor(i.projectId),
          projectInEra: i.tag,
          group: i.group,
          done: !!i.doneAt,
          alreadyATodo: !!i.promotedToTodoId,
          startedAProject: !!i.becameProjectAt
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

/**
 * An era, by id or by name — resolved when the write is APPLIED, not when it
 * is proposed. That is what makes a batch work: "add a project to Coding and
 * write this in its notes" is two proposals, and the project the note is for
 * does not exist until the first one has been applied.
 */
export async function resolveEra(ref?: string): Promise<Project | undefined> {
  if (!ref) return undefined;
  const eras = await activeProjects();
  const lower = ref.toLowerCase();
  return eras.find((e) => e.id === ref) ?? eras.find((e) => e.name.toLowerCase() === lower);
}

/**
 * A project inside an era, matched without regard to case but returned with
 * the era's own spelling.
 *
 * A name the era does not have is DROPPED, never stored. A tag pointing at a
 * project that does not exist is not filed somewhere wrong, it is invisible —
 * no screen shows it — so a to-do the model filed into a misheard project
 * falls back to the era, where it can be seen and moved.
 */
export function resolveProjectInEra(era: Project | undefined, name?: string): string | undefined {
  if (!era || !name) return undefined;
  const lower = name.trim().toLowerCase();
  return (era.tags ?? []).find((t) => t.toLowerCase() === lower);
}

/**
 * The order confirmed writes are applied in: things that CREATE a place first,
 * then things that go into one. The model usually writes its calls in that
 * order anyway, but "put this in the MTG simulator notes — oh, and make that
 * project" is a perfectly natural sentence, and applying it as spoken would
 * file the note before its project existed. Stable, so within each rank the
 * model's own order is kept.
 */
const APPLY_RANK: Partial<Record<WriteTool, number>> = {
  create_project: 0,
  add_project_to_era: 1,
  idea_to_project: 2
};
export function orderForApply<T extends { name: WriteTool }>(writes: T[]): T[] {
  return writes
    .map((w, i) => ({ w, i }))
    .sort((a, b) => (APPLY_RANK[a.w.name] ?? 3) - (APPLY_RANK[b.w.name] ?? 3) || a.i - b.i)
    .map(({ w }) => w);
}

/** A write the model wants to make, held until the user agrees to it. */
export interface ProposedWrite {
  name: WriteTool;
  args: Args;
  /** Human-readable, and editable in the review UI. */
  label: string;
}

/**
 * The words a proposal is ABOUT, for editing it in the chat before it is
 * added — the to-do's title, the note's text, the new project's name. Tools
 * that act on something that already exists (complete a to-do, log a habit)
 * have nothing of their own to reword, so they have no entry.
 */
const EDITABLE_ARG: Partial<Record<WriteTool, string>> = {
  create_todo: 'title',
  create_idea: 'text',
  create_buy_item: 'name',
  create_project: 'name',
  add_project_to_era: 'name',
  create_habit: 'name',
  append_note: 'text',
  idea_to_project: 'name'
};

/** The editable words of a proposal, or null when it has none. */
export function editableText(p: Pick<ProposedWrite, 'name' | 'args'>): string | null {
  const key = EDITABLE_ARG[p.name];
  return key ? (s(p.args[key]) ?? '') : null;
}

/**
 * A proposal with its words changed, and its label rebuilt from them — the
 * label is what the chat shows, so it must never describe the old words.
 * An empty edit is refused (null): a to-do with no title cannot be read or
 * found again, the same rule RenameField holds.
 */
export async function withEditedText(p: ProposedWrite, text: string): Promise<ProposedWrite | null> {
  const key = EDITABLE_ARG[p.name];
  const trimmed = text.trim();
  if (!key || !trimmed) return null;
  const args = { ...p.args, [key]: trimmed };
  return { ...p, args, label: await describeWrite(p.name, args) };
}

export async function describeWrite(name: WriteTool, args: Args): Promise<string> {
  // Named from what the model said, not only from what exists: the era or
  // project may be created by an earlier proposal in the same batch.
  const era = await resolveEra(s(args.projectId));
  const eraName = era?.name ?? s(args.projectId);
  const where = () => {
    const parts = [eraName, s(args.projectInEra)].filter(Boolean);
    return parts.length ? ` in ${parts.join(' · ')}` : '';
  };
  const short = (text: string) => (text.length > 60 ? `${text.slice(0, 57)}…` : text);

  switch (name) {
    case 'create_todo':
      return `To-do: ${s(args.title) ?? '?'}${where()}`;
    case 'create_idea':
      return `Idea: ${s(args.text) ?? '?'}${where()}`;
    case 'create_buy_item':
      return `Buy: ${s(args.name) ?? '?'}${where()}`;
    case 'create_project':
      return `New era: ${s(args.name) ?? '?'}`;
    case 'add_project_to_era':
      return `New project: ${s(args.name) ?? '?'}${eraName ? ` in ${eraName}` : ''}`;
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
    case 'append_note':
      // In full: the chat shows proposals whole, and a note is exactly the
      // thing whose middle you need to read before adding it.
      return `Note${where()}: ${s(args.text) ?? ''}`;
    case 'idea_to_todo': {
      const idea = await db.ideas.get(s(args.id) ?? '');
      return `Make a to-do: ${short(idea?.text ?? s(args.id) ?? '?')}`;
    }
    case 'finish_project':
      return `Finish project: ${s(args.projectInEra) ?? '?'}${eraName ? ` in ${eraName}` : ''}`;
    case 'idea_to_project': {
      const idea = await db.ideas.get(s(args.id) ?? '');
      return `Idea → project: ${s(args.name) ?? '?'} (from “${short(idea?.text ?? '?')}”)`;
    }
  }
}

/** Runs a write the user has confirmed. Same store as every manual edit. */
export async function applyWrite(name: WriteTool, args: Args): Promise<void> {
  // Resolved now, at apply time — see resolveEra.
  const era = await resolveEra(s(args.projectId));
  const tag = resolveProjectInEra(era, s(args.projectInEra));

  switch (name) {
    case 'create_todo':
      await createTodo(s(args.title) ?? '', {
        projectId: era?.id,
        tag,
        energy: s(args.energy) as Energy | undefined,
        date: s(args.date)
      });
      break;
    case 'create_idea':
      await createIdea(s(args.text) ?? '', { projectId: era?.id, tag });
      break;
    case 'create_buy_item':
      await createBuyItem(s(args.name) ?? '', {
        url: s(args.url),
        priceCents: typeof args.priceCents === 'number' ? args.priceCents : undefined,
        projectId: era?.id,
        tag
      });
      break;
    case 'create_project':
      await createProject(s(args.name) ?? '');
      break;
    case 'add_project_to_era': {
      const projectName = s(args.name);
      if (!era || !projectName) break;
      // Already there (any capitalisation): nothing to add. A second "Mixing"
      // beside the first would be two projects that cannot be told apart.
      if (resolveProjectInEra(era, projectName)) break;
      await setProjectTags(era.id, [...(era.tags ?? []), projectName]);
      const description = s(args.description);
      if (description) await setProjectTagDescription(era.id, projectName, description);
      break;
    }
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
      const text = s(args.text);
      if (!era || !text) break;
      const existing = (await getNote(era.id, tag))?.markdown ?? '';
      await saveNote(era.id, existing ? `${existing.trimEnd()}\n\n${text}` : text, tag);
      break;
    }
    case 'finish_project':
      // A name the era does not have finishes nothing, rather than a guess.
      if (era && tag) await setProjectTagFinished(era.id, tag, true);
      break;
    case 'idea_to_todo': {
      const idea = await db.ideas.get(s(args.id) ?? '');
      // Once is enough: a second to-do from the same idea is a duplicate.
      if (!idea || idea.deletedAt || idea.promotedToTodoId) break;
      await promoteIdea(idea.id);
      break;
    }
    case 'idea_to_project': {
      const idea = await db.ideas.get(s(args.id) ?? '');
      const projectName = s(args.name);
      if (!idea || idea.deletedAt || idea.becameProjectAt || !projectName) break;
      const target = era?.id ?? idea.projectId;
      if (!target) break;
      await ideaToProject(idea.id, target, projectName);
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
    case 'project': {
      if (!projectId) return null;
      const inEra = s(args.projectInEra);
      return inEra
        ? { label: inEra, path: `/projects/${projectId}/${encodeURIComponent(inEra)}` }
        : { label: 'the era', path: `/projects/${projectId}` };
    }
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

/** A change the model asked for to a waiting proposal. */
export type PendingEdit =
  | { kind: 'revise'; number: number; changes: Args }
  | { kind: 'drop'; number: number };

const REVISABLE = [
  'title', 'text', 'name', 'projectId', 'projectInEra', 'energy', 'date', 'description'
] as const;

/**
 * Applies revisions and drops to the waiting proposals, and relabels what
 * changed. Numbers refer to the list as the model saw it, so every edit is
 * resolved against the ORIGINAL positions: dropping 1 must not turn "revise 2"
 * into a revision of what used to be 3.
 *
 * An edit naming a number that is not there is ignored rather than guessed at.
 * Moving to another era clears the project unless a new one is given, because
 * a project name belongs to one era.
 */
export async function applyPendingEdits(
  pending: ProposedWrite[],
  edits: PendingEdit[]
): Promise<ProposedWrite[]> {
  const next: (ProposedWrite | null)[] = [...pending];
  for (const edit of edits) {
    const i = edit.number - 1;
    const current = next[i];
    if (!current || !Number.isInteger(edit.number)) continue;
    if (edit.kind === 'drop') {
      next[i] = null;
      continue;
    }
    const args = { ...current.args };
    for (const key of REVISABLE) {
      const value = s(edit.changes[key]);
      if (value !== undefined) args[key] = value;
    }
    if (s(edit.changes.projectId) && !s(edit.changes.projectInEra)) delete args.projectInEra;
    next[i] = { ...current, args, label: await describeWrite(current.name, args) };
  }
  return next.filter((p): p is ProposedWrite => p !== null);
}
