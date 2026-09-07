import { describe, it, expect, beforeEach } from 'vitest';
import { BURSTS, pickBurst, resetBursts, particlesFor } from './celebrate';

beforeEach(resetBursts);

describe('the celebration varies', () => {
  it('never plays the same one twice running', () => {
    // A repeat reads as "nothing happened" — the same reason the Free Time
    // scenes remember their previous id.
    let last = '';
    for (let i = 0; i < 60; i++) {
      const b = pickBurst();
      expect(b.id).not.toBe(last);
      last = b.id;
    }
  });

  it('can still reach every variant', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 400; i++) seen.add(pickBurst().id);
    expect(seen.size).toBe(BURSTS.length);
  });
});

describe('where the pieces go', () => {
  const even = () => 0.5; // no jitter, so the geometry is checkable

  it('spreads them evenly around the circle before jittering', () => {
    const angles = particlesFor(BURSTS[0], even).map((p) => p.angle);
    expect(angles[0]).toBe(0);
    expect(angles[1]).toBeCloseTo(360 / BURSTS[0].count);
  });

  it('gives every piece a colour from its own set', () => {
    for (const burst of BURSTS) {
      for (const p of particlesFor(burst, even)) {
        expect(burst.colors).toContain(p.color);
      }
    }
  });

  it('keeps every piece inside a sensible spread and a short life', () => {
    // A particle that flies a long way or lingers turns a full stop into an
    // event you have to wait out before tapping the next thing.
    for (const burst of BURSTS) {
      for (const p of particlesFor(burst)) {
        expect(p.distance).toBeGreaterThan(0);
        expect(p.distance).toBeLessThanOrEqual(burst.spread * 1.2);
        expect(p.durationMs).toBeLessThanOrEqual(760);
        expect(p.delayMs).toBeLessThanOrEqual(70);
      }
    }
  });

  it('makes as many pieces as the burst asks for', () => {
    for (const burst of BURSTS) {
      expect(particlesFor(burst)).toHaveLength(burst.count);
    }
  });
});
