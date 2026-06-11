import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import {
  effectiveSpeed,
  recomputeSpeedAndArrival,
  travelTimeBetween,
} from '../src/subs.js';
import {
  createSpecialist,
  hasQueenAt,
  queenOutpostOf,
} from '../src/specialists.js';
import type { SpecialistId } from '../src/types.js';

function setup(seed = 11) {
  const w = generateWorld({ seed, playerCount: 4 });
  const me = w.players[0]!.id;
  const enemy = w.players[1]!.id;
  const mySrc = w.outposts.find(
    (o) => o.ownerId === me && !hasQueenAt(w, o.id),
  )!;
  const dormant = w.outposts.find((o) => o.ownerId === null)!;
  const enemyOutpost = w.outposts.find((o) => o.ownerId === enemy)!;
  // Preload drillers so launches don't fail.
  mySrc.drillers = 200;
  return { w, me, enemy, mySrc, dormant, enemyOutpost };
}

describe('effectiveSpeed — local-max rule', () => {
  it('no specialists → 1.0×', () => {
    const { w, me, mySrc, dormant } = setup();
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
    });
    const sub = w.subs.find((s) => s.id === id)!;
    expect(sub.speedMultiplier).toBe(1.0);
  });

  it('Helmsman aboard → 2.0×', () => {
    const { w, me, mySrc, dormant } = setup();
    const h = createSpecialist(w, me, 'helmsman', { kind: 'outpost', id: mySrc.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [h.id as unknown as SpecialistId],
    });
    const sub = w.subs.find((s) => s.id === id)!;
    expect(sub.speedMultiplier).toBe(2.0);
    // Arrival time should be approximately half of the unmodified trip.
    const dist = travelTimeBetween(mySrc, dormant, 1.0);
    const fast = travelTimeBetween(mySrc, dormant, 2.0);
    expect(sub.arrivalAt - sub.launchAt).toBe(fast);
    expect(fast).toBeLessThan(dist);
  });

  it('Helmsman + Lieutenant → 2.0× (max of 2.0 and 1.5)', () => {
    const { w, me, mySrc, dormant } = setup();
    const h = createSpecialist(w, me, 'helmsman', { kind: 'outpost', id: mySrc.id });
    const lt = createSpecialist(w, me, 'lieutenant', { kind: 'outpost', id: mySrc.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [h.id as unknown as SpecialistId, lt.id as unknown as SpecialistId],
    });
    const sub = w.subs.find((s) => s.id === id)!;
    expect(sub.speedMultiplier).toBe(2.0);
  });

  it('Smuggler heading to friendly outpost → 3.0×', () => {
    const { w, me, mySrc } = setup();
    const friendlyDst = w.outposts.find(
      (o) => o.ownerId === me && o.id !== mySrc.id,
    )!;
    const smug = createSpecialist(w, me, 'smuggler', { kind: 'outpost', id: mySrc.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: friendlyDst.id, drillers: 5,
      specialistIds: [smug.id as unknown as SpecialistId],
    });
    const sub = w.subs.find((s) => s.id === id)!;
    expect(sub.speedMultiplier).toBe(3.0);
  });

  it('Smuggler heading to non-friendly outpost → 1.0× (bonus disappears)', () => {
    const { w, me, mySrc, dormant } = setup();
    const smug = createSpecialist(w, me, 'smuggler', { kind: 'outpost', id: mySrc.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [smug.id as unknown as SpecialistId],
    });
    const sub = w.subs.find((s) => s.id === id)!;
    expect(sub.speedMultiplier).toBe(1.0);
  });

  it('Smuggler + Helmsman → 3.0× when heading friendly, 2.0× otherwise', () => {
    const { w, me, mySrc, dormant } = setup();
    const friendlyDst = w.outposts.find(
      (o) => o.ownerId === me && o.id !== mySrc.id,
    )!;
    const smug = createSpecialist(w, me, 'smuggler', { kind: 'outpost', id: mySrc.id });
    const h = createSpecialist(w, me, 'helmsman', { kind: 'outpost', id: mySrc.id });
    const idA = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: friendlyDst.id, drillers: 5,
      specialistIds: [smug.id as unknown as SpecialistId, h.id as unknown as SpecialistId],
    });
    const subA = w.subs.find((s) => s.id === idA)!;
    expect(subA.speedMultiplier).toBe(3.0);

    // Need a second source to also include a Smuggler+Helmsman.
    mySrc.drillers = 50;
    const smug2 = createSpecialist(w, me, 'smuggler', { kind: 'outpost', id: mySrc.id });
    const h2 = createSpecialist(w, me, 'helmsman', { kind: 'outpost', id: mySrc.id });
    const idB = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [smug2.id as unknown as SpecialistId, h2.id as unknown as SpecialistId],
    });
    const subB = w.subs.find((s) => s.id === idB)!;
    expect(subB.speedMultiplier).toBe(2.0); // Helmsman wins, Smuggler dormant
  });
});

