<script lang="ts">
  import { liveQuery } from 'dexie';
  import { base } from '$app/paths';
  import { db } from '$lib/db';
  import type { Todo, Habit, HabitLog, Day, Project } from '$lib/types';
  import {
    completeTodo, uncompleteTodo, toggleHabitLog, today, projectTagColor, reorderHabits
  } from '$lib/store';
  import { allTodos, activeProjects } from '$lib/queries';
  import { ENERGIES, DURATIONS, energyLabel, durationLabel } from '$lib/sizes';
  import { indexById, blockerOf } from '$lib/order';
  import { tomorrow, weekStart } from '$lib/days';
  import {
    ensureDay, addToDay, removeFromDay, maybeCloseDay,
    canUnlockOneMore, unlockOneMore, reopenDayIfIncomplete, DayFullError, STARTING_SLOTS,
    reorderDay, reorderDayList, byDayList
  } from '$lib/day';
  import { byHabitOrder, habitColor, habitWeek, ON_COLOR } from '$lib/habits';
  import { milestoneToday, type Milestone } from '$lib/milestones';
  import { pickClearCheer } from '$lib/clearCheers';
  import MilestoneCard from '$lib/components/MilestoneCard.svelte';
  import { Reorder } from '$lib/reorder.svelte';
  import { flip } from 'svelte/animate';
  import { tintFor } from '$lib/colors';
  import DayClose from '$lib/components/DayClose.svelte';
  import MonthlySummary from '$lib/components/MonthlySummary.svelte';
  import WeeklySummary from '$lib/components/WeeklySummary.svelte';
  import { pendingWeeklySummary, type WeeklySummary as WeeklySummaryData } from '$lib/weekly';
  import CalendarStrip from '$lib/components/CalendarStrip.svelte';
  import { pendingMonthlySummary, type MonthlySummary as Summary } from '$lib/monthly';
  import { onMount } from 'svelte';
  import FreeTime from '$lib/components/FreeTime.svelte';
  import Dino from '$lib/components/Dino.svelte';
  import Burst from '$lib/components/Burst.svelte';
  import PhotoThumb from '$lib/components/PhotoThumb.svelte';
  import ShoppingListButton from '$lib/components/ShoppingListButton.svelte';
  import QuickNotes from '$lib/components/QuickNotes.svelte';
  import { onList } from '$lib/shoppingList';
  import { randomSticker, stickerUrl } from '$lib/stickers';
  import { pickScene, pickQuip } from '$lib/freeTimeScenes';

  /**
   * Dexie's liveQuery re-runs its callback whenever any table it touched
   * changes, and returns an Observable. Svelte's $ prefix works with anything
   * that has .subscribe(), so `$dayQ` stays current with no manual refresh
   * anywhere — including writes made from another tab.
   */
  const dayQ = liveQuery(() => ensureDay());
  const habitsQ = liveQuery(async () =>
    (await db.habits.toArray())
      .filter((h) => !h.deletedAt && h.state === 'active')
      .sort(byHabitOrder)
  );

  /**
   * Press, hold and drag, for the three and for the habits — see reorder.svelte.ts
   * for why it waits for a hold. The three are a vertical list; habits wrap
   * into rows, so they reorder in reading order.
   */
  const slotDrag = new Reorder((ids) => reorderDay(ids));
  const habitDrag = new Reorder((ids) => reorderHabits(ids), 'xy');
  /**
   * A WEEK of habit logs, not just today's, because a habit can have a rhythm
   * of its own now ("3 times a week") and the chip has to say how the week has
   * gone. One query over the same table: today's are picked out of it below.
   * `today()` is called inside the callback, so a liveQuery re-run after
   * midnight reads the new week rather than the old key.
   */
  const logsWeekQ = liveQuery(async () => {
    const from = today(weekStart(new Date()));
    return (await db.habitLogs.where('date').between(from, today(), true, true).toArray()).filter(
      (l) => !l.deletedAt
    );
  });
  /**
   * Every live to-do, read once — the open ones to choose from, and the whole
   * set to resolve "comes after" against, since the thing standing in the way
   * of one of them may be a completed to-do the open list has filtered out.
   * One liveQuery over one table, so both stay current together.
   */
  /** Era names for the picker's headings and each row's footnote. */
  const projectsQ = liveQuery(() => activeProjects());

  const openQ = liveQuery(async () => {
    const all = await allTodos();
    return { all, open: all.filter((t) => !t.completedAt) };
  });

  /**
   * The day's three, resolved from their ids.
   *
   * This has to be a liveQuery that reads BOTH tables, not an effect keyed on
   * the day. It was the latter, and the bug was as central as bugs get: ticking
   * something off writes to `todos`, the day record does not change, so nothing
   * re-ran and the screen sat there unchanged — no tick, no count — until the
   * third completion happened to write `closedAt` and shake it loose. The one
   * interaction the whole app is built around did nothing visible.
   */
  const slotTodosQ = liveQuery(async () => {
    const day = await ensureDay();
    const rows = await db.todos.bulkGet(day.slots);
    return day.slots
      .map((id) => rows.find((r) => r?.id === id))
      .filter((t): t is Todo => !!t && !t.deletedAt);
  });

  /**
   * A different little scene each time the app opens. Chosen once, here, rather
   * than in the markup — re-rolling on every render would make the button
   * change identity while being looked at.
   */
  const scene = pickScene();
  const quip = pickQuip();

  /**
   * "Still here."
   *
   * ONE undone thing waves at a time, in turn, for a moment. The rules that
   * keep this on the right side of the no-nag line are in app.css next to the
   * keyframes, and they are not decoration: it never escalates with time, it
   * never picks out the oldest or most neglected item, and it says nothing in
   * words. Motion only — "don't forget about me" written on the screen would be
   * aimed at the reader, and the house rule is that the app's personality is
   * never at your expense.
   */
  /*
   * A walk takes three seconds and one comes round every nine.
   *
   * The animal used to cross a whole card in a second and a half, which is a
   * bolt rather than a stroll — "moving a bit too fast to really see them
   * well". Doubling the walk means the gap has to grow with it or the page is
   * animated more often than it is still: three-in-nine keeps almost exactly
   * the proportion of quiet that one-and-a-half-in-five had.
   *
   * NUDGE_FOR must stay AHEAD of the longest animation in app.css. If it ever
   * falls short the class comes off mid-walk and the animal disappears in the
   * middle of the row.
   */
  const NUDGE_EVERY = 9000;
  const NUDGE_FOR = 3100;
  let nudged = $state<string | null>(null);
  let turn = 0;

  /**
   * Who is walking through, and which way.
   *
   * A different sticker dinosaur each time and a coin flip on which way it
   * goes, so the same row twice running is never the same little event. CSS
   * cannot roll a die, so the choice is made here and handed over as custom
   * properties.
   *
   * TWO PROPERTIES, because they do different jobs. `--dino-dir` comes from the
   * sticker's own `faces` and makes the animal walk FORWARDS; `--dino-face` is
   * the coin flip. Mirroring cannot fix facing — it flips the picture and the
   * travel together, so a backwards walk stays backwards — which is exactly
   * why the direction is reversed instead. See the note in app.css.
   */
  let dinoSrc = $state('');
  let dinoFace = $state(1);
  let dinoDir = $state('normal');

  function castDino() {
    const sticker = randomSticker();
    const url = stickerUrl(sticker);
    dinoSrc = `url("${url}")`;
    dinoDir = sticker.faces === 'right' ? 'normal' : 'reverse';
    dinoFace = Math.random() < 0.5 ? -1 : 1;
    // Start the fetch now rather than when the animation needs it. On the phone
    // these are precached, so this only matters the first time on a laptop.
    if (typeof Image !== 'undefined') new Image().src = url;
  }

  /** Which item is mid-celebration, so its burst renders exactly once. */
  let celebrating = $state<string | null>(null);

  /**
   * A milestone reached by the tap that just happened — "100 times", "8 weeks
   * running". Checked after the write, from that habit's own logs, because
   * this page only reads THIS WEEK's and a hundredth time is a fact about
   * every week there has been.
   *
   * Only ever on the way IN, like the confetti: crossing a milestone backwards
   * is not a thing that can happen, and celebrating an untick would be the app
   * pleased about the wrong thing.
   */
  let milestone = $state<{ m: Milestone; name: string; color: string } | null>(null);
  async function checkMilestone(habit: Habit) {
    const logs = (await db.habitLogs.where('habitId').equals(habit.id).toArray())
      .filter((l) => !l.deletedAt)
      .map((l) => l.date);
    const m = milestoneToday(habit, logs);
    if (m) milestone = { m, name: habit.name, color: habitColor(habit) };
  }
  /**
   * DONE SINKS, on all three lists — the three, the day list and the habits.
   * *"Marked as done should move to the bottom of their respective lists"*:
   * what is left to do stays where the eye starts. Only the DISPLAY order
   * changes; nothing is written, so unticking brings a row straight back up.
   *
   * Not instantly, though: a row that leaves the moment it is ticked takes its
   * celebration with it, so a just-ticked row is held in place (`settling`)
   * for as long as the burst plays, then slides down (animate:flip).
   */
  let settling = $state<string[]>([]);
  function sinkDone<T extends { id: string }>(items: T[], isDone: (item: T) => boolean): T[] {
    const rank = (item: T) => (isDone(item) && !settling.includes(item.id) ? 1 : 0);
    // Array.prototype.sort is stable, so each half keeps its own order.
    return [...items].sort((a, b) => rank(a) - rank(b));
  }

  /**
   * FINISHING A WHOLE SECTION OFF, which had no moment at all.
   *
   * Asked for as *"can I get some kind of celebration when I did all my
   * to-dos, and/or all my extra to-dos, and/or all my habits for the day?"*
   * The three slots already had one — closing the day is the spec's own
   * mechanic — and the other two lists just went quiet.
   *
   * **The transition is celebrated, never the state.** It fires from the tap
   * that empties the list, not from the list being empty: opening the app in
   * the evening with everything already done must not throw confetti at you
   * for work you finished hours ago. So the check is made BEFORE the write,
   * against the row being ticked — "this is the last one open" — which is also
   * synchronous, where waiting for the liveQuery to come back would not be.
   *
   * Once per section per day, so a mis-tap and a re-tick do not replay it.
   * In memory only: after a reload the list is already complete, and the only
   * way back to the transition is to untick something first.
   */
  let cleared = $state<'list' | 'habits' | null>(null);
  /** Which dinosaur turned up, and what it said. See clearCheers.ts. */
  let clearCheer = $state<ReturnType<typeof pickClearCheer> | null>(null);
  const cheered = new Set<string>();
  function cheerSection(kind: 'list' | 'habits') {
    const key = `${kind}-${today()}`;
    if (cheered.has(key)) return;
    cheered.add(key);
    // Picked at the moment it happens, so the two sections on one evening get
    // different animals — never the same one twice running.
    clearCheer = pickClearCheer();
    cleared = kind;
    setTimeout(() => {
      if (cleared === kind) {
        cleared = null;
        clearCheer = null;
      }
    }, 6000);
  }

  function celebrate(id: string) {
    settling = [...settling, id];
    setTimeout(() => (settling = settling.filter((s) => s !== id)), 950);
    celebrating = id;
    // Fire and forget: nothing waits on this, and a second tick during it
    // simply replaces it rather than queueing.
    setTimeout(() => {
      if (celebrating === id) celebrating = null;
    }, 900);
  }

  let showClose = $state(false);
  let unlockAvailable = $state(false);
  let picking = $state(false);
  let freeTime = $state(false);
  let quickNotes = $state(false);

  // Arrives on the first open on or after the 1st, then never again that month.
  let monthly = $state<Summary | null>(null);
  // And last week, on the first open of a new one. See weekly.ts.
  let weekly = $state<WeeklySummaryData | null>(null);
  /**
   * THE LOOK-BACKS HAVE TO BE ASKED FOR AGAIN WHEN THE APP COMES BACK, not
   * only at a cold launch.
   *
   * Reported as the weekly review arriving on the laptop and never on the
   * phone — and the giveaway was WHEN it arrived on the laptop: right after
   * signing in to Google, which is a full-page redirect, which reloads the
   * page, which is the only thing that runs `onMount`. An installed app on a
   * phone is SUSPENDED rather than closed, so Monday morning it resumes with
   * the same JavaScript still in memory and nobody ever asks again.
   *
   * Fourth time this exact shape: the calendar cache, the theme, the update
   * check and the Google token all learned that a device which has been asleep
   * has to be told to look again. Anything keyed on "a new day/week/month has
   * begun" must be checked on the way back to the foreground too.
   *
   * Guarded so it can never land on top of something: not while a full-screen
   * thing is already open, and not while a field has focus — this page carries
   * the quick-notes box, and losing what is half-written to a look-back would
   * be a worse bug than the one being fixed. It cannot nag: both are keyed on
   * having been SHOWN, so each arrives once.
   */
  async function checkSummaries() {
    if (monthly || weekly) return;
    if (showClose || picking || freeTime || quickNotes) return;
    const el = document.activeElement as HTMLElement | null;
    if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;

    monthly = await pendingMonthlySummary();
    // NEVER BOTH ON ONE OPEN. When a month and a week turn over together, two
    // full-screen look-backs stacked on top of each other is the app talking
    // over you. The month goes first; the week is not asked for, so it is not
    // marked shown either, and simply arrives on the next open that week.
    if (!monthly) weekly = await pendingWeeklySummary();
  }

  onMount(() => {
    void checkSummaries();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void checkSummaries();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  });

  $effect(() => {
    void $dayQ;
    canUnlockOneMore().then((v) => (unlockAvailable = v));
  });

  async function onComplete(todo: Todo) {
    // Before the await: the burst is a response to the tap, and a celebration
    // that arrives after a round trip to the database reads as a glitch.
    celebrate(todo.id);
    await completeTodo(todo.id);
    // The day closes the instant the third slot is done — before any "one
    // more?" is offered. That ordering is the whole mechanic (spec 5.3).
    if (await maybeCloseDay()) showClose = true;
  }

  /**
   * The way back from a mis-tap.
   *
   * `uncompleteTodo` has existed in store.ts since the beginning — labelled
   * "Undo, for a mis-tap" — and NOTHING called it, so a tick landed on by
   * accident was permanent. Reported exactly that way.
   *
   * No celebration on the way out, obviously, and the day reopens if that tap
   * was the third: closing is a consequence of the tick, so undoing the tick
   * undoes it too.
   */
  async function onUndo(todo: Todo) {
    await uncompleteTodo(todo.id);
    await reopenDayIfIncomplete();
  }

  async function pick(todo: Todo) {
    try {
      await addToDay(todo.id);
      picking = false;
    } catch (err) {
      // A fourth item is impossible, not discouraged. If we land here the UI
      // should already have hidden the affordance, so this is a backstop.
      if (!(err instanceof DayFullError)) throw err;
    }
  }

  const slotTodos = $derived(($slotTodosQ as Todo[] | undefined) ?? []);
  const day = $derived($dayQ as Day | undefined);
  /**
   * Falls back to the full three, not to zero, while the day record is still
   * loading — a day that does not exist yet has all of it free. Zero was
   * harmless when this only gated a button, and stopped being harmless the
   * moment it also told the Free Time flow how many slots to plan.
   */
  const roomLeft = $derived(day ? day.unlockedCount - day.slots.length : STARTING_SLOTS);

  /**
   * Tomorrow, read only so the "Tomorrow" action knows whether it can land.
   *
   * The three are three on every day, not just this one. With tomorrow already
   * full the button is hidden rather than shown and refused — offering an
   * action that cannot happen is the thing this app keeps getting told off for
   * — and the × is still there, which puts the to-do back in its project where
   * it will resurface through the neglected slot anyway.
   */
  const tomorrowQ = liveQuery(() => db.days.where('date').equals(tomorrow()).first());
  const tomorrowDay = $derived($tomorrowQ as Day | undefined);
  const tomorrowRoom = $derived(
    tomorrowDay ? tomorrowDay.unlockedCount - tomorrowDay.slots.length : STARTING_SLOTS
  );

  async function pushToTomorrow(id: string) {
    try {
      await addToDay(id, tomorrow());
    } catch (err) {
      // The cap lives in data and two devices share a day, so this is reachable
      // even with the button hidden when it is known to be full. Leaving it on
      // today is the safe end of losing that race.
      if (err instanceof DayFullError) return;
      throw err;
    }
    await removeFromDay(id);
  }
  const doneCount = $derived(slotTodos.filter((t) => t.completedAt).length);
  const todoIndex = $derived(indexById(($openQ as { all: Todo[] } | undefined)?.all ?? []));
  /**
   * Blocked to-dos are SHOWN here, with what they are waiting for, and are not
   * filtered out. Free Time is the app making a suggestion, so it withholds
   * them; this is you choosing your own three, and the app does not get a veto
   * on that. It just makes sure you can see what you are picking.
   */
  const habits = $derived(($habitsQ as Habit[] | undefined) ?? []);
  const weekLogs = $derived(($logsWeekQ as HabitLog[] | undefined) ?? []);
  const habitsDone = $derived(
    new Set(weekLogs.filter((l) => l.date === today()).map((l) => l.habitId))
  );
  /** Each habit's week so far — see habits.ts for why it counts up, never down. */
  const weekByHabit = $derived.by(() => {
    const dates = new Map<string, string[]>();
    for (const l of weekLogs) {
      const list = dates.get(l.habitId);
      if (list) list.push(l.date);
      else dates.set(l.habitId, [l.date]);
    }
    return new Map(habits.map((h) => [h.id, habitWeek(h, dates.get(h.id) ?? [])]));
  });
  /**
   * DONE FOR NOW — which is not the same question as "done today" once a habit
   * has a rhythm. A weekly habit that has had its three is settled for the rest
   * of the week: it sinks and it stops waving, which is the entire point of
   * giving it a rhythm. A daily one settles exactly as before.
   */
  const habitSettled = (h: Habit) => habitsDone.has(h.id) || !!weekByHabit.get(h.id)?.met;

  /**
   * Every-day habits and the ones with a rhythm, drawn as two groups.
   *
   * They are ONE concept — a rhythm is a field on a habit, not a second kind
   * of thing — but they read differently in a single row: an every-day habit
   * sitting un-ticked means today, and a three-times-a-week one sitting
   * un-ticked on a Tuesday means very little. Split only when both exist,
   * because a heading over the only group there is costs a line of the calmest
   * screen in the app and says nothing.
   */
  const dailyHabits = $derived(habits.filter((h) => !h.timesPerWeek));
  const weeklyHabits = $derived(habits.filter((h) => !!h.timesPerWeek));
  const split = $derived(dailyHabits.length > 0 && weeklyHabits.length > 0);

  /**
   * ONE DRAG INSTANCE PER GROUP, because a single one would read the two lists
   * as one continuous column (it orders by document position) and let a habit
   * be dragged under the other heading — which would move it on screen and
   * change nothing about it, so it would snap back on the next render.
   *
   * Each commits the WHOLE order with its own group rearranged in place, so
   * `Habit.order` stays a total order across both and the groups cannot
   * interleave.
   */
  const dailyDrag = new Reorder(
    (ids) => reorderHabits([...ids, ...weeklyHabits.map((h) => h.id)]),
    'xy'
  );
  const weeklyDrag = new Reorder(
    (ids) => reorderHabits([...dailyHabits.map((h) => h.id), ...ids]),
    'xy'
  );

  /**
   * Everything on this screen that is still waiting, to-dos and habits in ONE
   * rotation. Separate rotations would mean two things waving at once, which
   * is a busy screen rather than a live one.
   */
  const waiting = $derived([
    ...slotTodos.filter((t) => !t.completedAt).map((t) => t.id),
    ...habits.filter((h) => !habitSettled(h)).map((h) => h.id)
  ]);

  onMount(() => {
    const timer = setInterval(() => {
      // Nothing animates in a tab nobody is looking at.
      if (document.visibilityState !== 'visible') return;
      // A closed day has nothing to wave about; so has a finished one.
      if (day?.closedAt || !waiting.length) {
        nudged = null;
        return;
      }
      castDino();
      nudged = waiting[turn % waiting.length] ?? null;
      turn++;
      setTimeout(() => (nudged = null), NUDGE_FOR);
    }, NUDGE_EVERY);
    return () => clearInterval(timer);
  });

  /**
   * TODAY'S LIST: to-dos DATED today that are not among the three.
   *
   * Reported as *"I just added some to-dos from the brain area and added them
   * for today, but they don't appear on the today page. That seems like a
   * mistake no?"* — and it was. Brain's day list and its "Today" chip set a
   * DATE, while this screen only ever drew the three SLOTS, and the two were
   * kept apart on purpose: three is the day's ceiling (spec 5.3), and "all the
   * things I need to do today" is a longer list than that. Keeping them apart
   * was right; keeping the day list OFF the screen called Today was not. A
   * list you wrote for today, missing from Today, reads as lost.
   *
   * So it is shown here, UNDER the three and separate from them. It does not
   * count towards closing the day, does not take a slot, and does not join
   * the waving rotation — the three stay the three, and this is the rest of
   * what you said about today. Only today's date: yesterday's list does not
   * follow you forward, because that would be an overdue pile by another name.
   * Ticked ones stay, ticked, in order — completed work is never hidden.
   */
  const todayIso = today();
  const dayList = $derived(
    (($openQ as { all: Todo[] } | undefined)?.all ?? [])
      .filter((t) => t.date === todayIso && !day?.slots.includes(t.id))
      // In the order it was dragged into (Day.listOrder), then oldest first —
      // the same order Brain's day list uses. Ticked ones sink below that at
      // render (`sinkDone`), without touching the stored order.
      .sort(byDayList(day?.listOrder))
  );
  const listDrag = new Reorder((ids) => reorderDayList(ids));

  /**
   * The shopping list shows on Today only on its day AND while something is
   * still to get. An empty list planned for today sat there as "Shopping list
   * — nothing on it yet", which is a line about nothing: *"if there is nothing
   * in the shopping list, it shouldn't stay on the Today page."* Everything
   * bought counts as nothing left, too — the trip is done.
   */
  const toGetQ = liveQuery(async () => (await db.buyItems.toArray()).filter(onList).length);
  const shoppingToday = $derived(!!day?.shopping && (($toGetQ as number | undefined) ?? 0) > 0);
  const dayListOpen = $derived(dayList.filter((t) => !t.completedAt).length);

  const candidates = $derived(
    (($openQ as { open: Todo[] } | undefined)?.open ?? [])
      .filter((t) => !day?.slots.includes(t.id))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
  );

  /**
   * How the picker is arranged.
   *
   * It was a flat list of bare titles, newest first — fine at five to-dos and
   * useless at fifty: nothing on a row said which era it belonged to or how big
   * it was, so choosing meant recognising every title from memory. These are
   * the three questions actually being asked at this moment — what am I working
   * on, what fits the time I have, what have I got the head for — plus the
   * order it always had.
   *
   * Local state, not stored: same as the buy list's grouping. Which way you
   * last sorted a picker is not worth a write or a sync.
   */
  type PickOrder = 'recent' | 'era' | 'time' | 'effort';
  const PICK_ORDERS = [
    { key: 'recent', label: 'Recent' },
    { key: 'era', label: 'Era' },
    { key: 'time', label: 'Time' },
    { key: 'effort', label: 'Head' }
  ] as const;
  let pickOrder = $state<PickOrder>('recent');

  const eraOf = (id?: string) =>
    (($projectsQ as Project[] | undefined) ?? []).find((p) => p.id === id);
  const projectName = (id?: string) => eraOf(id)?.name;

  /**
   * The colour of the project a to-do belongs to, or nothing.
   *
   * The same colour that project already wears on the era page and at the top
   * of its own screen — assigned once and derived everywhere, so a to-do never
   * carries a colour of its own that could disagree with it. An era-level to-do
   * has no project and so has no colour; the dot is still rendered, in
   * transparent, because a ragged left edge is harder to read down than an
   * occasional gap.
   */
  const todoColor = (t: Todo): string | undefined => {
    if (!t.tag) return undefined;
    const era = eraOf(t.projectId);
    return era ? projectTagColor(era.tags, era.tagColors, t.tag) : undefined;
  };

  /** The line under a title: where it lives and how big it is. */
  const pickFootnote = (t: Todo): string =>
    [
      projectName(t.projectId),
      t.tag,
      t.takes && durationLabel(t.takes),
      t.energy && energyLabel(t.energy)
    ]
      .filter(Boolean)
      .join(' · ');

  /**
   * The picker's rows, in groups with headings.
   *
   * Grouped rather than merely sorted, because a heading answers "what am I
   * looking at" without having to compare two rows to work it out — the same
   * reasoning as the buy list's shops. Recent keeps one unlabelled group, since
   * a heading over everything says nothing.
   *
   * Empty groups are dropped: a picker lists what you can choose, and a heading
   * with nothing under it is an invitation to wonder what is missing.
   */
  const pickGroups = $derived.by((): { key: string; label: string; todos: Todo[] }[] => {
    const all = candidates;
    if (pickOrder === 'recent') return [{ key: 'all', label: '', todos: all }];

    if (pickOrder === 'time') {
      return [
        ...DURATIONS.map((d) => ({
          key: d.key,
          label: d.label,
          todos: all.filter((t) => t.takes === d.key)
        })),
        { key: 'unsized', label: 'Length not set', todos: all.filter((t) => !t.takes) }
      ].filter((g) => g.todos.length);
    }

    if (pickOrder === 'effort') {
      return [
        ...ENERGIES.map((e) => ({
          key: e.key,
          label: e.label,
          todos: all.filter((t) => t.energy === e.key)
        })),
        { key: 'unsized', label: 'Size not set', todos: all.filter((t) => !t.energy) }
      ].filter((g) => g.todos.length);
    }

    // By era, in the order the eras are listed, with the loose ones last —
    // untagged to-dos are a pile to sort rather than a place to work.
    const eras = ($projectsQ as Project[] | undefined) ?? [];
    return [
      ...eras.map((p) => ({
        key: p.id,
        label: p.name,
        todos: all.filter((t) => t.projectId === p.id)
      })),
      { key: 'none', label: 'Not in an era', todos: all.filter((t) => !t.projectId) }
    ].filter((g) => g.todos.length);
  });
