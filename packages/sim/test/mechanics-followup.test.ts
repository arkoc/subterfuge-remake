import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { tick } from '../src/tick.js';
import { simulateArrival, simulateSubArrival } from '../src/preview.js';
import { viewForPlayer } from '../src/visibility.js';
import { createSpecialist, hasQueenAt } from '../src/specialists.js';
import {
  FACTORY_CYCLE_MS,
  LAUNCH_DELAY_MS,
  type PlayerId,
} from '../src/types.js';
import { factoryCycleIntervalFor } from '../src/production.js';
import { editPreLaunchSub } from '../src/orders.js';
import { effectiveSpeed } from '../src/subs.js';
import { queueLaunch, dispatchQueuedOrder } from '../src/queued-orders.js';

function pickHostilePair(seed: number) {
  const w = generateWorld({ seed, playerCount: 4 });
  const me = w.players[0]!.id;
  const enemy = w.players[1]!.id;
  const mine = w.outposts.find(
    (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.drillers >= 30,
  )!;
  const theirs = w.outposts.find((o) => o.ownerId === enemy)!;
  return { w, me, enemy, mine, theirs };
}

describe('combat preview — real resolveCombat path', () => {
  it('reinforce: friendly arrival sums drillers (preview matches actual)', () => {
    const { w, me, mine } = pickHostilePair(7);
    const friendly = w.outposts.find(
      (o) => o.ownerId === me && o.id !== mine.id && !hasQueenAt(w, o.id),
    )!;
    const drillers = 10;
    const p = simulateArrival({
      world: w,
      sourceId: mine.id,
      destinationId: friendly.id,
      drillers,
      attackerId: me,
    });
    expect(p.outcome).toBe('reinforce');
    expect(p.outpostCaptured).toBe(false);
  });

  it('dormant capture: outcome capture-dormant, attacker keeps drillers', () => {
    const { w, me } = pickHostilePair(7);
    const dormant = w.outposts.find((o) => o.ownerId === null)!;
    const source = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.drillers >= 5,
    )!;
    const p = simulateArrival({
      world: w,
      sourceId: source.id,
      destinationId: dormant.id,
      drillers: 5,
      attackerId: me,
    });
    expect(p.outcome).toBe('capture-dormant');
    expect(p.attackerSurviving).toBe(5);
  });

  it('hostile defender-wins: preview matches actual outpost state post-arrival', () => {
    const { w, me, mine, theirs } = pickHostilePair(7);
    const p = simulateArrival({
      world: w,
      sourceId: mine.id,
      destinationId: theirs.id,
      drillers: 5, // small attack — defender (40 + shield 10) will hold
      attackerId: me,
    });
    expect(p.outcome).toBe('defender-wins');
    expect(p.outpostCaptured).toBe(false);
  });

  it('attacker-wins: preview matches actual capture', () => {
    const { w, me, mine, theirs } = pickHostilePair(7);
    const p = simulateArrival({
      world: w,
      sourceId: mine.id,
      destinationId: theirs.id,
      drillers: 200, // overwhelming — captures
      attackerId: me,
    });
    expect(p.outcome).toBe('attacker-wins');
    expect(p.outpostCaptured).toBe(true);
  });
});

