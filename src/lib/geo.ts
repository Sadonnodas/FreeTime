import type { Memo } from './types';

/**
 * Turning a pile of coordinates into something you can actually look at.
 *
 * The problem the map has to solve is not drawing pins, it is that most
 * recordings happen in the same few places. Two hundred memos made at home are
 * two hundred pins stacked on one roof, which hides the three made in Marseille
 * — the only ones anybody wanted to find. So nearby memos collapse into one
 * marker carrying a count, and the collapsing distance follows the zoom: pull
 * back and a city becomes one dot, push in and the street reappears.
 */

export interface Cluster {
  /** Stable across re-clustering at the same zoom, so markers can be reused. */
  key: string;
  lat: number;
  lng: number;
  memos: Memo[];
}

export const located = (m: Memo): boolean => m.lat != null && m.lng != null;

/**
 * Grid size in degrees for a given zoom level.
 *
 * A grid rather than true distance clustering: it is one pass instead of an
 * all-pairs comparison, and at these numbers the difference in quality is
 * invisible while the difference in code is not. Roughly one grid cell per
 * ~60 screen pixels, which is about the size of a marker.
 */
export function cellSize(zoom: number): number {
  return 360 / 2 ** zoom / 4;
}

export function clusterMemos(memos: Memo[], zoom: number): Cluster[] {
  const size = cellSize(zoom);
  const cells = new Map<string, Memo[]>();

  for (const memo of memos) {
    if (!located(memo)) continue;
    const row = Math.floor(memo.lat! / size);
    const col = Math.floor(memo.lng! / size);
    const key = `${row}:${col}`;
    const bucket = cells.get(key);
    if (bucket) bucket.push(memo);
    else cells.set(key, [memo]);
  }

  return [...cells].map(([key, group]) => ({
    key,
    // The average, not the cell centre — a single memo should sit exactly where
    // it was recorded, not snapped to an invisible grid.
    lat: group.reduce((sum, m) => sum + m.lat!, 0) / group.length,
    lng: group.reduce((sum, m) => sum + m.lng!, 0) / group.length,
    memos: group.sort((a, b) => b.recordedAt.localeCompare(a.recordedAt))
  }));
}

export interface Bounds {
  south: number;
  west: number;
  north: number;
  east: number;
}

/** What the map should show on open: everything, with a little air around it. */
export function boundsOf(memos: Memo[]): Bounds | null {
  const pts = memos.filter(located);
  if (!pts.length) return null;

  const lats = pts.map((m) => m.lat!);
  const lngs = pts.map((m) => m.lng!);
  // A single point has no extent, so give it one — fitBounds on a zero-size box
  // zooms to maximum, which lands you on somebody's roof tiles.
  const pad = pts.length === 1 ? 0.02 : 0;

  return {
    south: Math.min(...lats) - pad,
    west: Math.min(...lngs) - pad,
    north: Math.max(...lats) + pad,
    east: Math.max(...lngs) + pad
  };
}

// ------------------------------------------------------------------ filters

export type Period = 'all' | 'month' | 'year';

/**
 * Time filtering, on the calendar rather than a rolling window.
 *
 * "This year" has to mean 2026, not the last 365 days, because the question
 * being asked is "where was I in August?" and a rolling window quietly answers
 * a different one.
 */
export function inPeriod(memo: Memo, period: Period, now = new Date()): boolean {
  if (period === 'all') return true;
  const at = new Date(memo.recordedAt);
  if (at.getFullYear() !== now.getFullYear()) return false;
  return period === 'year' || at.getMonth() === now.getMonth();
}

export interface MemoFilter {
  projectId?: string;
  period: Period;
}

export function applyFilter(memos: Memo[], filter: MemoFilter, now = new Date()): Memo[] {
  return memos
    .filter((m) => (filter.projectId ? m.projectId === filter.projectId : true))
    .filter((m) => inPeriod(m, filter.period, now));
}
