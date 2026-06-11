import { describe, expect, it } from 'vitest';
import { hasQueenAt } from '../src/specialists.js';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { tick } from '../src/tick.js';
import { subPosition, subStatus, travelTimeBetween } from '../src/subs.js';
import { outpostById } from '../src/queries.js';
import { torusDelta, wrapCoord } from '../src/geometry.js';
import {
  DAY_MS,
  HOUR_MS,
  LAUNCH_DELAY_MS,
  MINUTE_MS,
  type PlayerId,
} from '../src/types.js';

function setupLaunch(seed: number, playerCount: number, drillers: number) {
  const w = generateWorld({ seed, playerCount });
  const playerId = w.players[0]!.id;
  const source = w.outposts
    .filter((o) => o.ownerId === playerId && !hasQueenAt(w, o.id))
    .sort((a, b) => b.drillers - a.drillers)[0]!;
  const dest = w.outposts.find((o) => o.ownerId === null)!;
  const subId = issueLaunchOrder(w, {
    ownerId: playerId,
    sourceId: source.id,
    destinationId: dest.id,
    drillers,
  });
  return { w, playerId, source, dest, subId };
}

describe('sub status and position', () => {
  it('is queued while now < launchAt; in_flight after', () => {
    const { w } = setupLaunch(1, 4, 10);
    const sub = w.subs[0]!;
    expect(subStatus(sub, 0)).toBe('queued');
    expect(subStatus(sub, sub.launchAt - 1)).toBe('queued');
    expect(subStatus(sub, sub.launchAt)).toBe('in_flight');
    expect(subStatus(sub, sub.launchAt + 1)).toBe('in_flight');
  });

  it('subPosition is at source while queued, interpolates while in flight', () => {
    const { w, source, dest } = setupLaunch(1, 4, 10);
    const sub = w.subs[0]!;
    // Queued
    expect(subPosition(w, sub, 0)).toEqual(source.pos);
    // Halfway through flight — uses the toroidally-shortest direction
    const mid = (sub.launchAt + sub.arrivalAt) / 2;
    const pos = subPosition(w, sub, mid);
    const dx = torusDelta(source.pos.x, dest.pos.x);
    const dy = torusDelta(source.pos.y, dest.pos.y);
    expect(pos.x).toBe(Math.round(wrapCoord(source.pos.x + dx / 2)));
    expect(pos.y).toBe(Math.round(wrapCoord(source.pos.y + dy / 2)));
  });
});

describe('tick — sub arrival', () => {
  it('does not arrive before launchAt + travelTime', () => {
    const { w, dest } = setupLaunch(1, 4, 10);
    const sub = w.subs[0]!;

    tick(w, LAUNCH_DELAY_MS + 1); // just past launch, still in flight
    expect(w.subs).toHaveLength(1);
    expect(dest.ownerId).toBe(null);

    tick(w, sub.arrivalAt - w.time - 1); // 1ms before arrival
    expect(w.subs).toHaveLength(1);
    expect(dest.ownerId).toBe(null);
  });

  it('arrives exactly at arrivalAt and captures dormant', () => {
    const { w, dest, playerId } = setupLaunch(1, 4, 10);
    const sub = w.subs[0]!;
    tick(w, sub.arrivalAt);
    expect(w.subs).toHaveLength(0);
    expect(dest.ownerId).toBe(playerId);
    expect(dest.drillers).toBe(10);
  });

  it('does not deduct drillers from source again at arrival (already deducted at order time)', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const playerId = w.players[0]!.id;
    const source = w.outposts.filter((o) => o.ownerId === playerId && !hasQueenAt(w, o.id))[0]!;
    const dest = w.outposts.find((o) => o.ownerId === null)!;
    const startingSourceDrillers = source.drillers;
    issueLaunchOrder(w, {
      ownerId: playerId,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 10,
    });
    expect(source.drillers).toBe(startingSourceDrillers - 10);
    const sub = w.subs[0]!;
    // Tick to the precise moment of arrival, no further — so any
    // post-capture production at the new outpost can't interfere.
    tick(w, sub.arrivalAt);
    // The captured dest has exactly the sub cargo, not double, and the
    // sub itself was destroyed.
    expect(dest.drillers).toBe(10);
    expect(w.subs).toHaveLength(0);
  });

  it('merges cargo into a friendly outpost (reinforcement)', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const playerId = w.players[0]!.id;
    const owned = w.outposts.filter((o) => o.ownerId === playerId);
    const source = owned.filter((o) => !hasQueenAt(w, o.id)).sort(
      (a, b) => b.drillers - a.drillers,
    )[0]!;
    const friendly = owned.find((o) => o.id !== source.id && !hasQueenAt(w, o.id))!;
    const friendlyBefore = friendly.drillers;
    issueLaunchOrder(w, {
      ownerId: playerId,
      sourceId: source.id,
      destinationId: friendly.id,
      drillers: 10,
    });
    const sub = w.subs[0]!;
    // Tick exactly to arrival.
    tick(w, sub.arrivalAt);
    expect(w.subs).toHaveLength(0);
    expect(friendly.ownerId).toBe(playerId);
    // Friendly may also have produced drillers during the trip if it's a
    // Factory. Just verify reinforcement added at least the cargo.
    expect(friendly.drillers).toBeGreaterThanOrEqual(friendlyBefore + 10);
  });

  it('factory production and sub arrival interleave correctly in one tick', () => {
    // Set up a launch from source whose arrival lands well past several
    // factory cycles. Verify both effects happen.
    const { w, source, dest } = setupLaunch(7, 4, 10);
    const playerId = source.ownerId!;
    const sub = w.subs[0]!;
    const tripMs = sub.arrivalAt - w.time;
    expect(tripMs).toBeGreaterThan(8 * HOUR_MS); // ensure multiple cycles fit
    tick(w, tripMs); // tick exactly to arrival
    // Sub arrived
    expect(w.subs).toHaveLength(0);
    expect(dest.ownerId).toBe(playerId);
    // Player should have gained drillers from factory cycles in the same tick
    const ownerDrillers = w.outposts
      .filter((o) => o.ownerId === playerId)
      .reduce((s, o) => s + o.drillers, 0);
    expect(ownerDrillers).toBeGreaterThan(160 - 10); // started 160, sent 10 → 150 floor; production adds
  });

  it('reinforcing a friendly Generator increases the electrical-output cap', () => {
    // Sanity check that capturing a dormant Generator extends the cap.
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const playerId = w.players[0]!.id;
    const source = w.outposts.filter((o) => o.ownerId === playerId && !hasQueenAt(w, o.id))[0]!;
    // Find a dormant Generator nearby
    const target = w.outposts.find((o) => o.ownerId === null && o.kind === 'generator')!;
    const startCap = capFor(w, playerId);
    issueLaunchOrder(w, {
      ownerId: playerId,
      sourceId: source.id,
      destinationId: target.id,
      drillers: 1,
    });
    const sub = w.subs[0]!;
    tick(w, sub.arrivalAt);
    const newCap = capFor(w, playerId);
    expect(newCap).toBe(startCap + 50); // generator gives +50
    expect(outpostById(w, target.id).ownerId).toBe(playerId);
  });
});

