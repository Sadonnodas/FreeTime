import { describe, it, expect } from 'vitest';
import { clusterMemos, boundsOf, inPeriod, applyFilter, located, cellSize } from './geo';
import type { Memo } from './types';

const memo = (over: Partial<Memo> = {}): Memo => ({
  id: Math.random().toString(36).slice(2),
  mime: 'audio/webm',
  durationMs: 5000,
  recordedAt: '2026-08-14T22:40:00.000Z',
  createdAt: '2026-08-14T22:40:00.000Z',
  updatedAt: '2026-08-14T22:40:00.000Z',
  ...over
});

// Roughly: home in Belgium, and a trip to the south of France.
const home = { lat: 51.05, lng: 3.72 };
const marseille = { lat: 43.2965, lng: 5.3698 };

describe('clustering', () => {
  it('collapses recordings made in the same place into one pin', () => {
    const memos = [
      memo(home),
      memo({ lat: home.lat + 0.0001, lng: home.lng + 0.0001 }),
      memo({ lat: home.lat - 0.0001, lng: home.lng })
    ];
    const clusters = clusterMemos(memos, 5);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.memos).toHaveLength(3);
  });

  it('keeps distant places apart, which is the entire point', () => {
    // Two hundred at home must not bury the three from the trip.
    const memos = [...Array(200)].map(() => memo(home)).concat([memo(marseille)]);
    const clusters = clusterMemos(memos, 5);
    expect(clusters).toHaveLength(2);
    expect(clusters.map((c) => c.memos.length).sort((a, b) => a - b)).toEqual([1, 200]);
  });

  it('splits a cluster as you zoom in', () => {
    const a = memo(home);
    const b = memo({ lat: home.lat + 0.05, lng: home.lng + 0.05 });
    expect(clusterMemos([a, b], 4)).toHaveLength(1);
    expect(clusterMemos([a, b], 14)).toHaveLength(2);
  });

  it('puts a lone pin exactly where it was recorded, not on a grid corner', () => {
    const [only] = clusterMemos([memo(marseille)], 8);
    expect(only!.lat).toBeCloseTo(marseille.lat, 6);
    expect(only!.lng).toBeCloseTo(marseille.lng, 6);
  });

  it('ignores recordings with no location instead of dropping them at 0,0', () => {
    // Null Island is where a missing coordinate goes if nobody checks.
    const clusters = clusterMemos([memo(), memo(marseille)], 6);
    expect(clusters).toHaveLength(1);
    expect(clusters[0]!.lat).toBeCloseTo(marseille.lat, 3);
  });

  it('shrinks the grid as zoom grows', () => {
    expect(cellSize(4)).toBeGreaterThan(cellSize(12));
  });

  it('handles an empty list', () => {
    expect(clusterMemos([], 8)).toEqual([]);
  });
});

describe('boundsOf', () => {
  it('is null when nothing has a location', () => {
    expect(boundsOf([memo(), memo()])).toBeNull();
  });

  it('covers every located recording', () => {
    const b = boundsOf([memo(home), memo(marseille)])!;
    expect(b.south).toBeCloseTo(marseille.lat, 4);
    expect(b.north).toBeCloseTo(home.lat, 4);
  });

  it('gives a single point some extent, so the map does not slam to max zoom', () => {
    const b = boundsOf([memo(marseille)])!;
    expect(b.north).toBeGreaterThan(b.south);
    expect(b.east).toBeGreaterThan(b.west);
  });
});

describe('period filtering', () => {
  const now = new Date('2026-08-30T12:00:00.000Z');

  it('means this calendar month, not the last 30 days', () => {
    // The question is "where was I in August", so the 1st still counts on the
    // 30th, and the 31st of July does not.
    expect(inPeriod(memo({ recordedAt: '2026-08-01T09:00:00.000Z' }), 'month', now)).toBe(true);
    expect(inPeriod(memo({ recordedAt: '2026-07-31T09:00:00.000Z' }), 'month', now)).toBe(false);
  });

  it('means this calendar year, not the last 365 days', () => {
    expect(inPeriod(memo({ recordedAt: '2026-01-02T09:00:00.000Z' }), 'year', now)).toBe(true);
    expect(inPeriod(memo({ recordedAt: '2025-12-31T09:00:00.000Z' }), 'year', now)).toBe(false);
  });

  it('lets everything through on all', () => {
    expect(inPeriod(memo({ recordedAt: '2019-03-03T09:00:00.000Z' }), 'all', now)).toBe(true);
  });
});

describe('applyFilter', () => {
  const now = new Date('2026-08-30T12:00:00.000Z');

  it('combines project and period', () => {
    const rows = [
      memo({ ...marseille, projectId: 'music', recordedAt: '2026-08-10T09:00:00.000Z' }),
      memo({ ...marseille, projectId: 'music', recordedAt: '2025-08-10T09:00:00.000Z' }),
      memo({ ...marseille, projectId: 'van', recordedAt: '2026-08-11T09:00:00.000Z' })
    ];
    expect(applyFilter(rows, { projectId: 'music', period: 'year' }, now)).toHaveLength(1);
  });

  it('with no project set, keeps recordings that belong to none', () => {
    const rows = [memo(marseille), memo({ ...marseille, projectId: 'music' })];
    expect(applyFilter(rows, { period: 'all' }, now)).toHaveLength(2);
  });
});

describe('located', () => {
  it('accepts zero as a real coordinate', () => {
    // 0,0 is a legitimate point; a truthiness check would discard it.
    expect(located(memo({ lat: 0, lng: 0 }))).toBe(true);
    expect(located(memo())).toBe(false);
  });
});