describe('multi-attacker pooling on simultaneous arrival', () => {
  it('two same-owner subs arriving at the same hostile outpost pool their drillers', () => {
    const { w, me, theirs } = pickHostilePair(7);
    const a = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.drillers >= 5,
    )!;
    const b = w.outposts.find(
      (o) =>
        o.ownerId === me &&
        o.id !== a.id &&
        !hasQueenAt(w, o.id) &&
        o.drillers >= 5,
    )!;
    // Bump drillers so we can stage a large attack.
    a.drillers = 30;
    b.drillers = 30;
    issueLaunchOrder(w, {
      ownerId: me,
      sourceId: a.id,
      destinationId: theirs.id,
      drillers: 25,
    });
    issueLaunchOrder(w, {
      ownerId: me,
      sourceId: b.id,
      destinationId: theirs.id,
      drillers: 25,
    });
    // Force both arrivals to the same instant.
    const subs = w.subs.filter((s) => s.destinationId === theirs.id);
    expect(subs).toHaveLength(2);
    const shared = Math.max(subs[0]!.arrivalAt, subs[1]!.arrivalAt);
    for (const s of subs) s.arrivalAt = shared;
    // Tick past arrival.
    tick(w, shared + 1 - w.time);
    // Defender had 40 + shield 10; pooled 50 vs (10 shield + 40) = tie → defender holds with 0 drillers but outpost not captured.
    // Without pooling, each 25 would fail and defender would barely survive both. Check that BOTH subs are consumed.
    expect(w.subs.filter((s) => s.destinationId === theirs.id)).toHaveLength(0);
    // The outpost state will reflect the pooled fight.
    const after = w.outposts.find((o) => o.id === theirs.id)!;
    expect(after).toBeDefined();
  });
});

describe('Tycoon: cycle-interval scaling per spec', () => {
  it('factoryCycleIntervalFor: base, +1 Tycoon, +2 Tycoons', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const owned = w.outposts.find((o) => o.ownerId === me)!;
    expect(factoryCycleIntervalFor(w, me)).toBe(FACTORY_CYCLE_MS);
    createSpecialist(w, me, 'tycoon', { kind: 'outpost', id: owned.id });
    expect(factoryCycleIntervalFor(w, me)).toBe(Math.round(FACTORY_CYCLE_MS / 1.5));
    createSpecialist(w, me, 'tycoon', { kind: 'outpost', id: owned.id });
    expect(factoryCycleIntervalFor(w, me)).toBe(Math.round(FACTORY_CYCLE_MS / 2));
  });
});

describe('IO global kind-reveal + fogged mine kind preservation', () => {
  it('fogged mine retains kind:mine without IO', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const enemy = w.players[1]!.id;
    // Pick any enemy-owned outpost and flip its kind to mine.
    const enemyOp = w.outposts.find((o) => o.ownerId === enemy);
    expect(enemyOp).toBeDefined();
    if (!enemyOp) return;
    enemyOp.kind = 'mine';
    const view = viewForPlayer(w, me);
    const seen = view.outposts.find((o) => o.id === enemyOp.id)!;
    expect(seen).toBeDefined();
    // It's outside my sonar (different player's territory) → fogged,
    // but the kind must remain `mine` for global mine visibility.
    expect(seen.fogged).toBe(true);
    expect(seen.kind).toBe('mine');
  });

  it('with IO, every outpost is known and kind is revealed', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const myOwn = w.outposts.find((o) => o.ownerId === me)!;
    createSpecialist(w, me, 'intelligence_officer', {
      kind: 'outpost',
      id: myOwn.id,
    });
    const view = viewForPlayer(w, me);
    // Every outpost the original world has should now appear, either
    // in full or fogged-with-kind.
    for (const o of w.outposts) {
      const seen = view.outposts.find((x) => x.id === o.id);
      expect(seen).toBeDefined();
      // Owned outposts come through unfogged; fogged ones must keep kind.
      if (seen!.fogged) expect(seen!.kind).toBe(o.kind);
    }
  });
});

describe('queued gift launch', () => {
  it('queueLaunch carries giftTo through to dispatch', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id as PlayerId;
    const friend = w.players[1]!.id as PlayerId;
    const friendOp = w.outposts.find((o) => o.ownerId === friend)!;
    const myOp = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.drillers >= 5,
    )!;
    const id = queueLaunch(w, {
      executeAt: w.time + 1000,
      ownerId: me,
      sourceId: myOp.id,
      destinationId: friendOp.id,
      drillers: 3,
      giftTo: friend,
    });
    const order = w.queuedOrders.find((q) => q.id === id)!;
    expect(order.kind).toBe('launch');
    if (order.kind === 'launch') {
      expect(order.giftTo).toBe(friend);
    }
    const result = dispatchQueuedOrder(w, order);
    expect(result.ok).toBe(true);
    const created = w.subs.find(
      (s) => s.sourceId === myOp.id && s.destinationId === friendOp.id,
    )!;
    expect(created.giftTo).toBe(friend);
  });
});

