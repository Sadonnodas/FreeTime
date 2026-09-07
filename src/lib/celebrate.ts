/**
 * The little burst when something gets ticked off.
 *
 * WHY THERE IS MORE THAN ONE. Asked for as "some kind of variable animation" —
 * and the app already works this way everywhere else it has a personality: the
 * Free Time button rotates through scenes, the dinosaur's line rotates
 * independently of it. A celebration that is identical every single time stops
 * being a celebration by about the fourth day; one that is slightly different
 * each time stays worth watching for.
 *
 * GEOMETRY ONLY, and that is the icon lesson written down: hand-written beziers
 * make perfectly good sparks, rings and confetti, and terrible animals. Nothing
 * here tries to draw a creature.
 *
 * This is about the THING BEING FINISHED, never about the person finishing it.
 * No counts, no "3 in a row", no score — a burst is a full stop, and a full
 * stop cannot accumulate into something to live up to.
 */

export type BurstShape = 'spark' | 'dot' | 'star' | 'petal';

export interface Burst {
  id: string;
  shape: BurstShape;
  /** How many fly out. */
  count: number;
  /** How far they travel, in the SVG's own 100-wide box. */
  spread: number;
  /** An expanding ring underneath them. */
  ring: boolean;
  /** Theme tokens, cycled across the particles. */
  colors: string[];
}

const GOOD = 'var(--color-good)';
const ACCENT = 'var(--color-accent)';
const B1 = 'var(--color-brand-1)';
const B2 = 'var(--color-brand-2)';

export const BURSTS: Burst[] = [
  { id: 'sparks', shape: 'spark', count: 10, spread: 34, ring: true, colors: [GOOD, ACCENT] },
  { id: 'confetti', shape: 'dot', count: 12, spread: 30, ring: false, colors: [GOOD, ACCENT, B1, B2] },
  { id: 'twinkle', shape: 'star', count: 6, spread: 30, ring: true, colors: [ACCENT, GOOD] },
  { id: 'petals', shape: 'petal', count: 9, spread: 28, ring: false, colors: [B1, B2, GOOD] },
  { id: 'pop', shape: 'dot', count: 7, spread: 22, ring: true, colors: [GOOD] },
  { id: 'scatter', shape: 'spark', count: 14, spread: 38, ring: false, colors: [GOOD, B2, ACCENT] }
];

let previous: string | null = null;

/**
 * One at random, never the same as the last one.
 *
 * A repeat reads as "nothing happened" — the same reasoning the Free Time
 * scenes already use, and the reason that one remembers its previous id too.
 */
export function pickBurst(): Burst {
  const options = BURSTS.filter((b) => b.id !== previous);
  const pick = options[Math.floor(Math.random() * options.length)] ?? BURSTS[0];
  previous = pick.id;
  return pick;
}

/** Test seam: forget what was shown last. */
export function resetBursts(): void {
  previous = null;
}

export interface Particle {
  /** Degrees around the circle. */
  angle: number;
  distance: number;
  delayMs: number;
  durationMs: number;
  color: string;
  scale: number;
}

/**
 * Where each piece goes.
 *
 * Evenly spaced around the circle and then knocked off that grid a little:
 * perfectly even is a clock face, and perfectly random clumps and leaves bald
 * patches. The jitter is what makes it read as a burst rather than a diagram.
 */
export function particlesFor(burst: Burst, rand: () => number = Math.random): Particle[] {
  const step = 360 / burst.count;
  return Array.from({ length: burst.count }, (_, i) => ({
    angle: i * step + (rand() - 0.5) * step * 0.7,
    distance: burst.spread * (0.72 + rand() * 0.45),
    delayMs: Math.round(rand() * 70),
    durationMs: 460 + Math.round(rand() * 260),
    color: burst.colors[i % burst.colors.length]!,
    scale: 0.75 + rand() * 0.6
  }));
}
