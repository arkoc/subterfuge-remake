import { describe, expect, it } from 'vitest';
import { dist, distSquared, torusDelta, wrapCoord } from '../src/geometry.js';
import { MAP_SIZE } from '../src/types.js';

describe('torus geometry', () => {
  it('distSquared handles wrap on both axes', () => {
    // Two points near opposite edges: linear distance huge, toroidal small.
    const a = { x: 200, y: 200 };
    const b = { x: MAP_SIZE - 200, y: MAP_SIZE - 200 };
    // Linear: sqrt(((MAP_SIZE-400)^2) * 2)
    // Toroidal: sqrt((400^2) * 2)
    expect(distSquared(a, b)).toBe(400 * 400 + 400 * 400);
    expect(dist(a, b)).toBeCloseTo(Math.sqrt(2) * 400, 6);
  });

  it('non-wrapping case matches Euclidean', () => {
    const a = { x: 1000, y: 1000 };
    const b = { x: 4000, y: 5000 };
    expect(distSquared(a, b)).toBe(3000 * 3000 + 4000 * 4000);
  });

  it('torusDelta picks the shorter signed direction', () => {
    expect(torusDelta(9500, 200)).toBe(700);
    expect(torusDelta(200, 9500)).toBe(-700);
    expect(torusDelta(1000, 1000)).toBe(0);
    // Exactly half — go forward by convention (>, not >=).
    expect(torusDelta(0, MAP_SIZE / 2)).toBe(MAP_SIZE / 2);
  });

  it('wrapCoord brings values into [0, MAP_SIZE)', () => {
    expect(wrapCoord(0)).toBe(0);
    expect(wrapCoord(MAP_SIZE)).toBe(0);
    expect(wrapCoord(MAP_SIZE + 100)).toBe(100);
    expect(wrapCoord(-50)).toBe(MAP_SIZE - 50);
    expect(wrapCoord(-MAP_SIZE - 50)).toBe(MAP_SIZE - 50);
  });
});
