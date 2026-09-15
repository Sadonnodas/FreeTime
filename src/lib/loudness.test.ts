import { describe, it, expect } from 'vitest';
import { gainFor, peakOfChannels, decibels, TARGET_PEAK, MAX_GAIN } from './loudness';

/**
 * "Voice memos need to be normalized because the volume is too low." The
 * arithmetic is the part that could quietly go wrong: a gain that lowers a
 * loud take, or raises a near-silent one until the room hiss is the loudest
 * thing in it.
 */
describe('normalising a memo on playback', () => {
  it('raises a quiet recording so its loudest moment sits just under full scale', () => {
    // Peaking at a quarter of full scale: raised about four times, to −1 dB.
    const gain = gainFor(0.25);
    expect(gain * 0.25).toBeCloseTo(TARGET_PEAK, 5);
    expect(decibels(gain)).toBe(11);
  });

  it('never makes anything quieter', () => {
    expect(gainFor(0.95)).toBe(1);
    expect(gainFor(1)).toBe(1);
  });

  it('stops at +18 dB, so near-silence does not become loud hiss', () => {
    expect(gainFor(0.001)).toBe(MAX_GAIN);
    expect(decibels(MAX_GAIN)).toBe(18);
  });

  it('leaves a silent or unreadable recording alone', () => {
    expect(gainFor(0)).toBe(1);
    expect(gainFor(Number.NaN)).toBe(1);
  });

  it('finds the peak across every channel, on either side of zero', () => {
    const left = new Float32Array([0.1, -0.2, 0.05]);
    const right = new Float32Array([0.3, -0.45, 0.2]);
    expect(peakOfChannels([left, right])).toBeCloseTo(0.45, 5);
  });
});