</script>

<div class="flex h-full flex-col">
  <div class="flex-1 overflow-y-auto px-4 pt-safe">
    <header class="pt-3 pb-5">
      <!--
        Two ways out of the day for the things that do not belong to it: a
        note written down this second, and the shopping list. In the empty
        space beside the title, where Toon asked for them — small and round,
        so the day's own things are still what the page is about.
      -->
      <div class="flex items-center justify-between gap-3">
        <h1 class="large-title">Today</h1>
        <div class="flex shrink-0 items-center gap-2">
          <button
            type="button"
            class="press flex h-11 w-11 items-center justify-center rounded-full bg-surface-1 text-[20px]"
            onclick={() => (quickNotes = true)}
            aria-label="Quick notes"
          >
            📝
          </button>
          <ShoppingListButton look="icon" />
        </div>
      </div>
      <p class="footnote mt-1">
        {#if day?.closedAt}
          Day closed. {doneCount} done.
        {:else if slotTodos.length}
          {doneCount} of {slotTodos.length}
        {:else if dayList.length}
          {dayListOpen} on today's list.
        {:else}
          Nothing planned yet.
        {/if}
      </p>
    </header>

    <!--
      Every section on this page says what it is now. Habits had a heading and
      the other two did not, so the calendar strip and the day's three ran into
      each other as one undifferentiated column — asked for directly. The
      calendar's heading lives inside the component, because the component is
      what knows whether there is anything to show, and a heading over nothing
      is worse than no heading.
    -->
    <CalendarStrip />

    <section>
      {#if slotTodos.length}
        <h2 class="section-label mb-2">To-dos</h2>
      {/if}
      <div class="space-y-3">
      {#each slotDrag.arrange(sinkDone(slotTodos, (t) => !!t.completedAt)) as todo (todo.id)}
        <!--
          Tinted like Brain's rows — the same two colours from the same helper,
          so a to-do does not change colour between the screens. Only while it
          is open: a finished card turns green, and a project wash on top of
          that would bury the one colour on this page that carries meaning.
          The nudge still works over it: the walking dinosaur paints above the
          card's background and below its text, tint or no tint.
        -->
        {@const tint = todo.completedAt ? undefined : tintFor(eraOf(todo.projectId), todo.tag)}
        <div
          class="card rise p-4 transition-colors
                 {todo.completedAt ? 'border-good/30 bg-good/[0.06]' : ''}
                 {tint ? 'row-tint' : ''}"
          style:--row={tint?.fill}
          style:--edge={tint?.edge}
          use:slotDrag.item={todo.id}
          animate:flip={{ duration: slotDrag.dragging === todo.id ? 0 : 180 }}
          class:nudge={nudged === todo.id}
          style:--dino-src={nudged === todo.id ? dinoSrc : undefined}
          style:--dino-face={nudged === todo.id ? dinoFace : undefined}
          style:--dino-dir={nudged === todo.id ? dinoDir : undefined}
        >
          <div class="flex items-start gap-3">
            <!-- relative, so the burst can be centred on the tick rather than
                 on the card: the tick is where the eye already is. -->
            <span class="relative flex shrink-0">
              {#if celebrating === todo.id}
                <Burst />
              {/if}
              <button
                class="press tap flex shrink-0 items-center justify-center rounded-full border-2
                       {todo.completedAt ? 'border-good bg-good text-ink-950' : 'border-ink-600'}"
                class:nudge-ring={nudged === todo.id}
                class:tick-pop={celebrating === todo.id}
                style="width:44px;height:44px"
                onclick={() => (todo.completedAt ? onUndo(todo) : onComplete(todo))}
                aria-label={todo.completedAt
                  ? `Mark ${todo.title} not done`
                  : `Complete ${todo.title}`}
              >
                {#if todo.completedAt}✓{/if}
              </button>
            </span>
            <div class="min-w-0 flex-1">
              <p class="body {todo.completedAt ? 'text-ink-400 line-through' : ''}">
                {todo.title}
              </p>

              {#if !todo.completedAt}
                <!--
                  ON THEIR OWN LINE, AND NAMED.

                  "Tomorrow" beside the × cost about eighty pixels of the title,
                  which put a medium-length one onto three lines; two bare
                  glyphs instead would have been the row of unlabelled symbols
                  this app has already been told off for once. A line of its own
                  costs a few pixels of height and buys both back.

                  "Tomorrow instead" moves the to-do into TOMORROW'S three
                  rather than dating it. A date is for a real commitment —
                  something you promised someone — and it would take the
                  obligation slot from then on; "I'll do it tomorrow" is a plan,
                  and the day's slots are where plans live. Tomorrow it is
                  simply already there.

                  Nothing counts how often either is tapped. Rain three days
                  running and it moves three times, with no record of having
                  been moved.
                -->
                <div class="-ml-2 mt-1 flex items-center gap-1">
                  {#if tomorrowRoom > 0}
                    <button
                      class="press tap-h rounded-lg px-2 text-xs text-ink-400"
                      onclick={() => pushToTomorrow(todo.id)}
                    >
                      Tomorrow instead
                    </button>
                  {/if}
                  <!-- Skippable without ceremony: no confirm, no guilt copy. -->
                  <button
                    class="press tap-h rounded-lg px-2 text-xs text-ink-400"
                    onclick={() => removeFromDay(todo.id)}
                  >
                    Not today
                  </button>
                </div>
              {:else}
                <!--
                  Tapping the green tick again undoes it, which is where the
                  hand already is — but nothing on screen said so, and "how do
                  I reverse this" is not a question anyone should have to ask
                  twice. Named, for the same reason "Tomorrow instead" is.
                -->
                <div class="-ml-2 mt-1 flex items-center gap-1">
                  <button
                    class="press tap-h rounded-lg px-2 text-xs text-ink-400"
                    onclick={() => onUndo(todo)}
                  >
                    Not done after all
                  </button>
                </div>
              {/if}
            </div>
            {#if todo.image}
              <!-- Opposite the tick, and smaller than it, so a card with a
                   photo is exactly as tall as one without. This is the screen
                   that has to stay calm. -->
              <PhotoThumb image={todo.image} label={todo.title} />
            {/if}
          </div>
        </div>
      {/each}
      </div>
    </section>

    {#if !slotTodos.length && !picking}
      <!-- The single prominent button when the day is empty (spec 4.1). It
           opens the full flow; the smaller picker below is only for adding one
           more to a day that already exists. -->
      <!--
        The dinosaur asks. It is the same animal as the icon on the home screen,
        so the thing that got you here is the thing that greets you — and a
        question is a friendlier prompt than a label, given the answer is
        genuinely yours. It sits inside the circle as a silhouette rather than in
        full colour: three greens on an orange gradient is a fight, and at this
        size the shape is the recognisable part anyway.
      -->
      <!--
        Smaller than it was. At 64% of the width with a max of 264 it pushed
        Habits below the capture bar on an iPhone — reported exactly that way —
        and a hero that hides the rest of the screen has stopped being a hero.
        It is still by a distance the largest thing on an empty day.
      -->
      <div class="mt-5 flex justify-center">
        <button
          class="press relative flex aspect-square w-[48%] max-w-[196px] min-w-[150px]
                 items-center justify-center overflow-hidden rounded-full"
          style="background: linear-gradient(135deg, {scene.from}, {scene.to});
                 color: {scene.ink};
                 box-shadow: 0 10px 34px -12px {scene.to}"
          onclick={() => (freeTime = true)}
        >
          <!--
            Scenery: behind the dinosaur, then in front of it, both drawn in a
            100x100 space over the button.

            {@html} is safe here and only here: the markup is a constant in
            freeTimeScenes.ts, written by us and never touched by user input or
            anything off the network. If a scene ever becomes something a person
            can define, this has to stop being @html.
          -->
          {#if scene.behind}
            <svg viewBox="0 0 100 100" class="pointer-events-none absolute inset-0 h-full w-full"
              aria-hidden="true">{@html scene.behind}</svg>
          {/if}

          <!-- Nudged up, so the bottom of the circle is free for scenery at
               ground level without it running through the words. -->
          <span class="relative z-10 flex -translate-y-[6%] flex-col items-center gap-1">
            <span class="opacity-85"><Dino size={76} tone="mono" /></span>
            <span class="text-[1.375rem] font-semibold">Free time?</span>
          </span>

          {#if scene.front}
            <svg viewBox="0 0 100 100" class="pointer-events-none absolute inset-0 z-20 h-full w-full"
              aria-hidden="true">{@html scene.front}</svg>
          {/if}
        </button>
      </div>
      <!-- The dinosaur gets a line. Below the circle rather than inside it: the
           button has to stay one clear thing to press, and there is a screen
           full of room down here. -->
      <p class="mx-auto mt-3 max-w-[19rem] text-center text-[14px] italic text-ink-400">
        {quip}
      </p>

      <!--
        The other way in, for when you already know.
        Free Time asks how long you have and what your head is like before it
        suggests anything, which is the right tool for "what should I do?" and
        the wrong one for "today I am varnishing the campervan". Until this
        existed, an empty day had NO route into the three except that flow —
        the picker below only appears once the day already has something in it,
        so the one case where you most need to put something in was the one
        case you could not.
        Quiet and secondary on purpose: the button above is still the answer
        most days, and this is not a second hero.
      -->
      <div class="mt-3 flex justify-center">
        <!--
          A pill with accent text, NOT muted grey prose. The first version was
          grey and started with "Or", which made it read as a caption under the
          button above — found by accident rather than by looking, and reported
          that way. Quiet is right for a secondary action; invisible is not, and
          the difference is whether it looks like something you can press.
          Same lesson as the add button that had to stop being grey-on-grey.
        -->
        <button
          class="press tap rounded-full bg-surface-1 px-5 text-sm font-medium text-accent"
          onclick={() => (picking = true)}
        >
          Pick something yourself
        </button>
      </div>

    {:else if roomLeft > 0 && !picking}
      <!--
        BOTH ways in, not just the manual one. The questionnaire used to vanish
        the moment the day had a single item on it, because accepting a plan
        replaced the whole day and offering that mid-day would have wiped it.
        FreeTime fills only the free slots now, so there is nothing to protect
        against and no reason to hide it.
      -->
      <div class="mt-4 flex gap-2">
        <button
          class="press flex-1 rounded-2xl border border-dashed border-line-2 py-4 text-ink-400"
          onclick={() => (freeTime = true)}
        >
          Free time?
        </button>
        <button
          class="press flex-1 rounded-2xl border border-dashed border-line-2 py-4 text-ink-400"
          onclick={() => (picking = true)}
        >
          {#if day?.closedAt}One more?{:else}Add ({roomLeft} left){/if}
        </button>
      </div>
    {:else if unlockAvailable}
      <!-- Only reachable on an already-closed day, one at a time, never
           visible in advance. -->
      <button
        class="press mt-4 w-full rounded-2xl border border-good/40 py-4 text-good"
        onclick={() => unlockOneMore()}
      >
        One more?
      </button>
    {/if}

    {#if picking}
      <section class="card mt-4 p-3">
        <div class="mb-2 flex items-center justify-between">
          <h2 class="section-label">Pick something</h2>
          <button class="press tap px-2 text-sm text-accent" onclick={() => (picking = false)}>Done</button>
        </div>
        {#if candidates.length}
          <!-- Four ways to look at the same list. Which one you want depends on
               the question in your head right now, and all four of those
               questions are real ones. -->
          <div class="segmented mb-2">
            {#each PICK_ORDERS as o (o.key)}
              <button
                class="press segment {pickOrder === o.key ? 'segment-on' : ''}"
                onclick={() => (pickOrder = o.key)}
              >
                {o.label}
              </button>
            {/each}
          </div>

          <div class="max-h-72 overflow-y-auto">
            {#each pickGroups as group (group.key)}
              {#if group.label}
                <p class="section-label mt-3 mb-1 first:mt-0">{group.label}</p>
              {/if}
              <ul class="space-y-1">
                {#each group.todos.slice(0, 50) as todo (todo.id)}
                  {@const waiting = blockerOf(todo, todoIndex)}
                  <li>
                    <button
                      class="press tap flex w-full items-start gap-2.5 rounded-xl px-3 py-2 text-left text-ink-50"
                      onclick={() => pick(todo)}
                    >
                      <!-- The project's own colour, the same one it wears on the
                           era page and at the top of its own screen. Down the
                           leading edge rather than inside the footnote: a column
                           of dots is scannable, and dots at varying x positions
                           mid-sentence are not. -->
                      <span
                        class="mt-[7px] h-2 w-2 shrink-0 rounded-full"
                        style="background: {todoColor(todo) ?? 'transparent'}"
                      ></span>
                      <span class="min-w-0 flex-1">
                        <span class="block {waiting ? 'text-ink-400' : ''}">{todo.title}</span>
                        <!-- Where it lives and how big it is. Without this the row
                             is a bare title, and choosing means recognising every
                             one of them from memory. -->
                        {#if waiting || pickFootnote(todo)}
                          <span class="footnote block">
                            {[waiting ? `after ${waiting.title}` : null, pickFootnote(todo)]
                              .filter(Boolean)
                              .join(' · ')}
                          </span>
                        {/if}
                      </span>
                    </button>
                  </li>
                {/each}
              </ul>
            {/each}
          </div>
        {:else}
          <p class="px-2 py-3 text-sm text-ink-400">
            Nothing open yet. Capture something below — the box is always hungry.
          </p>
        {/if}
      </section>
    {/if}

    {#if dayList.length || shoppingToday}
      <!-- Everything else you put on today, from Brain's day list. See
           `dayList` for why it is here and why it is not part of the three. -->
      <section class="mt-8">
        <h2 class="section-label mb-2">Also on today's list</h2>
        {#if shoppingToday}
          <!-- The shopping list, on the day it was planned for. Not a slot and
               not a to-do: it is a list, and it opens as one. -->
          <div class="mb-1"><ShoppingListButton look="row" /></div>
        {/if}
        {#if cleared === 'list'}{@render clearedLine("That's the list clear.")}{/if}
        <ul class="space-y-1">
          {#each listDrag.arrange(sinkDone(dayList, (t) => !!t.completedAt)) as t (t.id)}
            {@const tint = t.completedAt ? undefined : tintFor(eraOf(t.projectId), t.tag)}
            <li
              class="card-flat flex items-center gap-3 px-3 {tint ? 'row-tint' : ''}"
              style:--row={tint?.fill}
              style:--edge={tint?.edge}
              use:listDrag.item={t.id}
              animate:flip={{ duration: listDrag.dragging === t.id ? 0 : 180 }}
            >
              <span class="relative flex shrink-0">
                {#if celebrating === t.id}
                  <Burst size={96} />
                {/if}
                <button
                  class="press tap shrink-0 {t.completedAt ? 'text-good' : 'text-ink-400'}"
                  onclick={() => {
                    if (t.completedAt) void uncompleteTodo(t.id);
                    else {
                      celebrate(t.id);
                      // The last one still open, and nothing left to go and
                      // buy: this tap clears the section.
                      if (dayListOpen === 1 && !shoppingToday) cheerSection('list');
                      void completeTodo(t.id);
                    }
                  }}
                  aria-label={t.completedAt ? `Mark ${t.title} not done` : `Complete ${t.title}`}
                  >{t.completedAt ? '✓' : '○'}</button
                >
              </span>
              <div class="min-w-0 flex-1 py-3">
                <p class={t.completedAt ? 'text-ink-400 line-through' : ''}>{t.title}</p>
                {#if projectName(t.projectId)}
                  <p class="text-xs text-ink-400">
                    {[projectName(t.projectId), t.tag].filter(Boolean).join(' · ')}
                  </p>
                {/if}
              </div>
              {#if t.image}
                <PhotoThumb image={t.image} label={t.title} />
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/if}

    <!-- Active habits: large physical tap targets, immediate visual response.
         No streaks, no counts, no percentage. -->
    {#if ($habitsQ as Habit[] | undefined)?.length}
      <section class="mt-8">
        <!-- Where to change them: the list on Me, where each opens to its
             name, colour, state and delete. Said here because this is where
             the habits are looked at, and it was not findable from here. -->
        <div class="mb-2 flex items-center justify-between">
          <h2 class="section-label">Habits</h2>
          <a href="{base}/me" class="press tap-h inline-flex items-center px-1 text-[13px] text-ink-400">Edit</a>
        </div>

        <!--
          TWO GROUPS WHEN THERE ARE TWO KINDS, asked for after a habit could be
          given a rhythm: *"habits are daily things, goals are weekly things
          you want to do."* That is one concept, not two (see CLAUDE.md), but
          they do read differently in a single row — an every-day habit
          un-ticked means today, and a three-times-a-week one un-ticked means
          almost nothing on a Tuesday.
          Headed only when BOTH kinds exist. One heading over the only group
          there is says nothing and takes a line of the calmest screen in the
          app to say it.
        -->
        {#if cleared === 'habits'}{@render clearedLine('Every habit, done.')}{/if}

        {#if split}
          <p class="footnote mb-1.5">Every day</p>
          <div class="mb-4 flex flex-wrap gap-2">{@render chips(dailyHabits, dailyDrag)}</div>
          <p class="footnote mb-1.5">This week</p>
          <div class="flex flex-wrap gap-2">{@render chips(weeklyHabits, weeklyDrag)}</div>
        {:else}
          <div class="flex flex-wrap gap-2">{@render chips(habits, habitDrag)}</div>
        {/if}
      </section>
    {/if}

    <!-- Room for the floating assistant button to sit over, so the last habit
         is never underneath it. -->
    <div class="h-20"></div>
  </div>
</div>


{#if showClose}
  <DayClose onDismiss={() => (showClose = false)} />
{/if}

{#if quickNotes}
  <QuickNotes onclose={() => (quickNotes = false)} />
{/if}

{#if freeTime}
  <!-- How many slots it may fill. Three on an empty day, which is the plan-the
       -whole-day case it has always been; fewer once something is on the day,
       where it tops up instead of replacing. -->
  <FreeTime room={roomLeft} onDone={() => (freeTime = false)} />
{/if}



{#snippet clearedLine(text: string)}
  <!--
    The moment a whole list is finished off.

    The first version was one green line of words and came back as *"that's
    kind of boring. Make it fun!"* — the same note the finished-project card
    got, so it gets the same answer: a real dinosaur and a line about what the
    dinosaur is doing (clearCheers.ts).

    SCALED FOR A TUESDAY, though. The finish card is a whole screen and four
    seconds of confetti because finishing a project is rare; clearing today's
    list is not, and a full-screen interruption every evening would be the app
    talking over you. So it sits inside its own section, the animal is small,
    and the whole thing leaves again after six seconds.

    The sticker keeps its tinted ground for the reason stickers.ts gives: the
    artwork has near-black outlines and loses them against a near-black page.
  -->
  <div
    class="relative mb-2 flex items-center gap-3 rounded-2xl bg-surface-1 p-3"
    role="status"
    aria-live="polite"
  >
    <div class="pointer-events-none absolute top-1/2 left-8 -translate-x-1/2 -translate-y-1/2">
      <Burst size={150} />
    </div>
    {#if clearCheer}
      <div
        class="relative h-14 w-14 shrink-0 rounded-2xl p-1.5"
        style="background: linear-gradient(150deg, color-mix(in srgb, var(--color-brand-1) 30%, white), color-mix(in srgb, var(--color-brand-1) 58%, white))"
      >
        <img
          src={stickerUrl(clearCheer.sticker)}
          alt={clearCheer.sticker.label}
          class="h-full w-full object-contain"
        />
      </div>
    {/if}
    <div class="min-w-0 flex-1">
      <p class="text-[15px] font-medium text-good">{text}</p>
      {#if clearCheer}
        <p class="footnote mt-0.5 italic">{clearCheer.cheer.line}</p>
      {/if}
    </div>
  </div>
{/snippet}

{#snippet chips(list: Habit[], drag: Reorder)}
  {#each drag.arrange(sinkDone(list, habitSettled)) as habit (habit.id)}
            {@const done = habitsDone.has(habit.id)}
            {@const week = weekByHabit.get(habit.id)}
            {@const hc = habitColor(habit)}
            <!--
              In the habit's own colour — *"they look bland while they should
              look inviting"* — but the colour must never be what says DONE.
              The first version washed waiting habits in their colour and
              filled done ones, and a row of different colours read as some
              already ticked: *"it looks like some are ticked off when the
              colours are different."* So the question "done?" is answered by
              a TICK CIRCLE, the same shape as a to-do's. Waiting: a LIGHT tint
              of the colour with an empty ring in it. Done: the card FULLY in
              its colour, with a white circle and a ✓. (A plain grey waiting
              chip was tried for an hour and was "bland" again — the tint was
              never the problem, the missing circle was.) Colour says which
              habit, the circle says whether, and the light/full contrast
              backs the circle up.

              TWO QUESTIONS ONCE A HABIT HAS A RHYTHM, and they are answered by
              two different parts of the chip. THE CIRCLE IS ALWAYS "TODAY" —
              it is what the tap does, and a tap must always be visible. THE
              FILL ANSWERS THE HABIT'S OWN QUESTION: for a daily habit that
              question is "today?", so the two coincide exactly as before; for
              one meant three times a week it is "this week?", so the chip
              fills when the third is logged and stays filled for the rest of
              the week, whether or not today was one of them. The line
              underneath says which week state it is in, in words, so there is
              nothing to infer from the colours — the mistake above, made once.
            -->
            {@const filled = week?.weekly ? week.met : done}
            <button
              class="press tap relative flex items-center gap-2.5 rounded-2xl border py-2.5 pr-4 pl-3 text-[15px] font-medium transition-colors"
              style:background={filled ? hc : `color-mix(in srgb, ${hc} 16%, var(--color-surface-1))`}
              style:border-color={filled ? hc : `color-mix(in srgb, ${hc} 40%, transparent)`}
              style:color={filled ? ON_COLOR : 'var(--color-ink-50)'}
              use:drag.item={habit.id}
              animate:flip={{ duration: drag.dragging === habit.id ? 0 : 180 }}
              class:nudge={nudged === habit.id}
              style:--dino-src={nudged === habit.id ? dinoSrc : undefined}
              style:--dino-face={nudged === habit.id ? dinoFace : undefined}
              style:--dino-dir={nudged === habit.id ? dinoDir : undefined}
              class:tick-pop={celebrating === habit.id}
              aria-pressed={done}
              aria-label={[
                habit.name,
                done ? 'done today' : 'log for today',
                week?.weekly ? week.label.toLowerCase() : null
              ]
                .filter(Boolean)
                .join(', ')}
              onclick={() => {
                // Only on the way IN. Unticking something is a correction, and
                // confetti for a correction is the app being pleased about the
                // wrong thing.
                if (!done) celebrate(habit.id);
                // Settled covers both kinds: done today for an every-day
                // habit, and the week's rhythm kept for one that has a rhythm.
                if (!done && habits.filter((h) => !habitSettled(h)).length === 1) {
                  cheerSection('habits');
                }
                void toggleHabitLog(habit.id).then((logged) => {
                  // After the write, so the hundredth is counted as the
                  // hundredth. The burst above has already played; this lands
                  // on top of it, which is the right order for a rare thing.
                  if (logged) void checkMilestone(habit);
                });
              }}
            >
              {#if celebrating === habit.id}
                <Burst size={108} />
              {/if}
              <span
                class="flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-2 text-[13px] leading-none font-bold transition-colors"
                style:border-color={done
                  ? filled
                    ? 'white'
                    : hc
                  : filled
                    ? `color-mix(in srgb, ${ON_COLOR} 45%, transparent)`
                    : hc}
                style:background={done ? (filled ? 'white' : hc) : 'transparent'}
                style:color={done && !filled ? 'white' : hc}
                aria-hidden="true"
              >{done ? '✓' : ''}</span>
              <span class="flex flex-col items-start leading-tight">
                {habit.name}
                <!--
                  Only ever what has happened — "2 this week", never "2 of 3".
                  The rhythm itself is on the habit's own page; nothing here
                  counts down to it, and a week that ends short is never
                  mentioned. See habits.ts for why that line matters.
                -->
                {#if week?.weekly}
                  <span class="text-[11px] font-normal opacity-70">{week.label}</span>
                {/if}
              </span>
            </button>
  {/each}
{/snippet}

{#if milestone}
  <MilestoneCard
    milestone={milestone.m}
    habitName={milestone.name}
    color={milestone.color}
    onclose={() => (milestone = null)}
  />
{/if}

{#if monthly}
  <MonthlySummary summary={monthly} onDismiss={() => (monthly = null)} />
{:else if weekly}
  <WeeklySummary summary={weekly} onDismiss={() => (weekly = null)} />
{/if}
