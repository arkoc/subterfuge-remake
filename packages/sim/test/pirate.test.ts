import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder, redirectSub } from '../src/orders.js';
import { tick } from '../src/tick.js';
import { targetSub, returnPirateHome, recomputeChase } from '../src/pirate.js';
import { queueLaunch } from '../src/queued-orders.js';
import {
  createSpecialist,
  hasQueenAt,
} from '../src/specialists.js';
import type { Coord, SpecialistId } from '../src/types.js';
import { MAP_SIZE } from '../src/types.js';
import { dist } from '../src/geometry.js';

function setup(seed = 11) {
  const w = generateWorld({ seed, playerCount: 4 });
  const me = w.players[0]!.id;
  const them = w.players[1]!.id;
  const mySrc = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
  const theirSrc = w.outposts.find((o) => o.ownerId === them && !hasQueenAt(w, o.id))!;
  const dormant = w.outposts.find((o) => o.ownerId === null)!;
  mySrc.drillers = 200;
  theirSrc.drillers = 200;
  return { w, me, them, mySrc, theirSrc, dormant };
}

describe('Pirate targetSub — validation', () => {
  it('rejects when sub has no Pirate aboard', () => {
    const { w, me, them, mySrc, theirSrc, dormant } = setup();
    issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
    });
    issueLaunchOrder(w, {
      ownerId: them, sourceId: theirSrc.id, destinationId: dormant.id, drillers: 5,
    });
    const subA = w.subs[0]!;
    const subB = w.subs[1]!;
    expect(() =>
      targetSub(w, {
        ownerId: me,
        subId: subA.id as unknown as number,
        targetSubId: subB.id as unknown as number,
      }),
    ).toThrow(/no active Pirate/);
  });

  it('rejects targeting your own sub', () => {
    const { w, me, mySrc, dormant } = setup();
    const pirate = createSpecialist(w, me, 'pirate', { kind: 'outpost', id: mySrc.id });
    issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [pirate.id as unknown as SpecialistId],
    });
    issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
    });
    const pirateSub = w.subs[0]!;
    const ownSub = w.subs[1]!;
    expect(() =>
      targetSub(w, {
        ownerId: me,
        subId: pirateSub.id as unknown as number,
        targetSubId: ownSub.id as unknown as number,
      }),
    ).toThrow(/cannot target your own sub/);
  });

  it('rejects when caller does not own the pirate sub', () => {
    const { w, me, them, mySrc, theirSrc, dormant } = setup();
    const pirate = createSpecialist(w, me, 'pirate', { kind: 'outpost', id: mySrc.id });
    issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [pirate.id as unknown as SpecialistId],
    });
    issueLaunchOrder(w, {
      ownerId: them, sourceId: theirSrc.id, destinationId: dormant.id, drillers: 5,
    });
    const pirateSub = w.subs[0]!;
    const enemySub = w.subs[1]!;
    expect(() =>
      targetSub(w, {
        ownerId: them,
        subId: pirateSub.id as unknown as number,
        targetSubId: enemySub.id as unknown as number,
      }),
    ).toThrow(/not owned by player/);
  });
});

