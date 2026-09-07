import { getAccessToken } from './auth';
import { today } from '../store';

/**
 * Google Calendar, read-only (spec 4.1, phase 8).
 *
 * Deliberately the smallest thing in the app: the calendar already works fine
 * in Google, so this exists only to answer "what does today already have in
 * it" before deciding what else to take on. It never writes, never links out,
 * and is not interactive.
 *
 * EVERY CALENDAR THE USER HAS TICKED, not just the primary one. It used to ask
 * `/calendars/primary/events` and nothing else, so an event on any calendar
 * made for a band, a client or a company simply never appeared — and there was
 * nothing on screen to suggest a whole category was missing rather than empty.
 * Reported exactly that way: one event showed up, a test event added to
 * another calendar did not.
 *
 * "Ticked" means `selected` in the calendar list, which is the same checkbox
 * that decides what shows in Google's own web UI. That is the rule worth
 * having: what you see there is what you see here, and it is adjusted in a
 * place that already exists rather than in a settings screen of ours. The
 * primary calendar is always included, ticked or not, since unticking your own
 * calendar and still wanting today's events out of it is not a real case.
 */

const API = 'https://www.googleapis.com/calendar/v3';

/** A sane ceiling. An account with more calendars than this has something
 *  automated going on, and thirty parallel requests to draw one strip is not a
 *  trade worth making. */
const MAX_CALENDARS = 12;

/**
 * How long today's events are trusted before being fetched again.
 *
 * The cache used to be keyed on the DATE alone and lived in a module variable,
 * which meant it expired at midnight and at no other time. On a phone where
 * the app is suspended rather than closed, that is days: adding an event in
 * Google and coming back here showed the same list as before, with no way to
 * make it look again. Five minutes is short enough that a test event turns up
 * while you are still wondering whether it will, and long enough that moving
 * between tabs costs nothing.
 */
const CACHE_MS = 5 * 60 * 1000;

export interface CalendarEvent {
  /** Composite: two calendars can hold the same event id. */
  id: string;
  summary: string;
  /** Local HH:MM, or undefined for an all-day event. */
  time?: string;
  allDay: boolean;
  /** Which calendar it came from — undefined for the primary one, where saying
   *  so would just be noise on every card. */
  calendar?: string;
  /** That calendar's own colour in Google, so the categories read the same
   *  here as they do there. */
  color?: string;
  /** Sort key only; never rendered. */
  startsAt: string;
}

export interface RawEvent {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
}

export interface RawCalendar {
  id: string;
  summary?: string;
  primary?: boolean;
  selected?: boolean;
  backgroundColor?: string;
}

let cache: { date: string; at: number; events: CalendarEvent[] } | null = null;

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

async function getJson<T>(url: string, token: string): Promise<T | null> {
  const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/** The calendars to read. Primary always; the rest only if ticked in Google. */
async function chosenCalendars(token: string): Promise<RawCalendar[]> {
  const params = new URLSearchParams({
    minAccessRole: 'reader',
    showHidden: 'false',
    maxResults: '250'
  });
  const list = await getJson<{ items?: RawCalendar[] }>(
    `${API}/users/me/calendarList?${params}`,
    token
  );
  // No list is not the same as no calendars: fall back to the primary one so a
  // permissions hiccup degrades to the old behaviour instead of a blank strip.
  if (!list?.items?.length) return [{ id: 'primary', primary: true }];

  return pickCalendars(list.items);
}

/** Primary always, plus whatever is ticked in Google's own list. Pure, so the
 *  rule that decides whether a whole category appears is pinned by a test. */
export function pickCalendars(items: RawCalendar[]): RawCalendar[] {
  return items.filter((c) => c.primary || c.selected === true).slice(0, MAX_CALENDARS);
}

/**
 * Raw Google events from ONE calendar, turned into what the strip renders.
 *
 * Pure and exported so the parts with actual decisions in them — what counts
 * as all-day, which calendar gets named, how two calendars' ids are kept
 * apart — are testable without a network.
 */
export function toEvents(cal: RawCalendar, items: RawEvent[]): CalendarEvent[] {
  return items
    .filter((e) => e.status !== 'cancelled')
    .map((e) => ({
      // Two calendars can hold the same event id, and a duplicate key would
      // drop one of them out of the {#each} without a word.
      id: `${cal.id}:${e.id}`,
      summary: e.summary?.trim() || '(no title)',
      // An all-day event has `date` rather than `dateTime`.
      allDay: !e.start?.dateTime,
      time: e.start?.dateTime ? localTime(e.start.dateTime) : undefined,
      calendar: cal.primary ? undefined : cal.summary,
      color: cal.primary ? undefined : cal.backgroundColor,
      // All-day events sort to the front of the day, which is where they
      // belong: they are the frame the timed ones sit inside.
      startsAt: e.start?.dateTime ?? `${e.start?.date ?? ''}T00:00`
    }));
}

/**
 * Everything from every calendar, as one list.
 *
 * The same thing on two calendars — being an attendee of an event that also
 * sits on a shared one — is ONE entry to a person reading a strip. Two genuine
 * events with the same title at the same minute would also collapse, which is
 * a trade worth making in a read-only strip and would not be in a list you act
 * on.
 */
export function mergeEvents(lists: CalendarEvent[][]): CalendarEvent[] {
  const seen = new Set<string>();
  return lists
    .flat()
    .filter((e) => {
      const key = `${e.summary}@${e.startsAt}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

async function eventsIn(cal: RawCalendar, token: string, start: Date, end: Date) {
  const params = new URLSearchParams({
    timeMin: start.toISOString(),
    timeMax: end.toISOString(),
    // singleEvents expands a recurring series into its individual instances;
    // without it a weekly event comes back as one rule, not today's copy.
    singleEvents: 'true',
    orderBy: 'startTime',
    maxResults: '20'
  });
  const data = await getJson<{ items?: RawEvent[] }>(
    `${API}/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
    token
  );
  return toEvents(cal, data?.items ?? []);
}

/**
 * Today's events, or an empty list.
 *
 * Never throws. A calendar that cannot be reached simply isn't shown — it is
 * the least essential thing on the screen, and an error message about it would
 * be worse than its absence.
 */
export async function todaysEvents(force = false): Promise<CalendarEvent[]> {
  const date = today();
  if (!force && cache?.date === date && Date.now() - cache.at < CACHE_MS) return cache.events;

  const token = await getAccessToken();
  if (!token || !navigator.onLine) return [];

  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const cals = await chosenCalendars(token);
    // One slow or forbidden calendar must not take the others with it.
    const settled = await Promise.allSettled(
      cals.map((c) => eventsIn(c, token, start, end))
    );

    const events = mergeEvents(
      settled.map((r) => (r.status === 'fulfilled' ? r.value : []))
    );

    cache = { date, at: Date.now(), events };
    return events;
  } catch {
    return [];
  }
}

/** Called after sign-out, and whenever a sync runs, so a stale day doesn't
 *  linger on screen. The next read fetches. */
export function clearCalendarCache(): void {
  cache = null;
}
