import { STICKERS, type Sticker } from './stickers';

/**
 * Who turns up when a whole list is finished off, and what they say.
 *
 * The first version of the cleared-list line was *"That's the list clear."* in
 * green, and it came back as *"that's kind of boring. Make it fun!"* — which
 * is the same note the finished-project card got, in the same words, and the
 * answer is the same: a dinosaur, and a line about what the dinosaur is doing.
 *
 * **SCALED FOR SOMETHING THAT HAPPENS EVERY DAY.** The finish card is a whole
 * screen, a 240px sticker and four seconds of confetti, because finishing a
 * project is rare. Clearing today's list is a Tuesday. So this is inline in
 * the section it belongs to, the animal is thumbnail-sized, and it leaves
 * again after a few seconds. Fun, not a takeover — a full-screen interruption
 * every evening would be the app talking over you, which is the thing the
 * no-nag rule is really about.
 *
 * The house rule holds and is tested: **the joke is about the dinosaur, never
 * about you.** Nothing here says "well done", nothing implies you nearly did
 * not, and nothing mentions tomorrow — an app that congratulates you and then
 * points at the next day has just handed you a streak.
 */
export interface ClearCheer {
  sticker: string;
  line: string;
}

export const CLEAR_CHEERS: ClearCheer[] = [
  { sticker: 'pouring-coffee', line: 'Putting the kettle on. That is the lot.' },
  { sticker: 'small-and-unbothered', line: 'Nothing left on the list. Suspiciously pleased about it.' },
  { sticker: 'handstand', line: 'Upside down, and still nothing left to do.' },
  { sticker: 'reading', line: 'List cleared. Back to the book.' },
  { sticker: 'sparkles', line: 'Sparkling quietly. It is that kind of evening.' },
  { sticker: 'surfing', line: 'Caught the last one. Riding it in.' },
  { sticker: 'bubbles', line: 'Blowing bubbles instead. Earned it.' },
  { sticker: 'fruit-salad', line: 'Celebrating with fruit salad. Again.' },
  { sticker: 'board-game-night', line: 'Setting up the board. You are clear for the evening.' },
  { sticker: 'knitting-a-scarf', line: 'Two rows of scarf, nothing left on the list.' },
  { sticker: 'playing-guitar', line: 'Playing the one song it knows. Loudly.' },
  { sticker: 'a-spray-of-flowers', line: 'Flowers, for no particular reason.' },
  { sticker: 'rainbow-swirl', line: 'Did a small loop. Nobody saw. It counts.' },
  { sticker: 'snowboarding', line: 'Straight down the mountain, list in hand.' },
  { sticker: 'tall-and-pleased', line: 'Standing there looking extremely pleased.' },
  { sticker: 'on-the-moon', line: 'Gone to the moon. Nothing was left here anyway.' },
  { sticker: 'rolling-sushi', line: 'Rolling sushi to mark the occasion.' },
  { sticker: 'just-standing-there', line: 'Not doing anything. Highly recommends it.' },
  { sticker: 'scuba-diving', line: 'Down among the fish, where there are no lists.' },
  { sticker: 'model-railway', line: 'Running the little train around once, for you.' }
];

const KEY = 'freetime.clear.cheer';

/**
 * A cheer, never the one shown last time.
 *
 * Its own storage key, separate from the finish card's: they are different
 * occasions and a repeat across them is not a repeat. Same reasoning as the
 * Free Time scenes — an identical celebration stops being one, and the
 * SECOND time you see the same dinosaur in a day it reads as nothing having
 * happened.
 */
export function pickClearCheer(random: () => number = Math.random): {
  cheer: ClearCheer;
  sticker: Sticker;
} {
  let last: string | null = null;
  try {
    last = localStorage.getItem(KEY);
  } catch {
    /* no storage — a repeat is possible, which is harmless */
  }
  const options = CLEAR_CHEERS.filter((c) => c.sticker !== last);
  const cheer = options[Math.floor(random() * options.length)] ?? CLEAR_CHEERS[0]!;
  try {
    localStorage.setItem(KEY, cheer.sticker);
  } catch {
    /* as above */
  }
  const sticker = STICKERS.find((s) => s.id === cheer.sticker) ?? STICKERS[0]!;
  return { cheer, sticker };
}
