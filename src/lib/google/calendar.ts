import { getAccessToken } from './auth';
import { today } from '../store';

/**
 * Google Calendar, read-only (spec 4.1, phase 8).
 *
 * Deliberately the last thing built and the smallest: the user's calendar
 * already works fine in Google, so this exists only to answer "what does today
 * already have in it" before deciding what else to take on. It never writes,
 * never links out, and is not interactive.
 */

const API = 'https://www.googleapis.com/calendar/v3';

export interface CalendarEvent {
  id: string;
  summary: string;
  /** Local HH:MM, or undefined for an all-day event. */
  time?: string;
  allDay: boolean;
}

interface RawEvent {
  id: string;
  summary?: string;
  status?: string;
  start?: { dateTime?: string; date?: string };
}

/** Cached for the session so switching tabs doesn't re-hit the API. Keyed by
 *  date so it expires naturally at midnight. */
let cache: { date: string; events: CalendarEvent[] } | null = null;

function localTime(iso: string): string {
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/**
 * Today's events, or an empty list.
 *
 * Never throws. A calendar that cannot be reached simply isn't shown — it is
 * the least essential thing on the screen, and an error message about it would
 * be worse than its absence.
 */
export async function todaysEvents(): Promise<CalendarEvent[]> {
  const date = today();
  if (cache?.date === date) return cache.events;

  const token = await getAccessToken();
  if (!token || !navigator.onLine) return [];

  try {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setDate(end.getDate() + 1);

    const params = new URLSearchParams({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      // singleEvents expands a recurring series into its individual instances;
      // without it a weekly event comes back as one rule, not today's copy.
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '20'
    });

    const res = await fetch(`${API}/calendars/primary/events?${params}`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return [];

    const items: RawEvent[] = (await res.json()).items ?? [];
    const events = items
      .filter((e) => e.status !== 'cancelled')
      .map((e) => ({
        id: e.id,
        summary: e.summary?.trim() || '(no title)',
        // An all-day event has `date` rather than `dateTime`.
        allDay: !e.start?.dateTime,
        time: e.start?.dateTime ? localTime(e.start.dateTime) : undefined
      }));

    cache = { date, events };
    return events;
  } catch {
    return [];
  }
}

/** Called after sign-out so a stale day doesn't linger on screen. */
export function clearCalendarCache(): void {
  cache = null;
}
