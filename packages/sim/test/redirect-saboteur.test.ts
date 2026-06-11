import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder, redirectSub } from '../src/orders.js';
import { tick } from '../src/tick.js';
import {
  createSpecialist,
  hasQueenAt,
} from '../src/specialists.js';
import { subPosition } from '../src/subs.js';
import { mirrorEncounterTime } from '../src/combat.js';
import { dist } from '../src/geometry.js';
import type { SpecialistId } from '../src/types.js';

describe('redirectSub (Navigator)', () => {
  function arrange() {
    const w = generateWorld({ seed: 11, playerCount: 4 });
    const me = w.players[0]!.id;
    const src = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    src.drillers = 200;
    const dst1 = w.outposts.find((o) => o.ownerId === null)!;
    const dst2 = w.outposts.find((o) => o.ownerId === null && o.id !== dst1.id)!;
    return { w, me, src, dst1, dst2 };
  }

  it('rewrites destinationId and recomputes arrivalAt', () => {
    const { w, me, src, dst1, dst2 } = arrange();
    const nav = createSpecialist(w, me, 'navigator', { kind: 'outpost', id: src.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: src.id, destinationId: dst1.id, drillers: 5,
      specialistIds: [nav.id as unknown as SpecialistId],
    });
    const sub = w.subs.find((s) => s.id === id)!;
    const origArrival = sub.arrivalAt;
    // Advance world time to mid-flight.
    const mid = (sub.launchAt + sub.arrivalAt) / 2;
    tick(w, mid - w.time);
    redirectSub(w, {
      ownerId: me, subId: sub.id, newDestinationId: dst2.id,
    });
    expect(sub.destinationId).toBe(dst2.id);
    expect(sub.arrivalAt).not.toBe(origArrival);
    expect(sub.arrivalAt).toBeGreaterThan(w.time);
  });

  it('rejects redirect with no Navigator aboard', () => {
    const { w, me, src, dst1, dst2 } = arrange();
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: src.id, destinationId: dst1.id, drillers: 5,
    });
    const sub = w.subs.find((s) => s.id === id)!;
    expect(() =>
      redirectSub(w, { ownerId: me, subId: sub.id, newDestinationId: dst2.id }),
    ).toThrow(/Navigator/);
  });

  it('rejects redirect by a non-owner', () => {
    const { w, me, src, dst1, dst2 } = arrange();
    const nav = createSpecialist(w, me, 'navigator', { kind: 'outpost', id: src.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: src.id, destinationId: dst1.id, drillers: 5,
      specialistIds: [nav.id as unknown as SpecialistId],
    });
    const sub = w.subs.find((s) => s.id === id)!;
    const other = w.players[1]!.id;
    expect(() =>
      redirectSub(w, { ownerId: other, subId: sub.id, newDestinationId: dst2.id }),
    ).toThrow(/not owned/);
  });

  it('rejects redirect to the sub source', () => {
    const { w, me, src, dst1 } = arrange();
    const nav = createSpecialist(w, me, 'navigator', { kind: 'outpost', id: src.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: src.id, destinationId: dst1.id, drillers: 5,
      specialistIds: [nav.id as unknown as SpecialistId],
    });
    const sub = w.subs.find((s) => s.id === id)!;
    expect(() =>
      redirectSub(w, { ownerId: me, subId: sub.id, newDestinationId: src.id }),
    ).toThrow(/must differ from source/);
  });

  it('pivots from the sub position at redirect time — no teleport', () => {
    const { w, me, src, dst1, dst2 } = arrange();
    const nav = createSpecialist(w, me, 'navigator', { kind: 'outpost', id: src.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: src.id, destinationId: dst1.id, drillers: 5,
      specialistIds: [nav.id as unknown as SpecialistId],
    });
    const sub = w.subs.find((s) => s.id === id)!;
    const mid = (sub.launchAt + sub.arrivalAt) / 2;
    tick(w, mid - w.time);
    const posBefore = subPosition(w, sub, w.time);
    redirectSub(w, { ownerId: me, subId: sub.id, newDestinationId: dst2.id });
    // The sub must still be exactly where it was at the moment of the
    // turn — a redirect changes course, not position. (Regression: the
    // position used to snap onto the source→new-destination line.)
    expect(subPosition(w, sub, w.time)).toStrictEqual(posBefore);
    // And from here it must close distance toward the NEW destination
    // monotonically, starting from the pivot point.
    let prev = dist(posBefore, dst2.pos);
    for (let i = 0; i < 4; i++) {
      tick(w, (sub.arrivalAt - w.time) / 5);
      const d = dist(subPosition(w, sub, w.time), dst2.pos);
      expect(d).toBeLessThan(prev);
      prev = d;
    }
  });

  it('a redirected sub no longer triggers the old mirror-route encounter', () => {
    const { w, me, src, dst1, dst2 } = arrange();
    const enemy = w.players[1]!.id;
    // Give the enemy the dormant outpost so a mirror corridor exists.
    dst1.ownerId = enemy;
    dst1.drillers = 50;
    const nav = createSpecialist(w, me, 'navigator', { kind: 'outpost', id: src.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: src.id, destinationId: dst1.id, drillers: 5,
      specialistIds: [nav.id as unknown as SpecialistId],
    });
    const mine = w.subs.find((s) => s.id === id)!;
    const eid = issueLaunchOrder(w, {
      ownerId: enemy, sourceId: dst1.id, destinationId: src.id, drillers: 5,
    });
    const theirs = w.subs.find((s) => s.id === eid)!;
    expect(mirrorEncounterTime(mine, theirs)).not.toBeNull();
    // Redirect at 25% of the flight — BEFORE the corridor meet point
    // (symmetric subs meet at the midpoint, which would resolve the
    // encounter and remove both subs first).
    const quarter = mine.launchAt + (mine.arrivalAt - mine.launchAt) * 0.25;
    tick(w, quarter - w.time);
    redirectSub(w, { ownerId: me, subId: mine.id, newDestinationId: dst2.id });
    // The corridor geometry is gone — the formula must not fire.
    expect(mirrorEncounterTime(mine, theirs)).toBeNull();
  });
});

