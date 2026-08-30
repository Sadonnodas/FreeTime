import { base } from "$app/paths";

/**
 * The dinosaurs.
 *
 * Fifty-five of them, cut out of the sticker sheets Toon drew up (see
 * scripts/slice-stickers.py, which did the cutting). They are the second kind
 * of dinosaur in the app and they do a different job from the first: Dino.svelte
 * is one animal, in line art, that recolours with the theme and stands in for
 * the app itself. These are full-colour characters doing something specific,
 * and they are picked BY the person rather than assigned by the app.
 *
 * THEY ARE PRECACHED, all 55 of them, about 740KB on top of a 1.8MB build.
 * That looked like a bad trade at first — a set where a person may only ever
 * use eight, downloaded in full at install. It is the right one anyway: this
 * app is offline by default, a project cover is the largest thing on the
 * Projects screen, and a cover that renders blank because the device happens
 * to be on a train reads as data that has gone missing rather than as an image
 * that has not loaded. The stickers ship with the app because they ARE the app,
 * the way the icon is.
 */
export interface Sticker {
  id: string;
  /** Shown under the picture. Describes what it is doing, not what it is. */
  label: string;
}

export const STICKERS: Sticker[] = [
  { id: "a-burst-of-music", label: "a burst of music" },
  { id: "a-cloud-of-rainbow", label: "a cloud of rainbow" },
  { id: "a-spray-of-flowers", label: "a spray of flowers" },
  { id: "a-wave-of-water", label: "a wave of water" },
  { id: "at-the-mixing-desk", label: "at the mixing desk" },
  { id: "at-the-telescope", label: "at the telescope" },
  { id: "at-the-typewriter", label: "at the typewriter" },
  { id: "behind-the-decks", label: "behind the decks" },
  { id: "board-game-night", label: "board game night" },
  { id: "bubbles", label: "bubbles" },
  { id: "building-a-landscape", label: "building a landscape" },
  { id: "building-a-toy-car", label: "building a toy car" },
  { id: "digging-up-fossils", label: "digging up fossils" },
  { id: "drawing-on-a-tablet", label: "drawing on a tablet" },
  { id: "flying-a-biplane", label: "flying a biplane" },
  { id: "fruit-salad", label: "fruit salad" },
  { id: "fruit-salad-again", label: "fruit salad, again" },
  { id: "handstand", label: "handstand" },
  { id: "just-standing-there", label: "just standing there" },
  { id: "knitting-a-scarf", label: "knitting a scarf" },
  { id: "leaping-the-rooftops", label: "leaping the rooftops" },
  { id: "model-railway", label: "model railway" },
  { id: "ninja-on-a-bridge", label: "ninja on a bridge" },
  { id: "on-the-keytar", label: "on the keytar" },
  { id: "on-the-moon", label: "on the moon" },
  { id: "orange-and-upright", label: "orange and upright" },
  { id: "over-the-canyon", label: "over the canyon" },
  { id: "painting-at-an-easel", label: "painting at an easel" },
  { id: "pirate-treasure", label: "pirate treasure" },
  { id: "playing-guitar", label: "playing guitar" },
  { id: "pouring-coffee", label: "pouring coffee" },
  { id: "puzzle-pieces", label: "puzzle pieces" },
  { id: "rainbow-arc", label: "rainbow arc" },
  { id: "rainbow-arc-2", label: "rainbow arc" },
  { id: "rainbow-contrail", label: "rainbow contrail" },
  { id: "rainbow-roar", label: "rainbow roar" },
  { id: "rainbow-skate-ramp", label: "rainbow skate ramp" },
  { id: "rainbow-swirl", label: "rainbow swirl" },
  { id: "reading", label: "reading" },
  { id: "recording-studio", label: "recording studio" },
  { id: "rolling-sushi", label: "rolling sushi" },
  { id: "satellite-repair", label: "satellite repair" },
  { id: "scuba-diving", label: "scuba diving" },
  { id: "skate-ramp", label: "skate ramp" },
  { id: "small-and-unbothered", label: "small and unbothered" },
  { id: "snowboarding", label: "snowboarding" },
  { id: "sparkles", label: "sparkles" },
  { id: "standing-on-the-rainbow", label: "standing on the rainbow" },
  { id: "surfing", label: "surfing" },
  { id: "tailoring-a-suit", label: "tailoring a suit" },
  { id: "tall-and-pleased", label: "tall and pleased" },
  { id: "through-the-fire-hoop", label: "through the fire hoop" },
  { id: "throwing-a-pot", label: "throwing a pot" },
  { id: "unearthing-eggs", label: "unearthing eggs" },
  { id: "weaving", label: "weaving" },
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
export function stickerFor(seed: string): Sticker {
  let h = 0;
  for (const ch of seed) h = (h * 31 + ch.charCodeAt(0)) % 100000;
  return STICKERS[h % STICKERS.length];
}