describe('Pirate intercept — chase resolution', () => {
  it('sets sub.chase, updates speed to 2× and rewrites arrivalAt', () => {
    const { w, me, them, mySrc, theirSrc, dormant } = setup();
    const pirate = createSpecialist(w, me, 'pirate', { kind: 'outpost', id: mySrc.id });
    issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [pirate.id as unknown as SpecialistId],
    });
    issueLaunchOrder(w, {
      ownerId: them, sourceId: theirSrc.id, destinationId: dormant.id, drillers: 10,
    });
    const pirateSub = w.subs[0]!;
    const enemySub = w.subs[1]!;
    // Advance to mid-flight so the chase has a well-defined start point.
    tick(w, ((pirateSub.launchAt + pirateSub.arrivalAt) / 2) - w.time);
    targetSub(w, {
      ownerId: me,
      subId: pirateSub.id as unknown as number,
      targetSubId: enemySub.id as unknown as number,
    });
    expect(pirateSub.chase).toBeDefined();
    expect(pirateSub.chase!.phase).toBe('chasing');
    expect(pirateSub.speedMultiplier).toBe(2.0);
    expect(pirateSub.arrivalAt).toBeGreaterThan(w.time);
  });

  it('a successful intercept fires sub-vs-sub combat at the intercept', () => {
    const { w, me, them, mySrc, theirSrc, dormant } = setup();
    const pirate = createSpecialist(w, me, 'pirate', { kind: 'outpost', id: mySrc.id });
    issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 100,
      specialistIds: [pirate.id as unknown as SpecialistId],
    });
    issueLaunchOrder(w, {
      ownerId: them, sourceId: theirSrc.id, destinationId: dormant.id, drillers: 10,
    });
    const pirateSub = w.subs[0]!;
    const enemySub = w.subs[1]!;
    // Wait past launch delay so both subs are in flight.
    tick(w, pirateSub.launchAt + 1 - w.time);
    targetSub(w, {
      ownerId: me,
      subId: pirateSub.id as unknown as number,
      targetSubId: enemySub.id as unknown as number,
    });
    // Tick to the intercept time.
    tick(w, pirateSub.arrivalAt + 1 - w.time);
    // Enemy is destroyed. Pirate sub still exists (returning home).
    expect(w.subs.find((s) => s.id === enemySub.id)).toBeUndefined();
    const survivor = w.subs.find((s) => s.id === pirateSub.id);
    expect(survivor).toBeDefined();
    expect(survivor!.chase?.phase).toBe('returning');
    expect(survivor!.speedMultiplier).toBe(4.0);
  });
});

describe('Pirate return-home', () => {
  it('routes survivor at 4× to nearest friendly outpost', () => {
    const { w, me, mySrc, theirSrc } = setup();
    const pirate = createSpecialist(w, me, 'pirate', { kind: 'outpost', id: mySrc.id });
    issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: theirSrc.id, drillers: 50,
      specialistIds: [pirate.id as unknown as SpecialistId],
    });
    const sub = w.subs[0]!;
    tick(w, sub.launchAt + 1 - w.time);
    returnPirateHome(w, sub, w.time);
    expect(sub.chase!.phase).toBe('returning');
    expect(sub.speedMultiplier).toBe(4.0);
    // Destination is an outpost owned by `me`.
    const dest = w.outposts.find((o) => o.id === sub.destinationId);
    expect(dest!.ownerId).toBe(me);
  });
});

describe('Pirate intercept — stale prediction guard', () => {
  it('does not teleport-kill the target when the intercept is stale', () => {
    const { w, me, them, mySrc, theirSrc, dormant } = setup();
    const pirate = createSpecialist(w, me, 'pirate', {
      kind: 'outpost',
      id: mySrc.id,
    });
    issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 100,
      specialistIds: [pirate.id as unknown as SpecialistId],
    });
    // Give the target a long flight so it is still well in transit when
    // the (corrupted) intercept time arrives.
    issueLaunchOrder(w, {
      ownerId: them, sourceId: theirSrc.id, destinationId: dormant.id, drillers: 10,
    });
    const pirateSub = w.subs[0]!;
    const enemySub = w.subs[1]!;
    tick(w, pirateSub.launchAt + 1 - w.time);
    targetSub(w, {
      ownerId: me,
      subId: pirateSub.id as unknown as number,
      targetSubId: enemySub.id as unknown as number,
    });
    // Simulate a stale prediction: point the intercept at empty water
    // far from the target's actual track, and bring the arrival forward.
    // Pre-guard, the tick fired combat unconditionally here and the
    // target was destroyed mid-ocean. With the guard the gap is large,
    // so the pirate re-aims instead of teleport-killing.
    const enemyAtArrival = enemySub.arrivalAt;
    pirateSub.chase = {
      ...pirateSub.chase!,
      interceptPos: { x: 100, y: 9900 },
    };
    pirateSub.arrivalAt = w.time + 1000;
    tick(w, pirateSub.arrivalAt + 1 - w.time);
    // The target survived the bogus intercept …
    expect(w.subs.find((s) => s.id === enemySub.id)).toBeDefined();
    // … and the enemy was still genuinely in flight at that moment, so
    // this was a real "would-be teleport-kill", not a no-op.
    expect(enemyAtArrival).toBeGreaterThan(pirateSub.arrivalAt);
    // The pirate re-aimed rather than vanishing — it is still pursuing.
    const p = w.subs.find((s) => s.id === pirateSub.id);
    expect(p).toBeDefined();
    expect(p!.chase).toBeDefined();
  });
});

