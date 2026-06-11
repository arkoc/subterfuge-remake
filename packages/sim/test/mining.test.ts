import { describe, expect, it } from 'vitest';
import { hasQueenAt } from '../src/specialists.js';
import { generateWorld } from '../src/world-gen.js';
import {
  commitNeptunium,
  drillCost,
  issueDrillOrder,
  liveNeptuniumThousandths,
  mineCount,
  outpostCount,
} from '../src/mining.js';
import { tick } from '../src/tick.js';
import { DAY_MS } from '../src/types.js';

describe('drillCost', () => {
  it('follows the documented ladder: 50, 100, 200, 300, 400, 500', () => {
    expect(drillCost(0)).toBe(50);
    expect(drillCost(1)).toBe(100);
    expect(drillCost(2)).toBe(200);
    expect(drillCost(3)).toBe(300);
    expect(drillCost(4)).toBe(400);
    expect(drillCost(5)).toBe(500);
    expect(drillCost(10)).toBe(1000);
  });

  it('rejects negative input', () => {
    expect(() => drillCost(-1)).toThrow();
  });
});

describe('issueDrillOrder', () => {
  it('converts an owned Factory into a Mine and consumes 50 drillers', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const playerId = w.players[0]!.id;
    const factory = w.outposts.find(
      (o) => o.ownerId === playerId && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    factory.drillers = 100;
    issueDrillOrder(w, { ownerId: playerId, outpostId: factory.id });
    expect(factory.kind).toBe('mine');
    expect(factory.drillers).toBe(50);
    expect(w.players[0]!.minesDrilled).toBe(1);
  });

  it('cost escalates after each drill', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const playerId = w.players[0]!.id;
    const owned = w.outposts.filter(
      (o) => o.ownerId === playerId && !hasQueenAt(w, o.id) && o.kind !== 'mine',
    );
    expect(owned.length).toBeGreaterThanOrEqual(3);
    for (const o of owned) o.drillers = 1000;

    issueDrillOrder(w, { ownerId: playerId, outpostId: owned[0]!.id });
    expect(owned[0]!.drillers).toBe(950); // 1000 - 50
    issueDrillOrder(w, { ownerId: playerId, outpostId: owned[1]!.id });
    expect(owned[1]!.drillers).toBe(900); // 1000 - 100
    issueDrillOrder(w, { ownerId: playerId, outpostId: owned[2]!.id });
    expect(owned[2]!.drillers).toBe(800); // 1000 - 200
  });

  it('rejects drilling a Mine, a Queen home, or an enemy outpost', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const playerId = w.players[0]!.id;
    const queenHome = w.outposts.find((o) => o.ownerId === playerId && hasQueenAt(w, o.id))!;
    queenHome.drillers = 100;
    expect(() =>
      issueDrillOrder(w, { ownerId: playerId, outpostId: queenHome.id }),
    ).toThrow();

    const enemy = w.outposts.find((o) => o.ownerId === w.players[1]!.id)!;
    expect(() => issueDrillOrder(w, { ownerId: playerId, outpostId: enemy.id })).toThrow();

    const factory = w.outposts.find(
      (o) => o.ownerId === playerId && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    factory.drillers = 100;
    issueDrillOrder(w, { ownerId: playerId, outpostId: factory.id });
    // Drilling an already-mine
    expect(() => issueDrillOrder(w, { ownerId: playerId, outpostId: factory.id })).toThrow();
  });

  it('rejects when source lacks enough drillers', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const playerId = w.players[0]!.id;
    const factory = w.outposts.find(
      (o) => o.ownerId === playerId && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    factory.drillers = 49; // need 50 for first
    expect(() => issueDrillOrder(w, { ownerId: playerId, outpostId: factory.id })).toThrow();
  });
});

describe('neptunium accrual', () => {
  it('produces 0 with no mines', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    tick(w, DAY_MS);
    for (const p of w.players) {
      expect(liveNeptuniumThousandths(w, p, w.time)).toBe(0);
    }
  });

  it('produces 1 kg/day per (mine × outpost) when 1 mine exists', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const playerId = w.players[0]!.id;
    const factory = w.outposts.find(
      (o) => o.ownerId === playerId && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    factory.drillers = 50;
    issueDrillOrder(w, { ownerId: playerId, outpostId: factory.id });
    const outposts = outpostCount(w, playerId);
    expect(mineCount(w, playerId)).toBe(1);

    tick(w, DAY_MS);
    const live = liveNeptuniumThousandths(w, w.players[0]!, w.time);
    // 1 kg/day × outposts (in thousandths). With 5 outposts → 5_000.
    expect(live).toBe(1 * outposts * 1000);
  });

  it('commitNeptunium writes the checkpoint to the live value', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const playerId = w.players[0]!.id;
    const factory = w.outposts.find(
      (o) => o.ownerId === playerId && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    factory.drillers = 50;
    issueDrillOrder(w, { ownerId: playerId, outpostId: factory.id });
    tick(w, DAY_MS);
    commitNeptunium(w, playerId, w.time);
    const stored = w.players[0]!.neptuniumMg;
    const live = liveNeptuniumThousandths(w, w.players[0]!, w.time);
    expect(stored).toBe(live);
  });
});
