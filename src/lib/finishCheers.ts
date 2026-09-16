import { STICKERS, type Sticker } from './stickers';

/**
 * Who turns up when a whole project is finished, and what they say.
 *
 * The first version of the finish card was a heading and some counts, and came
 * back as *"kind of boring for a finished project. At least show me a funny
 * dino that has some funny remark."* Fair: a closet deserves more ceremony than
 * a to-do, and the card was quieter than the tick on Today.
 *
 * Each cheer is a STICKER and a LINE written for that sticker, so the joke is
 * about what the animal in the picture is doing. The house rule for the app's
 * jokes still holds — they are about the dinosaur, never at your expense — and
 * finishing something is the one moment the dinosaur is allowed to be
 * unreservedly delighted on your behalf.
 *
 * Only stickers that read as celebration. Never the same one twice running,
 * remembered across opens, for the reason the Free Time scenes give: a repeat
 * reads as "nothing happened".
 */
export interface Cheer {
  sticker: string;
  line: string;
}

export const CHEERS: Cheer[] = [
  { sticker: 'rainbow-roar', line: 'Roared so hard a rainbow came out. Apologises for nothing.' },
  { sticker: 'sparkles', line: 'Has been sparkling since you tapped that. Cannot be stopped.' },
  { sticker: 'handstand', line: 'First handstand since the Cretaceous. Worth the wait.' },
  { sticker: 'leaping-the-rooftops', line: 'Already off telling the whole neighbourhood.' },
  { sticker: 'a-burst-of-music', line: 'Wrote you an anthem. It is mostly roaring, but with feeling.' },
  { sticker: 'standing-on-the-rainbow', line: 'Standing on a rainbow. Structurally unwise. Emotionally essential.' },
  { sticker: 'tall-and-pleased', line: 'Tall. Pleased. Mostly pleased. Also tall.' },
  { sticker: 'pirate-treasure', line: 'Has filed this one under treasure and will be guarding it.' },
  { sticker: 'small-and-unbothered', line: 'Pretending not to be impressed. Is extremely impressed.' },
  { sticker: 'surfing', line: 'Riding this one all the way to the next ice age.' },
  { sticker: 'a-spray-of-flowers', line: 'Brought flowers. Picked them from a very old fern.' },
  { sticker: 'bubbles', line: 'Celebration bubbles. Sixty-five million years of practice for this.' },
  { sticker: 'snowboarding', line: 'Took the fastest way down the mountain to congratulate you.' },
  { sticker: 'rainbow-arc', line: 'Went and fetched a whole rainbow. Seemed only right.' },
  { sticker: 'flying-a-biplane', line: 'Doing a victory lap. Has not checked the fuel.' },
  { sticker: 'digging-up-fossils', line: 'Future palaeontologists will find this and be very impressed.' },
  { sticker: 'a-cloud-of-rainbow', line: 'Floating. Will come down eventually. Not today.' },
  { sticker: 'orange-and-upright', line: 'Standing up extra straight out of respect.' }
];

const KEY = 'freetime.finish.cheer';

/** A cheer, never the one shown last time. */
export function pickCheer(random: () => number = Math.random): { cheer: Cheer; sticker: Sticker } {
  let last: string | null = null;
  try {
    last = localStorage.getItem(KEY);
  } catch {
    /* no storage — a repeat is possible, which is harmless */
  }
  const options = CHEERS.filter((c) => c.sticker !== last);
  const cheer = options[Math.floor(random() * options.length)] ?? CHEERS[0]!;
  try {
    localStorage.setItem(KEY, cheer.sticker);
  } catch {
    /* as above */
  }
  const sticker = STICKERS.find((s) => s.id === cheer.sticker) ?? STICKERS[0]!;
  return { cheer, sticker };
}
