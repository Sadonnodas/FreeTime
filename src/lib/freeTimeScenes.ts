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
  // --- water and weather -----------------------------------------------------
  {
    id: 'river', from: '#5ad1c0', to: '#3c7fd0', ink: '#08252f',
    front:
      '<g fill="none" stroke="currentColor" stroke-width="2.8" stroke-linecap="round" opacity=".6">' +
      '<path d="M10 73q6-3.6 12 0t12 0 12 0 12 0 12 0 12 0"/>' +
      '<path d="M16 81q6-3.6 12 0t12 0 12 0 12 0 12 0"/>' +
      '<path d="M24 89q6-3.6 12 0t12 0 12 0 12 0"/></g>'
  },
  {
    id: 'rain', from: '#a9c0dc', to: '#41628c', ink: '#0b1e30',
    behind:
      '<g fill="currentColor" opacity=".18">' +
      '<ellipse cx="30" cy="18" rx="15" ry="7"/><ellipse cx="46" cy="14" rx="11" ry="6"/>' +
      '<ellipse cx="70" cy="19" rx="12" ry="6"/></g>',
    front:
      '<g stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".5">' +
      '<path d="M16 74l-3 8"/><path d="M32 78l-3 8"/><path d="M50 74l-3 8"/>' +
      '<path d="M66 79l-3 8"/><path d="M82 74l-3 8"/></g>'
  },
  {
    id: 'snow', from: '#e6eef8', to: '#89a6c6', ink: '#132435',
    behind:
      '<g fill="currentColor" opacity=".35">' +
      '<circle cx="16" cy="20" r="2"/><circle cx="36" cy="12" r="1.6"/><circle cx="58" cy="17" r="2.2"/>' +
      '<circle cx="80" cy="12" r="1.8"/><circle cx="88" cy="32" r="1.6"/><circle cx="10" cy="40" r="1.7"/></g>',
    front:
      '<path d="M0 78q14-7 26-2t24 1 24-4 26 3v27H0z" fill="#ffffff" opacity=".55"/>'
  },
  {
    id: 'sailboat', from: '#8ad6ea', to: '#2f6fa8', ink: '#062334',
    front:
      '<g fill="currentColor" opacity=".85">' +
      '<path d="M78 58l10 16H78z"/><path d="M76 58l-9 16h9z" opacity=".7"/>' +
      '<path d="M64 76h26l-5 6H69z"/></g>' +
      '<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".5">' +
      '<path d="M8 86q6-3.4 12 0t12 0 12 0 12 0 12 0 12 0"/></g>'
  },
  {
    id: 'fishing', from: '#96dbcc', to: '#2f7f96', ink: '#052a30',
    front:
      '<g stroke="currentColor" stroke-linecap="round" opacity=".8">' +
      '<path d="M84 26L70 56" stroke-width="2.6"/>' +
      '<path d="M70 56v20" stroke-width="1.2" opacity=".6"/></g>' +
      '<circle cx="70" cy="78" r="2.4" fill="currentColor" opacity=".7"/>' +
      '<g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".45">' +
      '<path d="M10 84q6-3.4 12 0t12 0 12 0 12 0 12 0 12 0"/></g>'
  },

  // --- land and sky ----------------------------------------------------------
  {
    id: 'mountain', from: '#ffb347', to: '#e0525f', ink: '#2d1008',
    behind:
      '<g fill="currentColor" opacity=".22"><path d="M4 62L26 26l16 24 8-11 22 23z"/></g>' +
      '<circle cx="72" cy="24" r="8" fill="#ffffff" opacity=".28"/>'
  },
  {
    id: 'forest', from: '#93d38f', to: '#2f7a52', ink: '#052618',
    behind:
      '<g fill="currentColor" opacity=".24">' +
      '<path d="M12 64L20 34l8 30z"/><path d="M26 64L34 26l8 38z"/><path d="M74 64L82 32l8 32z"/></g>'
  },
  {
    id: 'sunset', from: '#ffd08a', to: '#e0607a', ink: '#37131f',
    behind:
      '<circle cx="50" cy="40" r="26" fill="#ffffff" opacity=".3"/>' +
      '<g stroke="currentColor" stroke-width="2.4" stroke-linecap="round" opacity=".35">' +
      '<path d="M8 74h84"/><path d="M20 82h60"/></g>'
  },
  {
    id: 'stars', from: '#8f7bd8', to: '#4b3a8f', ink: '#f4f0ff',
    behind:
      '<g fill="currentColor" opacity=".55">' +
      '<circle cx="18" cy="22" r="1.8"/><circle cx="34" cy="14" r="1.2"/>' +
      '<circle cx="78" cy="18" r="2"/><circle cx="62" cy="10" r="1.3"/>' +
      '<circle cx="88" cy="34" r="1.5"/><circle cx="10" cy="40" r="1.3"/></g>' +
      '<circle cx="74" cy="26" r="7" fill="currentColor" opacity=".22"/>'
  },
  {
    id: 'telescope', from: '#94a9e2', to: '#3d4d9c', ink: '#eef0ff',
    behind:
      '<g fill="currentColor" opacity=".5"><circle cx="20" cy="18" r="1.8"/>' +
      '<circle cx="40" cy="10" r="1.3"/><circle cx="86" cy="22" r="1.6"/></g>',
    front:
      '<g opacity=".85">' +
      '<rect x="70" y="34" width="22" height="7" rx="3.5" fill="currentColor" transform="rotate(-32 81 37)"/>' +
      '<g stroke="currentColor" stroke-width="2.4" stroke-linecap="round">' +
      '<path d="M78 46l-4 12"/><path d="M78 46l6 12"/></g></g>'
  },
  {
    id: 'campfire', from: '#ffb066', to: '#d2452f', ink: '#33110a',
    front:
      '<g stroke="currentColor" stroke-width="3.4" stroke-linecap="round" opacity=".8">' +
      '<path d="M64 84l16-6"/><path d="M64 78l16 6"/></g>' +
      '<path d="M72 76c-5-4-2-9 0-11 1 4 5 3 5 7 0 3-2 4-5 4z" fill="#ffffff" opacity=".55"/>'
  },
  {
    id: 'hammock', from: '#ffc9a0', to: '#c9704a', ink: '#33150c',
    front:
      '<g stroke="currentColor" stroke-linecap="round" opacity=".75">' +
      '<path d="M14 58v30" stroke-width="3"/><path d="M88 58v30" stroke-width="3"/>' +
      '<path d="M14 66q37 22 74 0" stroke-width="3.4" fill="none"/></g>'
  },
  {
    id: 'kite', from: '#a8d8ff', to: '#4a7fd0', ink: '#0a2038',
    front:
      '<g opacity=".85"><path d="M82 12l9 10-9 10-9-10z" fill="currentColor"/>' +
      '<path d="M82 32q-5 8 2 12t-2 10" fill="none" stroke="currentColor" stroke-width="1.8" ' +
      'stroke-linecap="round" opacity=".6"/></g>'
  },
  {
    id: 'balloon', from: '#ffb3c8', to: '#d0538a', ink: '#3a0f24',
    front:
      '<g opacity=".85"><ellipse cx="84" cy="20" rx="8" ry="9.5" fill="currentColor"/>' +
      '<path d="M84 30v22" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".6"/></g>'
  },

  // --- things to do ----------------------------------------------------------
  {
    id: 'disc', from: '#7ad07a', to: '#2f9f8a', ink: '#062a20',
    front:
      '<ellipse cx="80" cy="24" rx="10" ry="3.6" fill="currentColor" opacity=".85" ' +
      'transform="rotate(-18 80 24)"/>' +
      '<g stroke="currentColor" stroke-width="1.6" stroke-linecap="round" opacity=".38">' +
      '<path d="M62 31q6-4 12-6"/></g>'
  },
  {
    id: 'bicycle', from: '#ffc46b', to: '#e06a4a', ink: '#341407',
    front:
      '<g fill="none" stroke="currentColor" stroke-width="2.4" opacity=".8">' +
      '<circle cx="66" cy="80" r="8"/><circle cx="88" cy="80" r="8"/>' +
      '<path d="M66 80l8-12h8l6 12" stroke-linecap="round"/>' +
      '<path d="M74 68h8" stroke-linecap="round"/></g>'
  },
  {
    id: 'skateboard', from: '#a0e0d0', to: '#3f8fa0', ink: '#062a2f',
    front:
      '<g opacity=".85"><rect x="58" y="78" width="34" height="5" rx="2.5" fill="currentColor"/>' +
      '<circle cx="66" cy="87" r="3.4" fill="currentColor"/><circle cx="84" cy="87" r="3.4" fill="currentColor"/></g>'
  },
  {
    id: 'book', from: '#f0c98a', to: '#a8683f', ink: '#33180a',
    front:
      '<g fill="currentColor" opacity=".85">' +
      '<path d="M58 88V74l16-4v14z"/><path d="M92 88V74l-16-4v14z"/></g>' +
      '<path d="M75 70v18" stroke="currentColor" stroke-width="1.6" opacity=".5"/>'
  },
  {
    id: 'paint', from: '#ffb8d8', to: '#8a4fb0', ink: '#2c0a2e',
    front:
      '<g opacity=".85"><path d="M60 82a13 13 0 1 1 26 0c0 4-4 3-6 5s0 5-4 5a16 16 0 0 1-16-10z" ' +
      'fill="currentColor"/>' +
      '<circle cx="68" cy="76" r="2.2" fill="#ffffff" opacity=".55"/>' +
      '<circle cx="78" cy="75" r="2.2" fill="#ffffff" opacity=".4"/></g>'
  },
  {
    id: 'picnic', from: '#ffd487', to: '#d1795a', ink: '#361707',
    front:
      '<g opacity=".7"><rect x="10" y="78" width="80" height="14" rx="2" fill="currentColor"/>' +
      '<g stroke="#ffffff" stroke-width="2" opacity=".45">' +
      '<path d="M26 78v14"/><path d="M42 78v14"/><path d="M58 78v14"/><path d="M74 78v14"/></g></g>'
  },

  // --- music -----------------------------------------------------------------
  {
    id: 'guitar', from: '#ff8fb1', to: '#b0479a', ink: '#2b0a22',
    front:
      '<g transform="rotate(-24 80 48)"><g fill="currentColor" opacity=".85">' +
      '<circle cx="80" cy="52" r="7"/><circle cx="80" cy="43" r="5.2"/>' +
      '<rect x="78.4" y="26" width="3.2" height="13" rx="1.2"/>' +
      '<rect x="77" y="22.5" width="6" height="4" rx="1.2"/></g>' +
      '<circle cx="81" cy="50" r="2.2" fill="#ffffff" opacity=".45"/></g>' +
      '<g fill="currentColor" opacity=".55">' +
      '<circle cx="16" cy="40" r="3"/><rect x="18" y="26" width="1.8" height="15"/>' +
      '<path d="M19.8 26h7v3h-7z"/>' +
      '<circle cx="26" cy="58" r="2.4"/><rect x="27.6" y="46" width="1.5" height="13"/></g>'
  },
  {
    id: 'notes', from: '#9fe0c8', to: '#3f9f8a', ink: '#04291f',
    front:
      '<g fill="currentColor" opacity=".7">' +
      '<circle cx="14" cy="34" r="3.4"/><rect x="16.4" y="18" width="2" height="17"/>' +
      '<path d="M18.4 18h8v3.4h-8z"/>' +
      '<circle cx="84" cy="52" r="3"/><rect x="86" y="38" width="1.8" height="15"/>' +
      '<circle cx="80" cy="22" r="2.4"/><rect x="81.6" y="11" width="1.5" height="12"/></g>'
  },
  {
    id: 'vinyl', from: '#c9a6f0', to: '#6a3fb0', ink: '#f2ecff',
    front:
      '<g opacity=".85"><circle cx="80" cy="76" r="13" fill="currentColor"/>' +
      '<circle cx="80" cy="76" r="5" fill="none" stroke="#ffffff" stroke-width="1.4" opacity=".5"/>' +
      '<circle cx="80" cy="76" r="1.8" fill="#ffffff" opacity=".7"/></g>'
  },
  {
    id: 'microphone', from: '#f2a0b8', to: '#8a3f70', ink: '#2e0a1e',
    front:
      '<g opacity=".85"><rect x="76" y="46" width="10" height="18" rx="5" fill="currentColor"/>' +
      '<path d="M72 60a9 9 0 0 0 18 0" fill="none" stroke="currentColor" stroke-width="2.4" ' +
      'stroke-linecap="round"/><path d="M81 69v8" stroke="currentColor" stroke-width="2.4" ' +
      'stroke-linecap="round"/><path d="M73 79h16" stroke="currentColor" stroke-width="2.4" ' +
      'stroke-linecap="round"/></g>'
  },
  {
    id: 'headphones', from: '#b8c8ff', to: '#4f4fb0', ink: '#0d0f34',
    front:
      '<g opacity=".85" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round">' +
      '<path d="M70 54a12 12 0 0 1 24 0"/></g>' +
      '<g fill="currentColor" opacity=".85">' +
      '<rect x="67" y="54" width="6" height="12" rx="3"/><rect x="91" y="54" width="6" height="12" rx="3"/></g>'
  },

  // --- home ------------------------------------------------------------------
  {
    id: 'campervan', from: '#f6bd88', to: '#c96a4a', ink: '#331207',
    front:
      '<g fill="currentColor" opacity=".85">' +
      '<rect x="56" y="66" width="36" height="16" rx="3"/><rect x="62" y="59" width="18" height="8" rx="2.5"/>' +
      '<circle cx="65" cy="84" r="4"/><circle cx="85" cy="84" r="4"/></g>' +
      '<rect x="60" y="69" width="9" height="7" rx="1.5" fill="#ffffff" opacity=".45"/>'
  },
  {
    id: 'beach', from: '#ffd98a', to: '#f0885d', ink: '#3a1408',
    front:
      '<g opacity=".85"><path d="M60 66a16 16 0 0 1 32 0z" fill="currentColor"/>' +
      '<path d="M76 66v18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></g>' +
      '<g fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" opacity=".4">' +
      '<path d="M10 88q6-3 12 0t12 0 12 0"/></g>'
  },
  {
    id: 'plant', from: '#a8e0a0', to: '#3f8f5f', ink: '#062a14',
    front:
      '<g opacity=".85"><path d="M70 88V70" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>' +
      '<path d="M70 76q-9-3-10-12 9 1 10 12z" fill="currentColor"/>' +
      '<path d="M70 72q9-4 10-13-9 1-10 13z" fill="currentColor" opacity=".8"/>' +
      '<path d="M62 88h16l-2 6H64z" fill="currentColor"/></g>'
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