describe('Saboteur post-driller redirect (sub-vs-sub)', () => {
  function arrangeMirror() {
    const w = generateWorld({ seed: 5, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const sa = w.outposts.find((o) => o.ownerId === a && !hasQueenAt(w, o.id))!;
    const sb = w.outposts.find((o) => o.ownerId === b && !hasQueenAt(w, o.id))!;
    sa.drillers = 200;
    sb.drillers = 200;
    return { w, a, b, sa, sb };
  }

  it("losing side's Saboteur redirects the winning sub to its own home", () => {
    const { w, a, b, sa, sb } = arrangeMirror();
    // Saboteur on weaker side A; B is stronger so B wins driller phase.
    const sab = createSpecialist(w, a, 'saboteur', { kind: 'outpost', id: sa.id });
    issueLaunchOrder(w, {
      ownerId: a, sourceId: sa.id, destinationId: sb.id, drillers: 5,
      specialistIds: [sab.id as unknown as SpecialistId],
    });
    issueLaunchOrder(w, {
      ownerId: b, sourceId: sb.id, destinationId: sa.id, drillers: 25,
    });
    const subA = w.subs[0]!;
    const subB = w.subs[1]!;
    const bOriginalDest = subB.destinationId;
    const meet = Math.round(
      (subA.launchAt + subA.arrivalAt + subB.launchAt + subB.arrivalAt) / 4,
    );
    tick(w, meet + 1 - w.time);
    // subA destroyed (lost driller phase); subB survives with the
    // driller delta but is redirected home by A's parting Saboteur.
    expect(w.subs.find((s) => s.id === subA.id)).toBeUndefined();
    const subBAfter = w.subs.find((s) => s.id === subB.id)!;
    expect(subBAfter).toBeDefined();
    expect(subBAfter.drillers).toBe(20);
    // Sent to one of B's OWN outposts — not the original target.
    const bOwnedOutposts = w.outposts.filter((o) => o.ownerId === b);
    expect(bOwnedOutposts.map((o) => o.id)).toContain(subBAfter.destinationId);
    expect(subBAfter.destinationId).not.toBe(bOriginalDest);
  });

  it('does NOT fire when the Saboteur side wins the driller phase', () => {
    const { w, a, b, sa, sb } = arrangeMirror();
    const sab = createSpecialist(w, a, 'saboteur', { kind: 'outpost', id: sa.id });
    // A overwhelms B; saboteur on the winner has no enemy to redirect.
    issueLaunchOrder(w, {
      ownerId: a, sourceId: sa.id, destinationId: sb.id, drillers: 40,
      specialistIds: [sab.id as unknown as SpecialistId],
    });
    issueLaunchOrder(w, {
      ownerId: b, sourceId: sb.id, destinationId: sa.id, drillers: 10,
    });
    const subA = w.subs[0]!;
    const subB = w.subs[1]!;
    const aOriginalDest = subA.destinationId;
    const meet = Math.round(
      (subA.launchAt + subA.arrivalAt + subB.launchAt + subB.arrivalAt) / 4,
    );
    tick(w, meet + 1 - w.time);
    // B destroyed. A continues to its original target — saboteur silent.
    expect(w.subs.find((s) => s.id === subB.id)).toBeUndefined();
    expect(subA.destinationId).toBe(aOriginalDest);
    expect(subA.drillers).toBe(30);
  });

  it('does not fire when Double Agent ends combat first', () => {
    const { w, a, b, sa, sb } = arrangeMirror();
    const sab = createSpecialist(w, a, 'saboteur', { kind: 'outpost', id: sa.id });
    const da = createSpecialist(w, b, 'double_agent', { kind: 'outpost', id: sb.id });
    issueLaunchOrder(w, {
      ownerId: a, sourceId: sa.id, destinationId: sb.id, drillers: 40,
      specialistIds: [sab.id as unknown as SpecialistId],
    });
    issueLaunchOrder(w, {
      ownerId: b, sourceId: sb.id, destinationId: sa.id, drillers: 30,
      specialistIds: [da.id as unknown as SpecialistId],
    });
    const subA = w.subs[0]!;
    const subB = w.subs[1]!;
    const meet = Math.round(
      (subA.launchAt + subA.arrivalAt + subB.launchAt + subB.arrivalAt) / 4,
    );
    tick(w, meet + 1 - w.time);
    // Double Agent fired (CP 5), ending combat. Saboteur didn't fire.
    // Subs swap ownership; both drillers go to 0.
    expect(subA.drillers).toBe(0);
    expect(subB.drillers).toBe(0);
    expect(subA.ownerId).toBe(b);
    expect(subB.ownerId).toBe(a);
  });

  it('is silenced by Revered Elder when only one side has RE', () => {
    const { w, a, b, sa, sb } = arrangeMirror();
    const sab = createSpecialist(w, a, 'saboteur', { kind: 'outpost', id: sa.id });
    const re = createSpecialist(w, b, 'revered_elder', { kind: 'outpost', id: sb.id });
    issueLaunchOrder(w, {
      ownerId: a, sourceId: sa.id, destinationId: sb.id, drillers: 40,
      specialistIds: [sab.id as unknown as SpecialistId],
    });
    issueLaunchOrder(w, {
      ownerId: b, sourceId: sb.id, destinationId: sa.id, drillers: 30,
      specialistIds: [re.id as unknown as SpecialistId],
    });
    const subA = w.subs[0]!;
    const subB = w.subs[1]!;
    const aOriginalDest = subA.destinationId;
    const bOriginalDest = subB.destinationId;
    const meet = Math.round(
      (subA.launchAt + subA.arrivalAt + subB.launchAt + subB.arrivalAt) / 4,
    );
    tick(w, meet + 1 - w.time);
    // RE silenced Saboteur. Driller phase ran normally: a (40) > b (30) → a wins
    // with 10. The losing sub (subB) is removed; subA continues unchanged.
    expect(subA.destinationId).toBe(aOriginalDest);
    expect(subB.destinationId).toBe(bOriginalDest);
    // subB destroyed; subA survives with 10.
    expect(w.subs.find((s) => s.id === subB.id)).toBeUndefined();
    expect(subA.drillers).toBe(10);
  });
});