describe('Admiral global passive', () => {
  it('1 Admiral → 1.5× to subs with no specialists aboard', () => {
    const { w, me, mySrc, dormant } = setup();
    const queenAt = queenOutpostOf(w, me)!;
    createSpecialist(w, me, 'admiral', { kind: 'outpost', id: queenAt });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
    });
    const sub = w.subs.find((s) => s.id === id)!;
    expect(sub.speedMultiplier).toBe(1.5);
  });

  it('2 Admirals → 2.0×; 3 → 2.5×', () => {
    const { w, me, mySrc, dormant } = setup();
    const queenAt = queenOutpostOf(w, me)!;
    createSpecialist(w, me, 'admiral', { kind: 'outpost', id: queenAt });
    createSpecialist(w, me, 'admiral', { kind: 'outpost', id: queenAt });
    const id1 = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
    });
    expect(w.subs.find((s) => s.id === id1)!.speedMultiplier).toBe(2.0);

    createSpecialist(w, me, 'admiral', { kind: 'outpost', id: queenAt });
    mySrc.drillers = 50;
    const id2 = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
    });
    expect(w.subs.find((s) => s.id === id2)!.speedMultiplier).toBe(2.5);
  });

  it('does not boost subs carrying a specialist', () => {
    const { w, me, mySrc, dormant } = setup();
    const queenAt = queenOutpostOf(w, me)!;
    createSpecialist(w, me, 'admiral', { kind: 'outpost', id: queenAt });
    createSpecialist(w, me, 'admiral', { kind: 'outpost', id: queenAt });
    // Add a single non-speed specialist to the sub.
    const inf = createSpecialist(w, me, 'infiltrator', { kind: 'outpost', id: mySrc.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [inf.id as unknown as SpecialistId],
    });
    const sub = w.subs.find((s) => s.id === id)!;
    // Infiltrator has no local speed entry → max stays 1.0×.
    expect(sub.speedMultiplier).toBe(1.0);
  });
});

describe('issueLaunchOrder — specialist boarding validation', () => {
  it('rejects boarding a specialist owned by another player', () => {
    const { w, me, mySrc, dormant, enemy } = setup();
    const enemySpec = createSpecialist(w, enemy, 'helmsman', { kind: 'outpost', id: mySrc.id });
    expect(() =>
      issueLaunchOrder(w, {
        ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
        specialistIds: [enemySpec.id as unknown as SpecialistId],
      }),
    ).toThrow(/not owned/);
  });

  it('rejects boarding a captive specialist', () => {
    const { w, me, mySrc, dormant, enemy } = setup();
    const s = createSpecialist(w, me, 'helmsman', { kind: 'outpost', id: mySrc.id });
    s.state = 'captive';
    s.captiveOf = enemy;
    expect(() =>
      issueLaunchOrder(w, {
        ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
        specialistIds: [s.id as unknown as SpecialistId],
      }),
    ).toThrow(/captive/);
  });

  it('allows boarding specialists whose ability fires at an outpost (Sentry, Foreman, etc.)', () => {
    // All specialists are physically mobile per the rulebook — only
    // captives are restricted. The Sentry's *ability* fires from an
    // outpost but the unit itself can ride subs.
    const { w, me, mySrc, dormant } = setup();
    const sentry = createSpecialist(w, me, 'sentry', { kind: 'outpost', id: mySrc.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [sentry.id as unknown as SpecialistId],
    });
    expect(sentry.location).toEqual({ kind: 'sub', id });
  });

  it('rejects boarding a specialist not at the source outpost', () => {
    const { w, me, mySrc, dormant } = setup();
    const otherOutpost = w.outposts.find(
      (o) => o.ownerId === me && o.id !== mySrc.id,
    )!;
    const h = createSpecialist(w, me, 'helmsman', { kind: 'outpost', id: otherOutpost.id });
    expect(() =>
      issueLaunchOrder(w, {
        ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
        specialistIds: [h.id as unknown as SpecialistId],
      }),
    ).toThrow(/not at the source/);
  });

  it('on success, moves specialists from outpost onto the sub', () => {
    const { w, me, mySrc, dormant } = setup();
    const h = createSpecialist(w, me, 'helmsman', { kind: 'outpost', id: mySrc.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [h.id as unknown as SpecialistId],
    });
    expect(h.location).toEqual({ kind: 'sub', id });
  });
});

