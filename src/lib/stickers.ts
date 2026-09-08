import { base } from "$app/paths";

/**
 * The dinosaurs.
 *
 * Fifty-two of them, cut out of the sticker sheets Toon drew up (see
 * scripts/slice-stickers.py, which did the cutting). They are the second kind
 * of dinosaur in the app and they do a different job from the first: Dino.svelte
 * is one animal, in line art, that recolours with the theme and stands in for
 * the app itself. These are full-colour characters doing something specific,
 * and they are picked BY the person rather than assigned by the app.
 *
 * They were traced up to 448px tall with Real-ESRGAN's illustration model
 * (see the note in README): the sheets arrived as phone screenshots, so a
 * sticker was about 200px, and a project tile on a 3x phone asks for roughly
 * 450. They were visibly soft. Vectorising was tried first and works — vtracer
 * handles flat cartoon art well — but a traced sticker is 450KB-1MB of SVG
 * because it chases every gradient in the shading, which is 25MB for the set.
 *
 * THEY ARE PRECACHED, all 52, about 2.3MB on top of a 1.1MB app. That is a
 * large fraction of the whole download for a set where eight might ever get
 * used, and it is still the right trade: this app is offline by default, a
 * cover is the largest thing on the Projects screen, and one that renders
 * blank on a train reads as data that has gone missing rather than as an image
 * that has not loaded. It is a one-time install cost — a content-hashed
 * precache does not re-fetch what has not changed — and it is smaller than one
 * photo off the phone.
 */
/** Which way the animal in the picture is looking. */
export type Facing = 'left' | 'right';

export interface Sticker {
  id: string;
  /** Shown under the picture. Describes what it is doing, not what it is. */
  label: string;
  /**
   * Which way the animal is looking, judged by eye from the artwork.
   *
   * Only the walk-through-a-row animation uses it, and it exists because
   * nothing in the file names or the pixels reliably says which end the head
   * is: a few are drawn face-on, several curl their necks right round, and one
   * is upside down. So it is a person's call per sticker, laid out on a contact
   * sheet and read off. **A new sticker must declare one** — a test asserts it,
   * because the alternative is one animal moonwalking through your to-dos and
   * nobody able to say why.
   */
  faces: Facing;
}

export const STICKERS: Sticker[] = [
  { id: "a-burst-of-music", label: "a burst of music", faces: "left" },
  { id: "a-cloud-of-rainbow", label: "a cloud of rainbow", faces: "left" },
  { id: "a-spray-of-flowers", label: "a spray of flowers", faces: "left" },
  { id: "a-wave-of-water", label: "a wave of water", faces: "left" },
  { id: "at-the-mixing-desk", label: "at the mixing desk", faces: "left" },
  { id: "at-the-telescope", label: "at the telescope", faces: "right" },
  { id: "at-the-typewriter", label: "at the typewriter", faces: "left" },
  { id: "behind-the-decks", label: "behind the decks", faces: "left" },
  { id: "board-game-night", label: "board game night", faces: "right" },
  { id: "bubbles", label: "bubbles", faces: "right" },
  { id: "building-a-landscape", label: "building a landscape", faces: "right" },
  { id: "building-a-toy-car", label: "building a toy car", faces: "right" },
  { id: "digging-up-fossils", label: "digging up fossils", faces: "right" },
  { id: "drawing-on-a-tablet", label: "drawing on a tablet", faces: "left" },
  { id: "flying-a-biplane", label: "flying a biplane", faces: "right" },
  { id: "fruit-salad", label: "fruit salad", faces: "left" },
  { id: "fruit-salad-again", label: "fruit salad, again", faces: "right" },
  { id: "handstand", label: "handstand", faces: "left" },
  { id: "just-standing-there", label: "just standing there", faces: "left" },
  { id: "knitting-a-scarf", label: "knitting a scarf", faces: "left" },
  { id: "leaping-the-rooftops", label: "leaping the rooftops", faces: "left" },
  { id: "model-railway", label: "model railway", faces: "right" },
  { id: "on-the-keytar", label: "on the keytar", faces: "left" },
  { id: "on-the-moon", label: "on the moon", faces: "left" },
  { id: "orange-and-upright", label: "orange and upright", faces: "left" },
  { id: "over-the-canyon", label: "over the canyon", faces: "left" },
  { id: "painting-at-an-easel", label: "painting at an easel", faces: "right" },
  { id: "pirate-treasure", label: "pirate treasure", faces: "right" },
  { id: "playing-guitar", label: "playing guitar", faces: "left" },
  { id: "pouring-coffee", label: "pouring coffee", faces: "right" },
  { id: "puzzle-pieces", label: "puzzle pieces", faces: "right" },
  { id: "rainbow-arc", label: "rainbow arc", faces: "left" },
  { id: "rainbow-contrail", label: "rainbow contrail", faces: "left" },
  { id: "rainbow-roar", label: "rainbow roar", faces: "right" },
  { id: "rainbow-skate-ramp", label: "rainbow skate ramp", faces: "right" },
  { id: "rainbow-swirl", label: "rainbow swirl", faces: "left" },
  { id: "reading", label: "reading", faces: "left" },
  { id: "recording-studio", label: "recording studio", faces: "left" },
  { id: "rolling-sushi", label: "rolling sushi", faces: "right" },
  { id: "satellite-repair", label: "satellite repair", faces: "left" },
  { id: "scuba-diving", label: "scuba diving", faces: "left" },
  { id: "skate-ramp", label: "skate ramp", faces: "right" },
  { id: "small-and-unbothered", label: "small and unbothered", faces: "left" },
  { id: "snowboarding", label: "snowboarding", faces: "right" },
  { id: "sparkles", label: "sparkles", faces: "left" },
  { id: "standing-on-the-rainbow", label: "standing on the rainbow", faces: "left" },
  { id: "surfing", label: "surfing", faces: "right" },
  { id: "tailoring-a-suit", label: "tailoring a suit", faces: "left" },
  { id: "tall-and-pleased", label: "tall and pleased", faces: "left" },
  { id: "throwing-a-pot", label: "throwing a pot", faces: "left" },
  { id: "unearthing-eggs", label: "unearthing eggs", faces: "right" },
  { id: "weaving", label: "weaving", faces: "left" },
];

