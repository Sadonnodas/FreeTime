import { describe, it, expect } from 'vitest';
import { mergeRecords, conflictFileName, CONFLICT_WINDOW_MS } from './merge';
import type { Todo } from './types';

/**
 * Sync is the one part of this app that can destroy data the user typed, and
 * the failure is silent — a to-do that quietly stops existing looks identical
 * to one you forgot you wrote. So the rules get tested directly rather than
 * being trusted to a read-through.
 */

const t = (id: string, over: Partial<Todo> = {}): Todo => ({
  id,
  title: id,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  ...over
});

describe('per-record merge', () => {
  it('keeps records that exist on only one side', () => {
    const { merged, localChanged, remoteChanged } = mergeRecords([t('a')], [t('b')]);
    expect(merged.map((r) => r.id)).toEqual(['a', 'b']);
    // Each side is missing something the other has, so both need writing.
    expect(localChanged).toBe(true);
    expect(remoteChanged).toBe(true);
  });

  it('takes the higher updatedAt', () => {
    const mine = t('a', { title: 'mine', updatedAt: '2026-05-01T10:00:00.000Z' });
    const theirs = t('a', { title: 'theirs', updatedAt: '2026-05-01T11:00:00.000Z' });
    expect(mergeRecords([mine], [theirs]).merged[0]!.title).toBe('theirs');
    expect(mergeRecords([theirs], [mine]).merged[0]!.title).toBe('theirs');
  });

  it('converges — merging twice changes nothing further', () => {
    const mine = [t('a', { title: 'mine', updatedAt: '2026-05-01T10:00:00.000Z' }), t('b')];
    const theirs = [t('a', { title: 'theirs', updatedAt: '2026-05-01T11:00:00.000Z' }), t('c')];

    const once = mergeRecords(mine, theirs).merged;
    const twice = mergeRecords(once, once);
    expect(twice.merged).toEqual(once);
    expect(twice.localChanged).toBe(false);
    expect(twice.remoteChanged).toBe(false);
  });

  it('never resurrects a deleted record, even from a newer edit', () => {
    const deleted = t('a', {
      updatedAt: '2026-05-01T10:00:00.000Z',
      deletedAt: '2026-05-01T10:00:00.000Z'
    });
    const editedLater = t('a', { title: 'back!', updatedAt: '2026-05-01T12:00:00.000Z' });

    expect(mergeRecords([deleted], [editedLater]).merged[0]!.deletedAt).toBeTruthy();
    expect(mergeRecords([editedLater], [deleted]).merged[0]!.deletedAt).toBeTruthy();
  });

  it('keeps the earliest tombstone when both sides deleted', () => {
    const early = t('a', { updatedAt: '2026-05-01T10:00:00.000Z', deletedAt: '2026-05-01T10:00:00.000Z' });
    const late = t('a', { updatedAt: '2026-05-01T11:00:00.000Z', deletedAt: '2026-05-01T11:00:00.000Z' });
    expect(mergeRecords([early], [late]).merged[0]!.deletedAt).toBe('2026-05-01T10:00:00.000Z');
  });

  it('logs an overwrite when both sides changed within the window', () => {
    const mine = t('a', { title: 'mine', updatedAt: '2026-05-01T10:00:00.000Z' });
    const theirs = t('a', { title: 'theirs', updatedAt: '2026-05-01T10:01:00.000Z' });

    const { overwrites } = mergeRecords([mine], [theirs]);
    expect(overwrites).toHaveLength(1);
    expect(overwrites[0]!.kept.title).toBe('theirs');
    expect(overwrites[0]!.overwritten.title).toBe('mine');
  });

  it('stays quiet when the edits are far apart', () => {
    const mine = t('a', { title: 'mine', updatedAt: '2026-05-01T10:00:00.000Z' });
    const theirs = t('a', {
      title: 'theirs',
      updatedAt: new Date(Date.parse('2026-05-01T10:00:00.000Z') + CONFLICT_WINDOW_MS + 1000).toISOString()
    });
    expect(mergeRecords([mine], [theirs]).overwrites).toHaveLength(0);
  });

  it('does not report a conflict when both sides say the same thing', () => {
    const mine = t('a', { title: 'same', updatedAt: '2026-05-01T10:00:00.000Z' });
    const theirs = t('a', { title: 'same', updatedAt: '2026-05-01T10:00:30.000Z' });
    const { overwrites, localChanged, remoteChanged } = mergeRecords([mine], [theirs]);
    expect(overwrites).toHaveLength(0);
    expect(localChanged).toBe(false);
    expect(remoteChanged).toBe(false);
  });

  it('handles a tie without flapping', () => {
    const mine = t('a', { title: 'mine', updatedAt: '2026-05-01T10:00:00.000Z' });
    const theirs = t('a', { title: 'theirs', updatedAt: '2026-05-01T10:00:00.000Z' });
    expect(mergeRecords([mine], [theirs]).merged[0]!.title).toBe('mine');
  });

  it('loses nothing across a realistic two-device round trip', () => {
    // Laptop and phone each add one to-do offline, then both sync.
    const laptop = [t('shared'), t('from-laptop')];
    const phone = [t('shared'), t('from-phone')];

    const laptopFirst = mergeRecords(laptop, phone).merged;
    const phoneNext = mergeRecords(phone, laptopFirst).merged;

    expect(phoneNext.map((r) => r.id).sort()).toEqual(['from-laptop', 'from-phone', 'shared']);
  });

  it('copes with empty sides', () => {
    expect(mergeRecords<Todo>([], []).merged).toEqual([]);
    expect(mergeRecords([t('a')], []).merged).toHaveLength(1);
    expect(mergeRecords<Todo>([], [t('a')]).merged).toHaveLength(1);
  });
});

describe('note conflict naming', () => {
  it('keeps both files rather than losing text', () => {
    expect(conflictFileName('bearfeet.md', new Date('2026-08-26T12:00:00Z'))).toBe(
      'bearfeet (conflict 2026-08-26).md'
    );
  });
});