function capFor(w: ReturnType<typeof generateWorld>, playerId: PlayerId): number {
  // Inline electricalOutput logic so this test isn't coupled to a different
  // module's exact signature.
  let total = 0;
  for (const o of w.outposts) {
    if (o.ownerId !== playerId) continue;
    if (o.kind === 'generator') total += 50;
  }
  // Queen-at-owned-outpost contributes +150. Queen-as-specialist now
  // lives in world.specialists rather than as an Outpost flag.
  for (const s of w.specialists) {
    if (s.ownerId !== playerId) continue;
    if (s.kind !== 'queen' || s.state !== 'active') continue;
    if (s.location.kind !== 'outpost') continue;
    const o = w.outposts[s.location.id as unknown as number];
    if (o && o.ownerId === playerId) total += 150;
  }
  return total;
}

describe('tick — determinism with subs', () => {
  it('same seed + same orders + same ticks → identical worlds', () => {
    const a = generateWorld({ seed: 99, playerCount: 4 });
    const b = generateWorld({ seed: 99, playerCount: 4 });
    const playerId = a.players[0]!.id;
    const sourceA = a.outposts.filter((o) => o.ownerId === playerId && !hasQueenAt(a, o.id))[0]!;
    const sourceB = b.outposts.filter((o) => o.ownerId === playerId && !hasQueenAt(b, o.id))[0]!;
    const destA = a.outposts.find((o) => o.ownerId === null)!;
    const destB = b.outposts.find((o) => o.ownerId === null)!;
    expect(sourceA.id).toBe(sourceB.id);
    expect(destA.id).toBe(destB.id);
    issueLaunchOrder(a, {
      ownerId: playerId,
      sourceId: sourceA.id,
      destinationId: destA.id,
      drillers: 7,
    });
    issueLaunchOrder(b, {
      ownerId: playerId,
      sourceId: sourceB.id,
      destinationId: destB.id,
      drillers: 7,
    });
    tick(a, 3 * DAY_MS);
    tick(b, 3 * DAY_MS);
    expect(a).toEqual(b);
  });

  it('splitting a tick gives identical results to one big tick', () => {
    const whole = generateWorld({ seed: 11, playerCount: 4 });
    const split = generateWorld({ seed: 11, playerCount: 4 });
    const playerId = whole.players[0]!.id;
    for (const w of [whole, split]) {
      const src = w.outposts.filter((o) => o.ownerId === playerId && !hasQueenAt(w, o.id))[0]!;
      const dst = w.outposts.find((o) => o.ownerId === null)!;
      issueLaunchOrder(w, {
        ownerId: playerId,
        sourceId: src.id,
        destinationId: dst.id,
        drillers: 5,
      });
    }
    tick(whole, 2 * DAY_MS);
    tick(split, MINUTE_MS);
    tick(split, LAUNCH_DELAY_MS);
    tick(split, HOUR_MS);
    tick(split, 2 * DAY_MS - LAUNCH_DELAY_MS - HOUR_MS - MINUTE_MS);
    expect(split).toEqual(whole);
  });
});

describe('travel-time helper', () => {
  it('returns a positive integer ms travel time', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const a = w.outposts[0]!;
    const b = w.outposts[1]!;
    const t = travelTimeBetween(a, b);
    expect(Number.isInteger(t)).toBe(true);
    expect(t).toBeGreaterThan(0);
  });
});