const BY_ID = new Map(STICKERS.map((s) => [s.id, s]));

/**
 * Stored on a project as `dino:<id>` rather than as the file's path.
 *
 * Project.image is otherwise a data URL, and a sticker could have been stored
 * the same way — but that is fifteen kilobytes of base64 per project riding up
 * to Drive and back on every sync, for a picture that already ships with the
 * app. A path would have worked too, except it bakes kit.paths.base into a
 * synced record, so moving the app to a domain root would break every cover
 * silently. The id survives both.
 */
const PREFIX = "dino:";

export const stickerRef = (id: string) => `${PREFIX}${id}`;

/** Whether an image field names a sticker at all, known or not.
 *
 *  Needed because a sticker can be retired — one turned out to be a soft
 *  duplicate, another just did not work — while a project on another device is
 *  still pointing at it. Without this the cover fell through to the "it must be
 *  a photo" branch and rendered <img src="dino:through-the-fire-hoop">, which
 *  draws as a broken image rather than as the project it belongs to. */
export const isStickerRef = (image?: string) => !!image?.startsWith(PREFIX);

/** The sticker an image field refers to, or null if it is a real picture. */
export function stickerFrom(image?: string): Sticker | null {
  if (!image?.startsWith(PREFIX)) return null;
  return BY_ID.get(image.slice(PREFIX.length)) ?? null;
}

export const stickerUrl = (sticker: Sticker) =>
  `${base}/dino/${sticker.id}.webp`;

/**
 * The same name always gets the same dinosaur.
 *
 * Used where the app needs one and nobody has chosen — an empty state, a
 * project with no cover. It must be stable: a mascot that changes on every
 * render reads as a glitch rather than as a character, and on an empty state
 * it would flicker on each keystroke elsewhere in the page.
 */
let lastRandom: string | null = null;

/**
 * A different one each time, never the same twice running.
 *
 * Same rule as the Free Time scenes and the completion bursts: a repeat reads
 * as "nothing happened", which is the one thing a bit of decoration must not
 * do. Distinct from stickerFor below, which is deliberately the opposite — an
 * empty state has to show the SAME animal every time or the screen looks
 * unstable.
 */
export function randomSticker(): Sticker {
  const options = STICKERS.filter((s) => s.id !== lastRandom);
  const pick = options[Math.floor(Math.random() * options.length)] ?? STICKERS[0];
  lastRandom = pick.id;
  return pick;
}

/** Test seam: forget what was shown last. */
export function resetRandomSticker(): void {
  lastRandom = null;
}

export function stickerFor(seed: string): Sticker {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return STICKERS[h % STICKERS.length];
}