describe('Pirate chase abandonment', () => {
  it('returns home if the target has vanished', () => {
    const { w, me, them, mySrc, theirSrc, dormant } = setup();
    const pirate = createSpecialist(w, me, 'pirate', { kind: 'outpost', id: mySrc.id });
    issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [pirate.id as unknown as SpecialistId],
    });
    issueLaunchOrder(w, {
      ownerId: them, sourceId: theirSrc.id, destinationId: dormant.id, drillers: 5,
    });
    const pirateSub = w.subs[0]!;
    const enemySub = w.subs[1]!;
    tick(w, pirateSub.launchAt + 1 - w.time);
    targetSub(w, {
      ownerId: me,
      subId: pirateSub.id as unknown as number,
      targetSubId: enemySub.id as unknown as number,
    });
    // Remove the target from the world to simulate vanishing.
    w.subs = w.subs.filter((s) => s.id !== enemySub.id);
    recomputeChase(w, pirateSub, w.time);
    expect(pirateSub.chase?.phase).toBe('returning');
  });
});

describe('Pirate launch via Time-Machine queue', () => {
  it('a queued launch carrying pirateTargetSubId engages the chase when it fires', () => {
    const { w, me, them, mySrc, theirSrc, dormant } = setup();
    // An enemy sub in flight for the future pirate to chase.
    issueLaunchOrder(w, {
      ownerId: them, sourceId: theirSrc.id, destinationId: dormant.id, drillers: 10,
    });
    const enemy = w.subs[0]!;
    tick(w, enemy.launchAt + 1 - w.time);
    // A pirate waiting at my outpost.
    const pirate = createSpecialist(w, me, 'pirate', { kind: 'outpost', id: mySrc.id });
    // Schedule "launch a pirate at that enemy sub" for a future moment.
    const executeAt = w.time + 60_000;
    queueLaunch(w, {
      executeAt,
      ownerId: me,
      sourceId: mySrc.id,
      destinationId: dormant.id,
      drillers: 20,
      specialistIds: [pirate.id as unknown as SpecialistId],
      pirateTargetSubId: enemy.id,
    });
    // No pirate sub yet — the launch hasn't fired.
    expect(w.subs.find((s) => s.ownerId === me && s.chase !== undefined)).toBeUndefined();
    // Advance past the scheduled time: the launch fires AND the chase
    // binds to the freshly-created sub.
    tick(w, executeAt + 1 - w.time);
    const pirateSub = w.subs.find((s) => s.ownerId === me && s.chase !== undefined);
    expect(pirateSub).toBeDefined();
    expect(pirateSub!.chase!.phase).toBe('chasing');
    expect(pirateSub!.chase!.targetSubId).toBe(enemy.id);
    // It launched immediately (no leftover 10-min fuse) so it's already
    // under way toward the intercept.
    expect(pirateSub!.launchAt).toBeLessThanOrEqual(executeAt);
  });
});

