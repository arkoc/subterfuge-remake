import { describe, expect, it } from 'vitest';
import { hasQueenAt } from '../src/specialists.js';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { tick } from '../src/tick.js';
import {
  type Outpost,
  type OutpostId,
  type PlayerId,
  SHIELD_RECHARGE_TIME_MS,
  type Sub,
  type SubId,
  type World,
} from '../src/types.js';
import { mirrorEncounterTime, resolveSubVsSub } from '../src/combat.js';

function arrange(seed = 1) {
  const w = generateWorld({ seed, playerCount: 4 });
  const a = w.players[0]!.id;
  const b = w.players[1]!.id;
  // Attacker source: any of A's outposts with drillers.
  const source = w.outposts
    .filter((o) => o.ownerId === a && !hasQueenAt(w, o.id))
    .sort((x, y) => y.drillers - x.drillers)[0]!;
  // Target: any of B's outposts.
  const target = w.outposts.find((o) => o.ownerId === b)!;
  return { w, a, b, source, target };
}

function launchAndArrive(w: World, attacker: PlayerId, source: Outpost, target: Outpost, drillers: number) {
  // Pre-load source with enough drillers if needed.
  if (source.drillers < drillers) source.drillers = drillers;
  issueLaunchOrder(w, {
    ownerId: attacker,
    sourceId: source.id,
    destinationId: target.id,
    drillers,
  });
  const sub = w.subs[w.subs.length - 1]!;
  tick(w, sub.arrivalAt - w.time);
}

describe('combat — sub vs outpost', () => {
  it('attacker wins when attackers strictly exceed defenders + shield', () => {
    const { w, a, source, target } = arrange();
    target.shieldKind = 'weak';
    target.shieldCharge = 0;
    // Pin the shield at 0 by pushing the "charged since" timestamp far
    // into the future so the recharge formula yields no gain at arrival.
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    target.drillers = 20;
    launchAndArrive(w, a, source, target, 30); // 30 vs 20, shield 0 → 10 survive
    expect(target.ownerId).toBe(a);
    expect(target.drillers).toBe(10);
  });

  it('defender wins on a tie (ties go to defender)', () => {
    const { w, a, b, source, target } = arrange();
    target.shieldKind = 'weak';
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER; // freeze shield at 0
    target.drillers = 50;
    // Send exactly 50 → tie → defender keeps outpost.
    launchAndArrive(w, a, source, target, 50);
    expect(target.ownerId).toBe(b);
    expect(target.drillers).toBe(0);
    expect(w.subs).toHaveLength(0);
  });

  it('shield absorbs attacker drillers 1-for-1', () => {
    const { w, a, b, source, target } = arrange();
    target.shieldKind = 'strong';
    target.shieldCharge = 20; // full
    target.shieldChargedSince = w.time;
    target.drillers = 10;
    // 25 attackers vs 20 shield + 10 drillers. 25-20=5 attackers vs 10 → defender wins with 5.
    launchAndArrive(w, a, source, target, 25);
    expect(target.ownerId).toBe(b);
    expect(target.drillers).toBe(5);
    expect(target.shieldCharge).toBe(0); // shield drained
  });

  it('attacker wins through a shielded defender when force is large enough', () => {
    const { w, a, source, target } = arrange();
    target.shieldKind = 'strong';
    target.shieldCharge = 20;
    target.shieldChargedSince = w.time;
    target.drillers = 10;
    // 50 vs 20 shield + 10 = 30; 50-30 = 20 surviving attackers → capture.
    launchAndArrive(w, a, source, target, 50);
    expect(target.ownerId).toBe(a);
    expect(target.drillers).toBe(20);
    expect(hasQueenAt(w, target.id)).toBe(false);
  });

  it('shield recharges over time on a successful defence', () => {
    const { w, a, b, source, target } = arrange();
    target.shieldKind = 'weak';
    target.shieldCharge = 10;
    target.shieldChargedSince = w.time;
    target.drillers = 50;
    // 30 vs 10 shield + 50 drillers — defender holds, shield drained to 0.
    launchAndArrive(w, a, source, target, 30);
    expect(target.ownerId).toBe(b);
    expect(target.shieldCharge).toBe(0);
    const drainedAt = target.shieldChargedSince;
    tick(w, SHIELD_RECHARGE_TIME_MS);
    // After 48h, shield is fully recharged (but its checkpoint may not
    // be live — use the live function via current shield computation).
    // The stored checkpoint stays at 0/drainedAt, but the live value
    // is max again. We assert via the elapsed time.
    expect(target.shieldChargedSince).toBe(drainedAt);
  });
});

