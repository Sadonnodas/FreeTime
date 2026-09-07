import { describe, it, expect } from 'vitest';
import { toEvents, mergeEvents, pickCalendars, type RawCalendar, type RawEvent } from './calendar';

/**
 * The strip used to read `/calendars/primary/events` and nothing else, so
 * events on a calendar made for a band or a client never appeared — and an
 * absent category looks exactly like an empty one. What is pinned here is the
 * rule that decides which calendars are read, and the merge that puts them
 * together.
 */
const cal = (over: Partial<RawCalendar> & { id: string }): RawCalendar => ({ ...over });
const ev = (over: Partial<RawEvent> & { id: string }): RawEvent => ({ ...over });

describe('which calendars are read', () => {
  it('takes the primary one and every ticked one', () => {
    const chosen = pickCalendars([
      cal({ id: 'me', primary: true }),
      cal({ id: 'band', summary: 'Band', selected: true }),
      cal({ id: 'companyx', summary: 'Company X', selected: true })
    ]).map((c) => c.id);

    expect(chosen).toEqual(['me', 'band', 'companyx']);
  });

  it('leaves out one that has been unticked in Google', () => {
    // The same checkbox that hides it from Google's own view hides it here.
    // That is the whole rule: one place to change it, and it already exists.
    const chosen = pickCalendars([
      cal({ id: 'me', primary: true }),
      cal({ id: 'holidays', summary: 'Holidays', selected: false })
    ]).map((c) => c.id);

    expect(chosen).toEqual(['me']);
  });

  it('keeps the primary even when it is not ticked', () => {
    expect(pickCalendars([cal({ id: 'me', primary: true })]).map((c) => c.id)).toEqual(['me']);
  });
});

describe('turning Google events into cards', () => {
  it('names the calendar and its colour, but not for the primary one', () => {
    const [mine] = toEvents(cal({ id: 'me', primary: true, summary: 'Me' }), [
      ev({ id: 'a', summary: 'Parcel', start: { date: '2026-09-08' } })
    ]);
    const [band] = toEvents(
      cal({ id: 'band', summary: 'Band', backgroundColor: '#7986cb' }),
      [ev({ id: 'a', summary: 'Rehearsal', start: { dateTime: '2026-09-08T19:00:00+02:00' } })]
    );

    // Saying "Me" on every card of your own calendar is noise.
    expect(mine.calendar).toBeUndefined();
    expect(band.calendar).toBe('Band');
    expect(band.color).toBe('#7986cb');
  });

  it('keeps the same event id on two calendars apart', () => {
    // A duplicate key drops one of them out of the list without a word.
    const a = toEvents(cal({ id: 'band' }), [ev({ id: 'shared' })])[0];
    const b = toEvents(cal({ id: 'companyx' }), [ev({ id: 'shared' })])[0];
    expect(a.id).not.toBe(b.id);
  });

  it('reads an all-day event off `date`, not `dateTime`', () => {
    const [e] = toEvents(cal({ id: 'me', primary: true }), [
      ev({ id: 'a', start: { date: '2026-09-08' } })
    ]);
    expect(e.allDay).toBe(true);
    expect(e.time).toBeUndefined();
  });

  it('drops a cancelled event', () => {
    expect(
      toEvents(cal({ id: 'me' }), [ev({ id: 'a', status: 'cancelled' })])
    ).toHaveLength(0);
  });

  it('gives an untitled event something to show', () => {
    expect(toEvents(cal({ id: 'me' }), [ev({ id: 'a', summary: '  ' })])[0].summary).toBe(
      '(no title)'
    );
  });
});

describe('putting the calendars together', () => {
  it('sorts across calendars, all-day first', () => {
    const primary = toEvents(cal({ id: 'me', primary: true }), [
      ev({ id: '1', summary: 'Parcel', start: { date: '2026-09-08' } }),
      ev({ id: '2', summary: 'Dentist', start: { dateTime: '2026-09-08T15:00:00Z' } })
    ]);
    const band = toEvents(cal({ id: 'band', summary: 'Band' }), [
      ev({ id: '3', summary: 'Rehearsal', start: { dateTime: '2026-09-08T09:00:00Z' } })
    ]);

    expect(mergeEvents([primary, band]).map((e) => e.summary)).toEqual([
      'Parcel',
      'Rehearsal',
      'Dentist'
    ]);
  });

  it('shows one card when the same event sits on two calendars', () => {
    // Being an attendee of something that is also on a shared calendar is one
    // thing to a person reading a strip.
    const a = toEvents(cal({ id: 'me', primary: true }), [
      ev({ id: '1', summary: 'Gig', start: { dateTime: '2026-09-08T20:00:00Z' } })
    ]);
    const b = toEvents(cal({ id: 'band', summary: 'Band' }), [
      ev({ id: '2', summary: 'Gig', start: { dateTime: '2026-09-08T20:00:00Z' } })
    ]);

    expect(mergeEvents([a, b])).toHaveLength(1);
  });

  it('keeps two different events at the same time', () => {
    const a = toEvents(cal({ id: 'me', primary: true }), [
      ev({ id: '1', summary: 'Dentist', start: { dateTime: '2026-09-08T15:00:00Z' } })
    ]);
    const b = toEvents(cal({ id: 'band', summary: 'Band' }), [
      ev({ id: '2', summary: 'Load-in', start: { dateTime: '2026-09-08T15:00:00Z' } })
    ]);

    expect(mergeEvents([a, b])).toHaveLength(2);
  });
});
