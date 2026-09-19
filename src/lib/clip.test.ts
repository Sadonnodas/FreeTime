import { describe, it, expect } from 'vitest';
import { parseClip, parsePrice, noteText } from './clip';

const hash = (o: Record<string, string>) => '#' + new URLSearchParams(o).toString();

describe('reading a price off a web page', () => {
  it('handles both decimal styles and thousands', () => {
    expect(parsePrice('12.99')).toBe(1299);
    expect(parsePrice('12,99')).toBe(1299);
    expect(parsePrice('€ 1.299,00')).toBe(129900);
    expect(parsePrice('1,299.00')).toBe(129900);
    expect(parsePrice('$5')).toBe(500);
    expect(parsePrice('19.9')).toBe(1990);
  });

  it('leaves out what is not a price', () => {
    expect(parsePrice('free')).toBeUndefined();
    expect(parsePrice('')).toBeUndefined();
    expect(parsePrice('0')).toBeUndefined();
  });
});

describe('a hand-over from the extension', () => {
  it('reads a product', () => {
    const c = parseClip(
      hash({ kind: 'buy', title: '  Hinge   set ', url: 'https://shop.example/hinge', price: '4,95', currency: 'eur' })
    )!;
    expect(c).toMatchObject({ kind: 'buy', title: 'Hinge set', priceCents: 495, currency: 'EUR' });
    expect(c.url).toBe('https://shop.example/hinge');
  });

  it('drops anything unsafe rather than keeping it', () => {
    const c = parseClip(
      hash({ kind: 'weird', title: 'x', url: 'javascript:alert(1)', image: 'https://tracker.example/pixel.png' })
    )!;
    expect(c.kind).toBe('idea');
    expect(c.url).toBeUndefined();
    expect(c.image).toBeUndefined();
  });

  it('keeps a small data image', () => {
    const img = 'data:image/jpeg;base64,/9j/4AAQSkZJRg==';
    expect(parseClip(hash({ title: 'x', image: img }))!.image).toBe(img);
  });

  it('turns a selection into a note that says where it came from', () => {
    const c = parseClip(hash({ text: 'Sand with 120 then 240.', title: 'Finishing oak', url: 'https://wood.example/oak' }))!;
    expect(c.kind).toBe('note');
    expect(noteText(c)).toBe('Sand with 120 then 240.\n\n— [Finishing oak](https://wood.example/oak)');
  });

  it('names a bare link after its site, and refuses an empty hand-over', () => {
    expect(parseClip(hash({ url: 'https://www.youtube.com/watch?v=1' }))!.title).toBe('youtube.com');
    expect(parseClip('')).toBeNull();
  });
});