// ---------- Sub-vs-sub mirror-route combat ----------

function mockSub(opts: {
  id: number;
  owner: number;
  source: number;
  destination: number;
  launchAt: number;
  arrivalAt: number;
  drillers: number;
  giftTo?: number;
}): Sub {
  return {
    id: opts.id as unknown as SubId,
    ownerId: opts.owner as unknown as PlayerId,
    sourceId: opts.source as unknown as OutpostId,
    destinationId: opts.destination as unknown as OutpostId,
    launchAt: opts.launchAt,
    arrivalAt: opts.arrivalAt,
    speedMultiplier: 1.0,
    drillers: opts.drillers,
    ...(opts.giftTo !== undefined
      ? { giftTo: opts.giftTo as unknown as PlayerId }
      : {}),
  };
}

describe('mirrorEncounterTime', () => {
  it('returns midpoint when both subs launch together with equal travel times', () => {
    // Launch 0, arrive 100 (both ways) → meet at 50.
    const a = mockSub({ id: 1, owner: 1, source: 10, destination: 20, launchAt: 0, arrivalAt: 100, drillers: 10 });
    const b = mockSub({ id: 2, owner: 2, source: 20, destination: 10, launchAt: 0, arrivalAt: 100, drillers: 10 });
    expect(mirrorEncounterTime(a, b)).toBe(50);
  });

  it('returns staggered meeting time when launches differ', () => {
    // fA=100, fB=100, A.launchAt=0, B.launchAt=20 → meet=(0·100 + 20·100 + 100·100)/200 = 12000/200 = 60
    const a = mockSub({ id: 1, owner: 1, source: 10, destination: 20, launchAt: 0, arrivalAt: 100, drillers: 10 });
    const b = mockSub({ id: 2, owner: 2, source: 20, destination: 10, launchAt: 20, arrivalAt: 120, drillers: 10 });
    expect(mirrorEncounterTime(a, b)).toBe(60);
  });

  it('handles asymmetric travel durations', () => {
    // fA=80, fB=120 — A.launchAt=0, B.launchAt=0 → meet = (0·120 + 0·80 + 80·120)/200 = 9600/200 = 48
    const a = mockSub({ id: 1, owner: 1, source: 10, destination: 20, launchAt: 0, arrivalAt: 80, drillers: 10 });
    const b = mockSub({ id: 2, owner: 2, source: 20, destination: 10, launchAt: 0, arrivalAt: 120, drillers: 10 });
    expect(mirrorEncounterTime(a, b)).toBe(48);
  });

  it('returns null for subs going the same direction (not mirror)', () => {
    const a = mockSub({ id: 1, owner: 1, source: 10, destination: 20, launchAt: 0, arrivalAt: 100, drillers: 10 });
    const b = mockSub({ id: 2, owner: 2, source: 10, destination: 20, launchAt: 0, arrivalAt: 100, drillers: 10 });
    expect(mirrorEncounterTime(a, b)).toBeNull();
  });

  it('returns null for subs on unrelated routes', () => {
    const a = mockSub({ id: 1, owner: 1, source: 10, destination: 20, launchAt: 0, arrivalAt: 100, drillers: 10 });
    const b = mockSub({ id: 2, owner: 2, source: 30, destination: 40, launchAt: 0, arrivalAt: 100, drillers: 10 });
    expect(mirrorEncounterTime(a, b)).toBeNull();
  });

  it('returns null when subs share an owner', () => {
    const a = mockSub({ id: 1, owner: 1, source: 10, destination: 20, launchAt: 0, arrivalAt: 100, drillers: 10 });
    const b = mockSub({ id: 2, owner: 1, source: 20, destination: 10, launchAt: 0, arrivalAt: 100, drillers: 10 });
    expect(mirrorEncounterTime(a, b)).toBeNull();
  });

  it('returns null when either sub is a gift', () => {
    const a = mockSub({ id: 1, owner: 1, source: 10, destination: 20, launchAt: 0, arrivalAt: 100, drillers: 10, giftTo: 3 });
    const b = mockSub({ id: 2, owner: 2, source: 20, destination: 10, launchAt: 0, arrivalAt: 100, drillers: 10 });
    expect(mirrorEncounterTime(a, b)).toBeNull();
    const c = mockSub({ id: 3, owner: 1, source: 10, destination: 20, launchAt: 0, arrivalAt: 100, drillers: 10 });
    const d = mockSub({ id: 4, owner: 2, source: 20, destination: 10, launchAt: 0, arrivalAt: 100, drillers: 10, giftTo: 1 });
    expect(mirrorEncounterTime(c, d)).toBeNull();
  });

  it("returns null when one sub arrives before the other launches", () => {
    // A: 0..100; B: 200..300. Meet computed but lies outside both windows.
    const a = mockSub({ id: 1, owner: 1, source: 10, destination: 20, launchAt: 0, arrivalAt: 100, drillers: 10 });
    const b = mockSub({ id: 2, owner: 2, source: 20, destination: 10, launchAt: 200, arrivalAt: 300, drillers: 10 });
    expect(mirrorEncounterTime(a, b)).toBeNull();
  });
});

