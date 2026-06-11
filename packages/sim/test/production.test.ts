import { describe, expect, it } from 'vitest';
import { hasQueenAt } from '../src/specialists.js';
import { generateWorld } from '../src/world-gen.js';
import { electricalOutput, totalDrillers } from '../src/production.js';
import type { PlayerId } from '../src/types.js';
import {
  GENERATOR_ELECTRICAL_OUTPUT,
  QUEEN_ELECTRICAL_OUTPUT,
  STARTING_DRILLERS,
  STARTING_OUTPOSTS_PER_PLAYER,
} from '../src/types.js';

describe('electricalOutput', () => {
  it('counts the Queen home (+150) plus 50 per Generator', () => {
    const w = generateWorld({ seed: 42, playerCount: 4 });
    for (const p of w.players) {
      const owned = w.outposts.filter((o) => o.ownerId === p.id);
      const queenHome = owned.find((o) => hasQueenAt(w, o.id))!;
      const generators = owned.filter((o) => o.kind === 'generator').length;
      const expected =
        QUEEN_ELECTRICAL_OUTPUT + generators * GENERATOR_ELECTRICAL_OUTPUT;
      expect(electricalOutput(w, p.id)).toBe(expected);
      // Sanity: queenHome exists and is owned by p
      expect(queenHome.ownerId).toBe(p.id);
    }
  });

  it('returns 0 for an unknown player', () => {
    const w = generateWorld({ seed: 1, playerCount: 2 });
    expect(electricalOutput(w, 99 as PlayerId)).toBe(0);
  });
});

describe('totalDrillers', () => {
  it('sums drillers across all of a player’s outposts', () => {
    const w = generateWorld({ seed: 42, playerCount: 4 });
    for (const p of w.players) {
      // Queen home has 0, the other 4 outposts have 40 each.
      expect(totalDrillers(w, p.id)).toBe(
        (STARTING_OUTPOSTS_PER_PLAYER - 1) * STARTING_DRILLERS,
      );
    }
  });

  it('returns 0 for an unknown player', () => {
    const w = generateWorld({ seed: 1, playerCount: 2 });
    expect(totalDrillers(w, 99 as PlayerId)).toBe(0);
  });
});