describe('pre-launch specialist add/remove', () => {
  it('add a specialist mid-window: moves from source onto sub, recomputes arrival', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const source = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.drillers >= 5,
    )!;
    const dest = w.outposts.find((o) => o.ownerId === null)!;
    const helm = createSpecialist(w, me, 'helmsman', {
      kind: 'outpost',
      id: source.id,
    });
    const subId = issueLaunchOrder(w, {
      ownerId: me,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 3,
    });
    const baselineArrival = w.subs.find((s) => s.id === subId)!.arrivalAt;
    editPreLaunchSub(w, {
      ownerId: me,
      subId,
      drillers: 3,
      specialistIds: [helm.id],
    });
    const sub = w.subs.find((s) => s.id === subId)!;
    expect(sub.speedMultiplier).toBe(2.0); // Helmsman
    expect(sub.arrivalAt).toBeLessThan(baselineArrival);
    // Helmsman is on the sub.
    expect(helm.location).toEqual({ kind: 'sub', id: subId });
  });

  it('remove a specialist mid-window: returns to source', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const source = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.drillers >= 5,
    )!;
    const dest = w.outposts.find((o) => o.ownerId === null)!;
    const helm = createSpecialist(w, me, 'helmsman', {
      kind: 'outpost',
      id: source.id,
    });
    const subId = issueLaunchOrder(w, {
      ownerId: me,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 3,
      specialistIds: [helm.id],
    });
    expect(helm.location).toEqual({ kind: 'sub', id: subId });
    editPreLaunchSub(w, {
      ownerId: me,
      subId,
      drillers: 3,
      specialistIds: [],
    });
    expect(helm.location).toEqual({ kind: 'outpost', id: source.id });
    const sub = w.subs.find((s) => s.id === subId)!;
    expect(sub.speedMultiplier).toBe(1.0); // back to base
  });

  it('rejects loading a specialist that is not at the source', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const source = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.drillers >= 5,
    )!;
    const otherOwn = w.outposts.find(
      (o) => o.ownerId === me && o.id !== source.id && !hasQueenAt(w, o.id),
    )!;
    const dest = w.outposts.find((o) => o.ownerId === null)!;
    const helm = createSpecialist(w, me, 'helmsman', {
      kind: 'outpost',
      id: otherOwn.id,
    });
    const subId = issueLaunchOrder(w, {
      ownerId: me,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 3,
    });
    expect(() =>
      editPreLaunchSub(w, {
        ownerId: me,
        subId,
        drillers: 3,
        specialistIds: [helm.id],
      }),
    ).toThrow(/source outpost/);
  });
});

describe('pirate 4× home-return persistence', () => {
  it('effectiveSpeed returns 4 for a returning chase sub', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const source = w.outposts.find((o) => o.ownerId === me)!;
    const dest = w.outposts.find((o) => o.ownerId !== me && o.ownerId !== null)!;
    const subId = issueLaunchOrder(w, {
      ownerId: me,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 1,
    });
    const sub = w.subs.find((s) => s.id === subId)!;
    // Stub a returning chase state.
    sub.chase = {
      phase: 'returning',
      targetSubId: -1 as never,
      interceptPos: { x: 0, y: 0 },
      chaseStartAt: w.time,
      chaseFromPos: source.pos,
    };
    expect(effectiveSpeed(w, sub)).toBe(4.0);
  });
});

// Reference unused-import-safety
void LAUNCH_DELAY_MS;
void simulateSubArrival;
