import { describe, expect, it } from 'vitest';
import { createRng } from '../src/rng.js';

describe('createRng', () => {
  it('produces the same sequence for the same seed', () => {
    const a = createRng(42);
    const b = createRng(42);
    const aSeq = Array.from({ length: 20 }, () => a.next());
    const bSeq = Array.from({ length: 20 }, () => b.next());
    expect(aSeq).toEqual(bSeq);
  });

  it('produces different sequences for different seeds', () => {
    const a = createRng(42);
    const b = createRng(43);
    const aSeq = Array.from({ length: 20 }, () => a.next());
    const bSeq = Array.from({ length: 20 }, () => b.next());
    expect(aSeq).not.toEqual(bSeq);
  });

  it('next() returns values in [0, 1)', () => {
    const r = createRng(1);
    for (let i = 0; i < 1000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('nextInt(max) returns integers in [0, max)', () => {
    const r = createRng(7);
    for (let i = 0; i < 1000; i++) {
      const v = r.nextInt(100);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(100);
    }
  });

  it('range(min, max) returns integers in [min, max)', () => {
    const r = createRng(13);
    for (let i = 0; i < 1000; i++) {
      const v = r.range(50, 60);
      expect(Number.isInteger(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(50);
      expect(v).toBeLessThan(60);
    }
  });

  it('is stable across calls — locked prefix for seed 0', () => {
    // Locking the first 3 outputs so we notice if anyone changes the PRNG.
    // These values come from our mulberry32 implementation; what matters
    // is that they never silently drift.
    const r = createRng(0);
    expect(r.next()).toBeCloseTo(0.26642920868471265, 10);
    expect(r.next()).toBeCloseTo(0.0003297457005828619, 10);
    expect(r.next()).toBeCloseTo(0.2232720274478197, 10);
  });
});