describe('Pirate intercept — toroidal seam', () => {
  // Regression: computeIntercept used raw (T1 - T0) / (T0 - P0) deltas
  // instead of torusDelta, so a target crossing the wrap edge was
  // modelled as flying the LONG way across the map. The pirate then
  // planned toward a bogus intercept (often an off-plane coordinate)
  // and never met the target.
  function setPos(o: { pos: Coord }, x: number, y: number): void {
    (o as { pos: Coord }).pos = { x, y };
  }

  it('intercepts a target that crosses the seam, on the short arc', () => {
    const { w, me, them, mySrc, theirSrc, dormant } = setup();
    // Target flies from near the right edge to just past the left edge:
    // the SHORT path crosses the seam rightward (+400), the long path is
    // -9600 across the whole map.
    setPos(theirSrc, 9300, 5000); // target source, near right edge
    setPos(dormant, 700, 5000); // target dest, well past the seam (+1400 short)
    setPos(mySrc, 200, 5000); // pirate source, AHEAD on the short arc, past the seam

    const pirate = createSpecialist(w, me, 'pirate', {
      kind: 'outpost',
      id: mySrc.id,
    });
    issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 100,
      specialistIds: [pirate.id as unknown as SpecialistId],
    });
    issueLaunchOrder(w, {
      ownerId: them, sourceId: theirSrc.id, destinationId: dormant.id, drillers: 10,
    });
    const pirateSub = w.subs[0]!;
    const enemySub = w.subs[1]!;
    tick(w, pirateSub.launchAt + 1 - w.time);
    targetSub(w, {
      ownerId: me,
      subId: pirateSub.id as unknown as number,
      targetSubId: enemySub.id as unknown as number,
    });

    const ip = pirateSub.chase!.interceptPos;
    // Intercept must be a real on-map coordinate.
    expect(ip.x).toBeGreaterThanOrEqual(0);
    expect(ip.x).toBeLessThan(MAP_SIZE);
    expect(ip.y).toBeGreaterThanOrEqual(0);
    expect(ip.y).toBeLessThan(MAP_SIZE);
    // The decisive check: the intercept lies ON the target's actual
    // (short, seam-crossing) flight corridor. A point on the segment
    // src→dst satisfies dist(ip,src) + dist(ip,dst) == dist(src,dst).
    // The pre-fix raw-delta math placed the intercept on the WRONG side
    // of the map (the long-way-round trajectory), which blows this sum
    // far past the true path length.
    const pathLen = dist(theirSrc.pos, dormant.pos);
    const viaIntercept = dist(ip, theirSrc.pos) + dist(ip, dormant.pos);
    expect(viaIntercept).toBeLessThan(pathLen + 50);

    // Combat resolution itself is unconditional at arrivalAt, so this
    // documents the end state rather than discriminating the fix.
    tick(w, pirateSub.arrivalAt + 1 - w.time);
    expect(w.subs.find((s) => s.id === enemySub.id)).toBeUndefined();
    const survivor = w.subs.find((s) => s.id === pirateSub.id);
    expect(survivor?.chase?.phase).toBe('returning');
  });
});

describe('Pirate intercept — target redirects mid-flight', () => {
  it('re-aims the chasing pirate when the target uses Navigator', () => {
    const { w, me, them, mySrc, theirSrc, dormant } = setup();
    // Pick a second neutral outpost as the target's redirect destination.
    const altDest = w.outposts.find(
      (o) => o.ownerId === null && o.id !== dormant.id,
    )!;
    const pirate = createSpecialist(w, me, 'pirate', {
      kind: 'outpost',
      id: mySrc.id,
    });
    const navigator = createSpecialist(w, them, 'navigator', {
      kind: 'outpost',
      id: theirSrc.id,
    });
    issueLaunchOrder(w, {
      ownerId: me,
      sourceId: mySrc.id,
      destinationId: dormant.id,
      drillers: 50,
      specialistIds: [pirate.id as unknown as SpecialistId],
    });
    issueLaunchOrder(w, {
      ownerId: them,
      sourceId: theirSrc.id,
      destinationId: dormant.id,
      drillers: 10,
      specialistIds: [navigator.id as unknown as SpecialistId],
    });
    const pirateSub = w.subs[0]!;
    const enemySub = w.subs[1]!;
    tick(w, pirateSub.launchAt + 1 - w.time);
    targetSub(w, {
      ownerId: me,
      subId: pirateSub.id as unknown as number,
      targetSubId: enemySub.id as unknown as number,
    });
    // Snapshot the original interceptPos + arrival before redirect.
    const before = {
      pos: { ...pirateSub.chase!.interceptPos },
      arrivalAt: pirateSub.arrivalAt,
    };
    // Target redirects to a different outpost. Without the fix the
    // pirate would keep flying toward `before.pos`; with the fix the
    // pirate's chase struct refreshes to the new geometry.
    redirectSub(w, {
      ownerId: them,
      subId: enemySub.id,
      newDestinationId: altDest.id,
    });
    const after = pirateSub.chase!.interceptPos;
    expect(after.x === before.pos.x && after.y === before.pos.y).toBe(false);
    expect(pirateSub.arrivalAt).not.toBe(before.arrivalAt);
    // Ticking to the new arrival should still produce a successful
    // intercept (target destroyed, pirate returning home).
    tick(w, pirateSub.arrivalAt + 1 - w.time);
    expect(w.subs.find((s) => s.id === enemySub.id)).toBeUndefined();
    const survivor = w.subs.find((s) => s.id === pirateSub.id);
    expect(survivor?.chase?.phase).toBe('returning');
  });
});
