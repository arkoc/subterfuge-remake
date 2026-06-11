/**
 * Regression tests modeled after community-reported bugs in the
 * official Subterfuge issue tracker:
 *
 *   https://github.com/gameshovel/subterfuge-issues
 *
 * Each test reproduces (or attempts to reproduce) one reported
 * behaviour against OUR sim, so we know whether the same bug exists
 * in this recreation. The test should DESCRIBE the bug from the
 * issue: if the test fails here, our sim has the bug; if it passes,
 * our sim behaves correctly.
 *
 * Issues that can't reasonably be tested at the sim layer (UI bugs,
 * lobby flow, notifications, ranking system, Pirate-target features
 * that aren't implemented yet, etc.) are not represented here.
 */

import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { tick } from '../src/tick.js';
import { drillCost, issueDrillOrder } from '../src/mining.js';
import {
  activeCountOf,
  activeQueenOf,
  createSpecialist,
  hasQueenAt,
  queenOutpostOf,
} from '../src/specialists.js';
import { fireSentry, SENTRY_FIRE_INTERVAL_MS } from '../src/passives.js';
import { processCaptiveActions } from '../src/captives.js';

// ============================================================================
// Issue #9 — attacking subs being redirected
// https://github.com/gameshovel/subterfuge-issues/issues/9
// "I launched a sub towards an outpost and instead of attacking the outpost
//  the sub was redirected. Outpost in question contained a sab but it
//  wasn't used."
//
// The spec is clear: Saboteur fires in sub-vs-sub combat only. A Saboteur
// sitting on a defending outpost should NOT redirect an incoming sub.
// ============================================================================

