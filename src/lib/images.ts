/**
 * Turning a phone photo into something small enough to live in the database.
 *
 * Images sync inside their table's JSON file as data URLs, so they are resized
 * hard first. A phone photo is 3–5 MB; left alone, a handful of them would make
 * every sync upload larger than the entire rest of the database put together.
 *
 * Two sizes, because the two uses are genuinely different: a project cover is
 * only ever drawn at half the screen width, while a photo block can be the full
 * width of the card and is worth more pixels.
 */

export const COVER_EDGE = 640;
/** A part in a shopping list, shown as a thumbnail and at most full width in
 *  the viewer. Small: it is a reminder of which bracket you meant, not art. */
export const THUMB_EDGE = 480;
export const WIDGET_EDGE = 1000;
const QUALITY = 0.72;

export async function resizeImage(
  file: File,
  maxEdge: number = WIDGET_EDGE,
  quality: number = QUALITY
): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Cannot process images in this browser.');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close();

  return canvas.toDataURL('image/jpeg', quality);
}