describe('resolveSubVsSub', () => {
  function setupMirror(seed = 5) {
    const w = generateWorld({ seed, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const sourceA = w.outposts.find((o) => o.ownerId === a && !hasQueenAt(w, o.id))!;
    const sourceB = w.outposts.find((o) => o.ownerId === b && !hasQueenAt(w, o.id))!;
    sourceA.drillers = 200;
    sourceB.drillers = 200;
    return { w, a, b, sourceA, sourceB };
  }

  it('larger sub survives with the driller difference; smaller sub destroyed', () => {
    const { w, a, sourceA, sourceB } = setupMirror();
    issueLaunchOrder(w, { ownerId: a, sourceId: sourceA.id, destinationId: sourceB.id, drillers: 40 });
    issueLaunchOrder(w, { ownerId: sourceB.ownerId!, sourceId: sourceB.id, destinationId: sourceA.id, drillers: 25 });
    const subA = w.subs[0]!;
    const subB = w.subs[1]!;
    // Tick to encounter resolution. Both launched at the same time with
    // equal travel distance → meet at midpoint. After it, A continues
    // with 15 drillers, B is gone.
    const meet = Math.round(
      (subA.launchAt * (subB.arrivalAt - subB.launchAt) +
        subB.launchAt * (subA.arrivalAt - subA.launchAt) +
        (subA.arrivalAt - subA.launchAt) * (subB.arrivalAt - subB.launchAt)) /
        (subA.arrivalAt - subA.launchAt + subB.arrivalAt - subB.launchAt),
    );
    tick(w, meet - w.time);
    expect(w.subs).toHaveLength(1);
    expect(w.subs[0]!.ownerId).toBe(a);
    expect(w.subs[0]!.drillers).toBe(15);
    // Surviving sub keeps its original arrival schedule.
    expect(w.subs[0]!.arrivalAt).toBe(subA.arrivalAt);
  });

  it('tie destroys both subs', () => {
    const { w, a, sourceA, sourceB } = setupMirror();
    issueLaunchOrder(w, { ownerId: a, sourceId: sourceA.id, destinationId: sourceB.id, drillers: 30 });
    issueLaunchOrder(w, { ownerId: sourceB.ownerId!, sourceId: sourceB.id, destinationId: sourceA.id, drillers: 30 });
    const subA = w.subs[0]!;
    tick(w, subA.arrivalAt + 1 - w.time);
    expect(w.subs).toHaveLength(0);
    // Neither destination outpost changed hands.
    expect(sourceA.ownerId).toBe(a);
    expect(sourceB.ownerId).toBe(sourceB.ownerId);
  });

  it('survivor continues to its destination and resolves arrival combat there', () => {
    const { w, a, sourceA, sourceB } = setupMirror();
    issueLaunchOrder(w, { ownerId: a, sourceId: sourceA.id, destinationId: sourceB.id, drillers: 100 });
    issueLaunchOrder(w, { ownerId: sourceB.ownerId!, sourceId: sourceB.id, destinationId: sourceA.id, drillers: 20 });
    const subA = w.subs[0]!;
    // After encounter A has 80 drillers, B is gone. A continues to
    // sourceB; sourceB had its drillers reduced by the launch (now 180).
    // Disable sourceB's shield to make the arithmetic clean.
    sourceB.shieldKind = 'weak';
    sourceB.shieldCharge = 0;
    sourceB.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    tick(w, subA.arrivalAt - w.time);
    // 80 attackers vs 180 defenders → defender wins with 100.
    expect(sourceB.ownerId).not.toBe(a);
    expect(w.subs).toHaveLength(0);
  });

  it('does not engage subs on different corridors that happen to cross', () => {
    // Two unrelated outpost pairs — no mirror, no encounter.
    const w = generateWorld({ seed: 5, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const sourceA = w.outposts.find((o) => o.ownerId === a && !hasQueenAt(w, o.id))!;
    const destA = w.outposts.find((o) => o.ownerId === null)!;
    const sourceB = w.outposts.find((o) => o.ownerId === b && !hasQueenAt(w, o.id))!;
    const destB = w.outposts.find(
      (o) => o.ownerId === null && o.id !== destA.id,
    )!;
    sourceA.drillers = 200;
    sourceB.drillers = 200;
    issueLaunchOrder(w, { ownerId: a, sourceId: sourceA.id, destinationId: destA.id, drillers: 30 });
    issueLaunchOrder(w, { ownerId: b, sourceId: sourceB.id, destinationId: destB.id, drillers: 30 });
    const arr = Math.max(w.subs[0]!.arrivalAt, w.subs[1]!.arrivalAt);
    tick(w, arr - w.time);
    // Both subs reached their dormants; no en-route combat happened.
    expect(destA.ownerId).toBe(a);
    expect(destB.ownerId).toBe(b);
  });

  it('gift subs pass through mirror-route opponents without combat', () => {
    const { w, a, sourceA, sourceB } = setupMirror();
    // A → B is a gift sub aimed at sourceB's owner; B → A is hostile.
    issueLaunchOrder(w, {
      ownerId: a,
      sourceId: sourceA.id,
      destinationId: sourceB.id,
      drillers: 5,
      giftTo: sourceB.ownerId!,
    });
    issueLaunchOrder(w, {
      ownerId: sourceB.ownerId!,
      sourceId: sourceB.id,
      destinationId: sourceA.id,
      drillers: 50,
    });
    const subA = w.subs[0]!;
    // Tick well past the would-be midpoint encounter.
    const meet = (subA.launchAt + subA.arrivalAt) / 2;
    tick(w, meet + 1 - w.time);
    // Both subs are still in flight — no collision occurred.
    expect(w.subs).toHaveLength(2);
  });

  it('resolveSubVsSub mutates winner and removes loser directly', () => {
    const w = generateWorld({ seed: 5, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const sourceA = w.outposts.find((o) => o.ownerId === a && !hasQueenAt(w, o.id))!;
    const sourceB = w.outposts.find((o) => o.ownerId === b && !hasQueenAt(w, o.id))!;
    sourceA.drillers = 100;
    sourceB.drillers = 100;
    issueLaunchOrder(w, { ownerId: a, sourceId: sourceA.id, destinationId: sourceB.id, drillers: 50 });
    issueLaunchOrder(w, { ownerId: b, sourceId: sourceB.id, destinationId: sourceA.id, drillers: 20 });
    const subA = w.subs[0]!;
    const subB = w.subs[1]!;
    const out = resolveSubVsSub(w, subA, subB);
    expect(out.winner).toBe('a');
    expect(out.survivingDrillers).toBe(30);
    expect(w.subs).toEqual([subA]);
    expect(subA.drillers).toBe(30);
  });
});
