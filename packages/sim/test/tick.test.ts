import { describe, expect, it } from 'vitest';
import { hasQueenAt } from '../src/specialists.js';
import { generateWorld } from '../src/world-gen.js';
import { tick } from '../src/tick.js';
import { electricalOutput, totalDrillers } from '../src/production.js';
import {
  DAY_MS,
  FACTORY_CYCLE_MS,
  FACTORY_DRILLERS_PER_CYCLE,
  HOUR_MS,
} from '../src/types.js';

describe('tick — basics', () => {
  it('advances world.time by dtMs', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    tick(w, HOUR_MS);
    expect(w.time).toBe(HOUR_MS);
    tick(w, 2 * HOUR_MS);
    expect(w.time).toBe(3 * HOUR_MS);
  });

  it('rejects negative dtMs', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    expect(() => tick(w, -1)).toThrow();
  });

  it('rejects non-finite dtMs', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    expect(() => tick(w, Number.NaN)).toThrow();
    expect(() => tick(w, Number.POSITIVE_INFINITY)).toThrow();
  });

  it('tick(0) is a no-op for state', () => {
    const a = generateWorld({ seed: 1, playerCount: 4 });
    const b = generateWorld({ seed: 1, playerCount: 4 });
    tick(b, 0);
    expect(b).toEqual(a);
  });
});

describe('tick — factory production', () => {
  it('produces exactly 6 drillers per 8 hours per factory (uncapped, single owner)', () => {
    // Tick exactly one cycle length forward. Since factory phases are
    // randomized in [0, 8h), every factory's first scheduled cycle is
    // strictly < 8h, so after one full 8h all factories should have
    // produced at least once. Use a very long horizon to remove the
    // initial-phase staggering effect.
    const w = generateWorld({ seed: 42, playerCount: 4 });
    const playerId = w.players[0]!.id;

    const before = totalDrillers(w, playerId);
    tick(w, DAY_MS); // 24h = 3 full 8h cycles
    const after = totalDrillers(w, playerId);

    // With phase staggering each factory completes between 3 and 4 cycles
    // in a 24h window depending on its starting offset. Average is ~3.
    const factories = w.outposts.filter(
      (o) => o.ownerId === playerId && o.kind === 'factory',
    ).length;
    const minProduced = factories * 3 * FACTORY_DRILLERS_PER_CYCLE;
    const maxProduced = factories * 4 * FACTORY_DRILLERS_PER_CYCLE;
    expect(after - before).toBeGreaterThanOrEqual(minProduced);
    expect(after - before).toBeLessThanOrEqual(maxProduced);
  });

  it('produces 6 drillers exactly when ticking past a factory’s first scheduled cycle', () => {
    const w = generateWorld({ seed: 42, playerCount: 4 });
    const playerId = w.players[0]!.id;

    // Find the factory with the earliest scheduled cycle for this player.
    const factories = w.outposts
      .filter((o) => o.ownerId === playerId && o.kind === 'factory')
      .sort((a, b) => a.nextProductionAt - b.nextProductionAt);
    expect(factories.length).toBeGreaterThan(0);
    const first = factories[0]!;
    const before = first.drillers;

    // Tick to exactly the moment of first.nextProductionAt
    tick(w, first.nextProductionAt);

    expect(first.drillers).toBe(before + FACTORY_DRILLERS_PER_CYCLE);
    // Cycle should be rescheduled +8h later
    expect(first.nextProductionAt).toBeGreaterThan(w.time);
  });

  it('does not exceed the electrical-output cap (steady state)', () => {
    const w = generateWorld({ seed: 42, playerCount: 4 });
    // Run for 14 days — way past any cap-saturation.
    tick(w, 14 * DAY_MS);
    for (const p of w.players) {
      const cap = electricalOutput(w, p.id);
      const stockpile = totalDrillers(w, p.id);
      // We allow stockpile to overshoot by at most a single cycle's
      // production per factory because production is binary at cap:
      // a player at cap-1 with 4 factories ticking at the same instant
      // could push to cap + 4*5 = cap + 20 in the worst case.
      const factories = w.outposts.filter(
        (o) => o.ownerId === p.id && o.kind === 'factory',
      ).length;
      const maxOvershoot = factories * FACTORY_DRILLERS_PER_CYCLE;
      expect(stockpile).toBeLessThanOrEqual(cap + maxOvershoot);
    }
  });

  it('forfeits production when stockpile >= cap', () => {
    const w = generateWorld({ seed: 42, playerCount: 4 });
    const playerId = w.players[0]!.id;
    const cap = electricalOutput(w, playerId);

    // Manually fill the player to the cap on the Queen's home (which has 0
    // drillers, allowing room without exceeding the rule).
    const queenHome = w.outposts.find((o) => o.ownerId === playerId && hasQueenAt(w, o.id))!;
    queenHome.drillers = cap;

    const stockpileBefore = totalDrillers(w, playerId);
    expect(stockpileBefore).toBeGreaterThanOrEqual(cap);

    tick(w, DAY_MS);

    const stockpileAfter = totalDrillers(w, playerId);
    // At-cap: no further production allowed.
    expect(stockpileAfter).toBe(stockpileBefore);
  });

  it('does not produce drillers at dormant outposts', () => {
    const w = generateWorld({ seed: 42, playerCount: 4 });
    // Dormants have ownerId === null. After a long tick they should
    // still have 0 drillers (only owned factories produce).
    tick(w, 14 * DAY_MS);
    const dormants = w.outposts.filter((o) => o.ownerId === null);
    for (const d of dormants) {
      expect(d.drillers).toBe(0);
    }
  });
});

describe('tick — determinism', () => {
  it('same input + same dt → identical output', () => {
    const a = generateWorld({ seed: 99, playerCount: 6 });
    const b = generateWorld({ seed: 99, playerCount: 6 });
    tick(a, 7 * DAY_MS);
    tick(b, 7 * DAY_MS);
    expect(a).toEqual(b);
  });

  it('splitting a tick is equivalent to running it whole', () => {
    const whole = generateWorld({ seed: 7, playerCount: 4 });
    const split = generateWorld({ seed: 7, playerCount: 4 });

    tick(whole, 3 * DAY_MS);

    tick(split, HOUR_MS);
    tick(split, 5 * HOUR_MS);
    tick(split, DAY_MS);
    tick(split, 3 * HOUR_MS);
    tick(split, 2 * DAY_MS - 9 * HOUR_MS);

    expect(split.time).toBe(whole.time);
    expect(split).toEqual(whole);
  });

  it('runs the right number of cycles across exactly 100 cycle lengths', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    // 100 full cycles. After this many ticks every factory has completed
    // exactly 100 cycles relative to its phase. The exact count depends
    // on initial phase offset (each factory had a starting offset in
    // [0, 8h), so by 100*8h every factory has produced 100 times if
    // owned the entire time and never capped).
    //
    // Verify cycle counter matches expectations for one factory.
    const playerId = w.players[0]!.id;
    const factory = w.outposts.find(
      (o) => o.ownerId === playerId && o.kind === 'factory',
    )!;
    const initialPhase = factory.nextProductionAt;
    tick(w, 100 * FACTORY_CYCLE_MS);
    expect(factory.nextProductionAt).toBe(initialPhase + 100 * FACTORY_CYCLE_MS);
  });
});
