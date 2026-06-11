import { describe, expect, it } from 'vitest';
import { hasQueenAt } from '../src/specialists.js';
import { generateWorld } from '../src/world-gen.js';
import { tick } from '../src/tick.js';
import { issueDrillOrder } from '../src/mining.js';
import { issueLaunchOrder } from '../src/orders.js';
import {
  DAY_MS,
  NEPTUNIUM_VICTORY_THOUSANDTHS,
} from '../src/types.js';

describe('victory', () => {
  it('starts as null', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    expect(w.winnerId).toBeNull();
  });

  it('declares a winner when neptunium crosses 200 kg', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const playerId = w.players[0]!.id;
    // Cheat: pre-set neptunium just under the threshold.
    w.players[0]!.neptuniumMg = NEPTUNIUM_VICTORY_THOUSANDTHS - 1;
    w.players[0]!.neptuniumLastAt = w.time;
    // Give the player a Mine so accrual happens.
    const factory = w.outposts.find(
      (o) => o.ownerId === playerId && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    factory.drillers = 100;
    issueDrillOrder(w, { ownerId: playerId, outpostId: factory.id });
    tick(w, DAY_MS); // a day of accrual blows past the threshold
    expect(w.winnerId).toBe(playerId);
  });

  it('freezes the world once a winner is set', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const playerId = w.players[0]!.id;
    w.players[0]!.neptuniumMg = NEPTUNIUM_VICTORY_THOUSANDTHS;
    w.players[0]!.neptuniumLastAt = w.time;
    const factory = w.outposts.find(
      (o) => o.ownerId === playerId && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    factory.drillers = 100;
    issueDrillOrder(w, { ownerId: playerId, outpostId: factory.id });
    tick(w, 1); // trigger victory
    expect(w.winnerId).toBe(playerId);

    // Snapshot a non-trivial field on another player; ensure further
    // ticks don't change it.
    const otherDrillers = w.outposts.reduce(
      (s, o) => s + (o.ownerId === w.players[1]!.id ? o.drillers : 0),
      0,
    );
    tick(w, DAY_MS);
    const otherDrillersAfter = w.outposts.reduce(
      (s, o) => s + (o.ownerId === w.players[1]!.id ? o.drillers : 0),
      0,
    );
    expect(otherDrillersAfter).toBe(otherDrillers);
  });

  it('20% Neptunium penalty applies on mine capture', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    // Give B a Mine and pre-set their neptunium.
    const bOutpost = w.outposts.find((o) => o.ownerId === b && !hasQueenAt(w, o.id))!;
    bOutpost.kind = 'mine';
    bOutpost.drillers = 0; // free capture
    bOutpost.shieldKind = 'weak';
    bOutpost.shieldCharge = 0;
    // Push shield-recharge far into the future so it stays 0 at arrival.
    bOutpost.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    w.players[1]!.neptuniumMg = 100_000; // 100 kg
    w.players[1]!.neptuniumLastAt = w.time;
    // Launch overwhelming force from A.
    const source = w.outposts.find((o) => o.ownerId === a && !hasQueenAt(w, o.id))!;
    source.drillers = 100;
    issueLaunchOrder(w, {
      ownerId: a,
      sourceId: source.id,
      destinationId: bOutpost.id,
      drillers: 100,
    });
    const sub = w.subs[0]!;
    // Compute exactly what B will have accrued by the time of combat.
    // B has 1 mine and 5 outposts at constant rate during the trip.
    const travel = sub.arrivalAt - w.time;
    const accrued = Math.floor((travel * 1 * 5 * 1000) / DAY_MS);
    const preCombat = 100_000 + accrued;
    const penalty = Math.ceil(preCombat / 5);
    const expectedAfter = preCombat - penalty;
    tick(w, sub.arrivalAt - w.time);
    expect(w.players[1]!.neptuniumMg).toBe(expectedAfter);
    expect(bOutpost.ownerId).toBe(a);
    expect(bOutpost.kind).toBe('mine');
  });
});