describe('issue #9 — Saboteur at defender outpost does not redirect attacker', () => {
  it('sub attacking an outpost with a Saboteur defender is NOT redirected', () => {
    const w = generateWorld({ seed: 5, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const aSrc = w.outposts.find(
      (o) => o.ownerId === a && !hasQueenAt(w, o.id),
    )!;
    const bTarget = w.outposts.find(
      (o) => o.ownerId === b && !hasQueenAt(w, o.id),
    )!;
    aSrc.drillers = 100;
    bTarget.drillers = 5;
    bTarget.shieldCharge = 0;
    bTarget.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    // Defender has a Saboteur. In sub-vs-outpost combat the Saboteur is
    // a non-effect; the attacker should land and resolve combat.
    createSpecialist(w, b, 'saboteur', { kind: 'outpost', id: bTarget.id });
    issueLaunchOrder(w, {
      ownerId: a, sourceId: aSrc.id, destinationId: bTarget.id, drillers: 40,
    });
    const sub = w.subs[w.subs.length - 1]!;
    const originalDest = sub.destinationId;
    tick(w, sub.arrivalAt - w.time);
    // The sub arrived at its original destination (was not redirected).
    // Confirm via the outpost change (attacker won 40 vs 5 → outpost flips).
    expect(bTarget.ownerId).toBe(a);
    // The sub should be gone (it arrived) — no sub left wandering with a
    // changed destination.
    expect(w.subs.length).toBe(0);
    // Sanity: the destination wasn't mutated mid-flight.
    expect(sub.destinationId).toBe(originalDest);
  });
});

// ============================================================================
// Issue #14 — sub with Queen and Navigator disappeared / was rerouted on
// owner losing last outpost
// https://github.com/gameshovel/subterfuge-issues/issues/14
// "Had a sub with queen and navi and when I lost my last outpost
//  everything went dark (as expected) I could still see my other sub (With
//  King and other specs) but my queen and navi sub disappeared and when I
//  advanced the time I saw that I would be eliminated in a few minutes."
//
// We test the deterministic part: when a player has 0 outposts but a
// Queen-on-a-sub still alive, the sim should NOT auto-reroute / gift the
// sub. The sub should continue toward its destination unchanged.
// ============================================================================

describe('issue #14 — sub is not auto-rerouted when owner loses last outpost', () => {
  it('an in-flight sub keeps its original destination after its owner loses all outposts', () => {
    const w = generateWorld({ seed: 5, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const aSrc = w.outposts.find(
      (o) => o.ownerId === a && !hasQueenAt(w, o.id),
    )!;
    aSrc.drillers = 200;
    const dormant = w.outposts.find((o) => o.ownerId === null)!;
    // A launches a sub toward a dormant outpost.
    issueLaunchOrder(w, {
      ownerId: a, sourceId: aSrc.id, destinationId: dormant.id, drillers: 30,
    });
    const sub = w.subs[w.subs.length - 1]!;
    const originalDest = sub.destinationId;
    // Hostile take-over of every A outpost (simulate "lost all outposts"
    // by manually reassigning ownership — combat resolution paths land in
    // 6e/6f but here we just want to see that the sub state doesn't auto-
    // mutate when ownership changes elsewhere).
    for (const o of w.outposts) if (o.ownerId === a) o.ownerId = b;
    // Tick a small amount — no events in this window should touch the sub.
    tick(w, 60 * 1000);
    const stillFlying = w.subs.find((s) => s.id === sub.id);
    expect(stillFlying).toBeDefined();
    // Destination should be unchanged (no auto-gift, no auto-reroute).
    expect(stillFlying!.destinationId).toBe(originalDest);
    expect(stillFlying!.giftTo).toBeUndefined();
  });
});

// ============================================================================
// Issue #19 — multiple Queen / released-captive-Queen bugs
// https://github.com/gameshovel/subterfuge-issues/issues/19
//
// Reproduction in the issue:
//   1. Have a Princess
//   2. Queen captured → Princess promotes to Queen
//   3. Captive Queen is released (sent home) — comes back to the player
//   4. Now the player has TWO Queens (bug)
//
// Spec says: at most one active Queen per player. The released captive
// Queen should be demoted to a Princess on her return.
// ============================================================================

describe('issue #19 — released captive Queen demotes to Princess when player already has a Queen', () => {
  it('a Queen released by an enemy Hypnotist preempt scenario is demoted on return', () => {
    const w = generateWorld({ seed: 5, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const queen = activeQueenOf(w, a)!;
    // Setup: A's Queen has been captured at one of B's outposts and is
    // about to be released by A's Diplomat in range.
    const bOutpost = w.outposts.find((o) => o.ownerId === b)!;
    queen.location = { kind: 'outpost', id: bOutpost.id };
    queen.state = 'captive';
    queen.captiveOf = b;
    // Meanwhile A's Princess (somewhere on the map) already promoted to
    // Queen in the queen-loss event (we simulate that by spawning a new
    // active Queen for A).
    const aHome = w.outposts.find((o) => o.ownerId === a)!;
    createSpecialist(w, a, 'queen', { kind: 'outpost', id: aHome.id });
    expect(activeCountOf(w, a, 'queen')).toBe(1);

    // A's Diplomat reaches into B's outpost. Push the IO count high so
    // the Diplomat's range covers all of B's territory.
    createSpecialist(w, a, 'diplomat', { kind: 'outpost', id: aHome.id });
    for (let i = 0; i < 100; i++) {
      createSpecialist(w, a, 'intelligence_officer', {
        kind: 'outpost',
        id: aHome.id,
      });
    }

    // Process the release. The Diplomat spawns a 1× home-bound sub
    // carrying the freed Queen.
    processCaptiveActions(w, w.time);
    const releaseSub = w.subs.find(
      (s) => s.ownerId === a && s.giftTo === a,
    );
    expect(releaseSub).toBeDefined();
    // Tick the world to the release sub's arrival.
    tick(w, releaseSub!.arrivalAt - w.time);

    // The freed Queen has come home. Expected: she is demoted to
    // Princess because A already has an active Queen.
    const queens = w.specialists.filter(
      (s) => s.kind === 'queen' && s.ownerId === a && s.state === 'active',
    );
    expect(queens).toHaveLength(1);
  });
});

// ============================================================================
// Issue #20 — Mine cost stuck at 50 for the second mine
// https://github.com/gameshovel/subterfuge-issues/issues/20
// "I paid 50 to build a mine, then another 50 to build the second mine."
//
// The canonical drill-cost ladder is 50 / 100 / 200 / 300 / 400. The
// per-player `minesDrilled` counter must increment every time the player
// drills, even when multiple drills are issued close in time.
// ============================================================================

describe('issue #20 — drill cost escalates 50 → 100 → 200 → 300 → 400', () => {
  it('drillCost helper returns the canonical ladder', () => {
    expect(drillCost(0)).toBe(50);
    expect(drillCost(1)).toBe(100);
    expect(drillCost(2)).toBe(200);
    expect(drillCost(3)).toBe(300);
    expect(drillCost(4)).toBe(400);
  });

  it('issuing 4 sequential drill orders charges 50/100/200/300', () => {
    const w = generateWorld({ seed: 5, playerCount: 4 });
    const me = w.players[0]!.id;
    // Pick 4 owned non-Queen, non-Mine outposts and pre-load drillers
    // so each drill payment can be made.
    const targets = w.outposts.filter(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.kind !== 'mine',
    ).slice(0, 4);
    expect(targets.length).toBeGreaterThanOrEqual(4);
    for (const o of targets) o.drillers = 500;

    const player = w.players[me as unknown as number]!;
    const charged: number[] = [];
    for (const o of targets) {
      const before = o.drillers;
      const cost = drillCost(player.minesDrilled);
      issueDrillOrder(w, { ownerId: me, outpostId: o.id });
      charged.push(before - o.drillers);
      expect(charged[charged.length - 1]).toBe(cost);
    }
    expect(charged).toEqual([50, 100, 200, 300]);
    expect(player.minesDrilled).toBe(4);
  });
});

// ============================================================================
// Issue #21 — Sentry target switched between Time Machine projection and
// actual fire
// https://github.com/gameshovel/subterfuge-issues/issues/21
// "I had a situation where my time machine showed an enemy sentry
//  targeting one sub, leaving my pirate sub alone. But when the actual
//  event took place, my pirate sub was targeted instead."
//
// Sentry target selection must be deterministic — given identical world
// state at fire time, the same target is picked every time. Our sim's
// fireSentry picks "the sub the shot would destroy the most drillers
// from, tiebreaking by lowest sub id".
// ============================================================================

describe('issue #21 — Sentry target selection is deterministic', () => {
  it('firing twice on identical state picks the same target', () => {
    // Two parallel worlds, identical seed/setup. Fire the Sentry in
    // both and compare the resulting sub.drillers values — they must
    // match exactly.
    function setup() {
      const w = generateWorld({ seed: 5, playerCount: 4 });
      const me = w.players[0]!.id;
      const them = w.players[1]!.id;
      const myOutpost = w.outposts.find((o) => o.ownerId === me)!;
      const sentry = createSpecialist(w, me, 'sentry', {
        kind: 'outpost',
        id: myOutpost.id,
      });
      sentry.nextActionAt = SENTRY_FIRE_INTERVAL_MS;
      // Launch two enemy subs at this player's outpost. They will both
      // be in flight by t = SENTRY_FIRE_INTERVAL_MS.
      const theirSrc = w.outposts.find(
        (o) => o.ownerId === them && !hasQueenAt(w, o.id),
      )!;
      theirSrc.drillers = 500;
      issueLaunchOrder(w, {
        ownerId: them, sourceId: theirSrc.id, destinationId: myOutpost.id, drillers: 60,
      });
      issueLaunchOrder(w, {
        ownerId: them, sourceId: theirSrc.id, destinationId: myOutpost.id, drillers: 80,
      });
      tick(w, SENTRY_FIRE_INTERVAL_MS - w.time);
      return { w, sentry };
    }
    const a = setup();
    const b = setup();
    fireSentry(a.w, a.sentry, a.w.time);
    fireSentry(b.w, b.sentry, b.w.time);
    expect(a.w.subs.map((s) => s.drillers)).toEqual(
      b.w.subs.map((s) => s.drillers),
    );
  });

  it("picks the target where the shot deals the highest damage", () => {
    const w = generateWorld({ seed: 5, playerCount: 4 });
    const me = w.players[0]!.id;
    const them = w.players[1]!.id;
    const myOutpost = w.outposts.find((o) => o.ownerId === me)!;
    const sentry = createSpecialist(w, me, 'sentry', {
      kind: 'outpost',
      id: myOutpost.id,
    });
    const theirSrc = w.outposts.find(
      (o) => o.ownerId === them && !hasQueenAt(w, o.id),
    )!;
    theirSrc.drillers = 1000;
    const smallId = issueLaunchOrder(w, {
      ownerId: them, sourceId: theirSrc.id, destinationId: myOutpost.id, drillers: 20,
    });
    const bigId = issueLaunchOrder(w, {
      ownerId: them, sourceId: theirSrc.id, destinationId: myOutpost.id, drillers: 200,
    });
    const smallSub = w.subs.find((s) => s.id === smallId)!;
    // Tick until the subs are ~30 minutes from arrival — at that point
    // they're inside the sentry's half-sonar bubble (~750 units; sub
    // travels ~100 units/hour at 1× speed).
    const fireAt = smallSub.arrivalAt - 30 * 60 * 1000;
    sentry.nextActionAt = fireAt;
    tick(w, fireAt - w.time);
    const smallBefore = w.subs.find((s) => s.id === smallId)!.drillers;
    const bigBefore = w.subs.find((s) => s.id === bigId)!.drillers;
    fireSentry(w, sentry, w.time);
    const smallAfter = w.subs.find((s) => s.id === smallId)!.drillers;
    const bigAfter = w.subs.find((s) => s.id === bigId)!.drillers;
    // Small sub (~20) takes ceil(5% × 20) = 1 damage; big sub (~200)
    // takes ceil(5% × 200) = 10 damage. Sentry should target the big.
    expect(smallAfter).toBe(smallBefore);
    expect(bigAfter).toBeLessThan(bigBefore);
  });
});

// ============================================================================
// Issue #19, subset — Spec-conformance check: an extra Queen acquired via
// any path (grantQueen) is demoted to Princess.
// ============================================================================

describe('issue #19 — second-Queen acquisition is demoted (spec invariant)', () => {
  it('a player never has more than one active Queen', () => {
    const w = generateWorld({ seed: 5, playerCount: 4 });
    const a = w.players[0]!.id;
    const queenAt = queenOutpostOf(w, a)!;
    // Simulate "acquired a second Queen" by directly creating one — the
    // spec invariant is meant to be enforced by grantQueen, which should
    // demote the new arrival. Direct createSpecialist intentionally
    // bypasses that and exposes the raw model.
    createSpecialist(w, a, 'queen', { kind: 'outpost', id: queenAt });
    // Now A has two raw Queens. Phase 6b's grantQueen() is the
    // gatekeeper; if any code path skips it, we end up here. The test
    // documents the desired *post-spec* invariant.
    const queens = w.specialists.filter(
      (s) => s.kind === 'queen' && s.ownerId === a && s.state === 'active',
    );
    expect(queens.length).toBeLessThanOrEqual(1);
  });
});

