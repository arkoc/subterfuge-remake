import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { MAP_SIZE, STARTING_DRILLERS } from '../src/types.js';
import { activeQueenOf, hasQueenAt } from '../src/specialists.js';

describe('generateWorld', () => {
  it('rejects out-of-range player counts', () => {
    expect(() => generateWorld({ seed: 1, playerCount: 1 })).toThrow();
    expect(() => generateWorld({ seed: 1, playerCount: 11 })).toThrow();
  });

  it('rejects non-integer seeds', () => {
    expect(() => generateWorld({ seed: 1.5, playerCount: 4 })).toThrow();
  });

  it('produces N players and N*10 outposts', () => {
    for (const n of [2, 4, 6, 8, 10]) {
      const w = generateWorld({ seed: 99, playerCount: n });
      expect(w.players).toHaveLength(n);
      expect(w.outposts).toHaveLength(n * 10);
    }
  });

  it('gives each player exactly 5 owned outposts', () => {
    const w = generateWorld({ seed: 99, playerCount: 4 });
    for (const p of w.players) {
      const owned = w.outposts.filter((o) => o.ownerId === p.id);
      expect(owned).toHaveLength(5);
    }
  });

  it('spawns exactly one active Queen per player at one of their outposts', () => {
    const w = generateWorld({ seed: 99, playerCount: 4 });
    for (const p of w.players) {
      const queen = activeQueenOf(w, p.id);
      expect(queen).not.toBeNull();
      expect(queen!.location.kind).toBe('outpost');
      const home = w.outposts.find(
        (o) => queen!.location.kind === 'outpost' && o.id === queen!.location.id,
      );
      expect(home).toBeDefined();
      expect(home!.ownerId).toBe(p.id);
    }
  });

  it('non-Queen owned outposts start with 40 drillers; Queen home starts with 0', () => {
    const w = generateWorld({ seed: 99, playerCount: 4 });
    for (const o of w.outposts) {
      if (o.ownerId === null) continue;
      if (hasQueenAt(w, o.id)) {
        expect(o.drillers).toBe(0);
      } else {
        expect(o.drillers).toBe(STARTING_DRILLERS);
      }
    }
  });

  it('leaves N*5 outposts dormant', () => {
    const w = generateWorld({ seed: 99, playerCount: 4 });
    const dormant = w.outposts.filter((o) => o.ownerId === null);
    expect(dormant).toHaveLength(20);
  });

  it('starts with time=0 and shieldCharge=0 (per docs)', () => {
    const w = generateWorld({ seed: 99, playerCount: 4 });
    expect(w.time).toBe(0);
    for (const o of w.outposts) {
      expect(o.shieldCharge).toBe(0);
    }
  });

  it('places all outposts inside the map bounds', () => {
    const w = generateWorld({ seed: 99, playerCount: 8 });
    for (const o of w.outposts) {
      expect(o.pos.x).toBeGreaterThanOrEqual(0);
      expect(o.pos.x).toBeLessThan(MAP_SIZE);
      expect(o.pos.y).toBeGreaterThanOrEqual(0);
      expect(o.pos.y).toBeLessThan(MAP_SIZE);
      expect(Number.isInteger(o.pos.x)).toBe(true);
      expect(Number.isInteger(o.pos.y)).toBe(true);
    }
  });

  it('is deterministic: same seed → identical world', () => {
    const a = generateWorld({ seed: 12345, playerCount: 6 });
    const b = generateWorld({ seed: 12345, playerCount: 6 });
    expect(a).toEqual(b);
  });

  it('different seeds produce different layouts', () => {
    const a = generateWorld({ seed: 1, playerCount: 4 });
    const b = generateWorld({ seed: 2, playerCount: 4 });
    // At least one outpost position must differ.
    const same = a.outposts.every(
      (o, i) => o.pos.x === b.outposts[i]!.pos.x && o.pos.y === b.outposts[i]!.pos.y,
    );
    expect(same).toBe(false);
  });

  it('gives every outpost a name', () => {
    const w = generateWorld({ seed: 99, playerCount: 10 });
    for (const o of w.outposts) {
      expect(o.name.length).toBeGreaterThan(0);
    }
  });
});