describe('recomputeSpeedAndArrival', () => {
  it('rebuilds arrivalAt from current position when speed changes mid-flight', () => {
    const { w, me, mySrc, dormant } = setup();
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
    });
    const sub = w.subs.find((s) => s.id === id)!;
    const originalArrival = sub.arrivalAt;
    // Advance time to a point past launch.
    const mid = (sub.launchAt + sub.arrivalAt) / 2;
    // Add an Admiral mid-flight (synthetic — would normally only happen
    // via promotion at a friendly outpost, but the recompute path
    // should handle any speed change cleanly).
    const queenAt = queenOutpostOf(w, me)!;
    createSpecialist(w, me, 'admiral', { kind: 'outpost', id: queenAt });
    recomputeSpeedAndArrival(w, sub, mid);
    expect(sub.speedMultiplier).toBe(1.5);
    // New arrival is `mid + remaining_distance / 1.5` — less than original.
    expect(sub.arrivalAt).toBeLessThan(originalArrival);
    expect(sub.arrivalAt).toBeGreaterThan(mid);
  });

  it('full-trip recompute when called before launch', () => {
    const { w, me, mySrc, dormant } = setup();
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
    });
    const sub = w.subs.find((s) => s.id === id)!;
    // Add Helmsman before launch — speed should rebuild from launchAt.
    const h = createSpecialist(w, me, 'helmsman', { kind: 'outpost', id: mySrc.id });
    h.location = { kind: 'sub', id };
    recomputeSpeedAndArrival(w, sub, 0); // now < launchAt
    expect(sub.speedMultiplier).toBe(2.0);
    expect(sub.arrivalAt - sub.launchAt).toBe(
      travelTimeBetween(mySrc, dormant, 2.0),
    );
  });
});

describe('Smuggler dynamic recompute on destination ownership change', () => {
  it('Smuggler heading to a dormant outpost gets the 3× bonus when the dormant becomes friendly', async () => {
    const { w, me, mySrc, dormant } = setup();
    const smug = createSpecialist(w, me, 'smuggler', { kind: 'outpost', id: mySrc.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [smug.id as unknown as SpecialistId],
    });
    const sub = w.subs.find((s) => s.id === id)!;
    // Headed to dormant — Smuggler bonus dormant.
    expect(sub.speedMultiplier).toBe(1.0);
    // Simulate a "the dormant was just captured by us" event by
    // mutating ownership and calling the recompute hook directly
    // (which is what arriveSub does for us in the real flow).
    const { recomputeSubsTargeting } = await import('../src/subs.js');
    dormant.ownerId = me;
    recomputeSubsTargeting(w, dormant.id, w.time);
    expect(sub.speedMultiplier).toBe(3.0);
  });

  it('Smuggler heading to a friendly outpost loses the 3× bonus when an enemy captures it', async () => {
    const { w, me, mySrc } = setup();
    const friendly = w.outposts.find(
      (o) => o.ownerId === me && o.id !== mySrc.id,
    )!;
    const smug = createSpecialist(w, me, 'smuggler', { kind: 'outpost', id: mySrc.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: friendly.id, drillers: 5,
      specialistIds: [smug.id as unknown as SpecialistId],
    });
    const sub = w.subs.find((s) => s.id === id)!;
    expect(sub.speedMultiplier).toBe(3.0);
    const enemy = w.players[1]!.id;
    friendly.ownerId = enemy;
    const { recomputeSubsTargeting } = await import('../src/subs.js');
    recomputeSubsTargeting(w, friendly.id, w.time);
    expect(sub.speedMultiplier).toBe(1.0);
  });
});

describe('effectiveSpeed is a pure read', () => {
  it('does not mutate the sub or world', () => {
    const { w, me, mySrc, dormant } = setup();
    const h = createSpecialist(w, me, 'helmsman', { kind: 'outpost', id: mySrc.id });
    const id = issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dormant.id, drillers: 5,
      specialistIds: [h.id as unknown as SpecialistId],
    });
    const sub = w.subs.find((s) => s.id === id)!;
    const snapshot = JSON.stringify(sub);
    effectiveSpeed(w, sub);
    expect(JSON.stringify(sub)).toBe(snapshot);
  });
});
