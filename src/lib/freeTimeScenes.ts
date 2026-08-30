import { browser } from '$app/environment';

/**
 * What the dinosaur is doing with its free time.
 *
 * The button rotates through a handful of little scenes, a different one each
 * time the app opens. It is the first thing on the first screen, and it is a
 * question rather than a task — so it can afford to be pleased to see you.
 *
 * DIVISION OF LABOUR, learned the hard way. The dinosaur is real artwork
 * (Twemoji's, CC-BY) because hand-written bezier curves make terrible animals.
 * Everything around it — a ball, a river, a mountain, a mug — is geometry, and
 * geometry written by hand is fine. Nothing here tries to draw a creature.
 */

export interface Scene {
  id: string;
  /** The button's gradient, replacing the standing brand orange for this open. */
  from: string;
  to: string;
  /** Text and the dinosaur's silhouette. Chosen per scene for contrast. */
  ink: string;
  /** Sits behind the dinosaur — hills, water, a horizon. */
  behind?: string;
  /** Sits in front — a ball at its feet, a mug beside it. */
  front?: string;
}

/**
 * Props are drawn in a 100x100 space over the button.
 *
 * The dinosaur and its caption sit in the middle, shifted slightly up, and
 * occupy roughly x 22–78, y 20–66. THE CAPTION IS THE CONSTRAINT: the first
 * pass put a ball and a coffee mug straight through "Free time?" and ran the
 * river's waves across the words. Anything at ground level belongs below y 70,
 * and anything beside the dinosaur beyond x 76.
 */
export const SCENES: Scene[] = [
  {
    id: 'ball',
    from: '#ff9f0a',
    to: '#ff6482',
    ink: '#2a1206',
    front:
      '<circle cx="73" cy="80" r="8" fill="currentColor" opacity=".9"/>' +
      '<path d="M73 73.4l3.6 2.7-1.4 4.4h-4.4l-1.4-4.4z" fill="#ffffff" opacity=".5"/>'
  },
  {
    id: 'river',
    from: '#5ad1c0',
    to: '#3c7fd0',
    ink: '#08252f',
    front:
      '<g fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" opacity=".6">' +
      '<path d="M10 73q6-3.6 12 0t12 0 12 0 12 0 12 0 12 0"/>' +
      '<path d="M16 81q6-3.6 12 0t12 0 12 0 12 0 12 0"/>' +
      '<path d="M24 89q6-3.6 12 0t12 0 12 0 12 0"/></g>'
  },
  {
    id: 'mountain',
    from: '#ffb347',
    to: '#e0525f',
    ink: '#2d1008',
    behind:
      '<g fill="currentColor" opacity=".22">' +
      '<path d="M4 62L26 26l16 24 8-11 22 23z"/></g>' +
      '<circle cx="72" cy="24" r="8" fill="#ffffff" opacity=".28"/>'
  },
  {
    id: 'disc',
    from: '#7ad07a',
    to: '#2f9f8a',
    ink: '#062a20',
    front:
      '<ellipse cx="80" cy="24" rx="10" ry="3.6" fill="currentColor" opacity=".85" ' +
      'transform="rotate(-18 80 24)"/>' +
      '<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".38">' +
      '<path d="M62 31q6-4 12-6"/></g>'
  },
  {
    id: 'coffee',
    from: '#d9a066',
    to: '#a4603c',
    ink: '#2a1509',
    front:
      '<g fill="currentColor" opacity=".9">' +
      '<rect x="62" y="76" width="15" height="12" rx="2.8"/>' +
      '<path d="M77 79h3.6a3.2 3.2 0 0 1 0 6.4H77z" fill="none" stroke="currentColor" stroke-width="2.2"/>' +
      '</g>' +
      '<g fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" opacity=".5">' +
      '<path d="M66 72q2.2-3.2 0-6.4"/><path d="M72 72q2.2-3.2 0-6.4"/></g>'
  },
  {
    id: 'stars',
    from: '#8f7bd8',
    to: '#4b3a8f',
    ink: '#f4f0ff',
    behind:
      '<g fill="currentColor" opacity=".55">' +
      '<circle cx="18" cy="22" r="1.8"/><circle cx="34" cy="14" r="1.2"/>' +
      '<circle cx="78" cy="18" r="2"/><circle cx="62" cy="10" r="1.3"/>' +
      '<circle cx="88" cy="34" r="1.5"/><circle cx="10" cy="40" r="1.3"/></g>' +
      '<circle cx="74" cy="26" r="7" fill="currentColor" opacity=".22"/>'
  },
  {
    id: 'guitar',
    from: '#ff8fb1',
    to: '#b0479a',
    ink: '#2b0a22',
    front:
      '<g transform="rotate(-24 80 48)">' +
      '<g fill="currentColor" opacity=".85">' +
      '<circle cx="80" cy="52" r="7"/><circle cx="80" cy="43" r="5.2"/>' +
      '<rect x="78.4" y="26" width="3.2" height="13" rx="1.2"/>' +
      '<rect x="77" y="22.5" width="6" height="4" rx="1.2"/></g>' +
      '<circle cx="81" cy="50" r="2.2" fill="#ffffff" opacity=".45"/></g>'
  }
];

const KEY = 'freetime.lastScene';

/**
 * A different scene from the last one.
 *
 * Pure random repeats about one open in seven, and a repeat reads as "nothing
 * happened" rather than "same one again" — so the previous id is remembered and
 * excluded. Chosen once per launch and held for the session: re-rolling on
 * every render would make the button flicker between identities while being
 * looked at.
 */
export function pickScene(): Scene {
  let last: string | null = null;
  try {
    last = browser ? localStorage.getItem(KEY) : null;
  } catch {
    /* blocked site data: a repeat now and then is no great loss */
  }

  const pool = SCENES.filter((s) => s.id !== last);
  const scene = pool[Math.floor(Math.random() * pool.length)] ?? SCENES[0]!;

  try {
    if (browser) localStorage.setItem(KEY, scene.id);
  } catch {
    /* as above */
  }
  return scene;
}
