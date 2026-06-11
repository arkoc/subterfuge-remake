import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { tick } from '../src/tick.js';
import { resolveCombat } from '../src/combat.js';
import { createSpecialist, hasQueenAt } from '../src/specialists.js';
import { currentShieldCharge } from '../src/shield.js';
import { electricalOutput } from '../src/production.js';
import { SHIELD_MAX } from '../src/types.js';

/**
 * Three rulebook-conformance fixes (2026-05-28):
 *   - Infiltrator drains the FULL shield (not 20 charges per infiltrator).
 *   - Sentry has NO in-combat driller damage (only the 2-hour passive).
 *   - Engineer-restored drillers clamp to the electrical cap.
 */
describe('specialist rulebook fixes', () => {
  it('Infiltrator drains all shield charge', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const enemy = w.players[1]!.id;
    const src = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id),
    )!;
    const target = w.outposts.find(
      (o) => o.ownerId === enemy && !hasQueenAt(w, o.id),
    )!;
    (src as { drillers: number }).drillers = 200;
    // Stage a high shield on the target outpost (use 'strong' kind cap).
    target.shieldKind = 'strong';
    target.shieldCharge = SHIELD_MAX.strong; // start fully charged
    target.shieldChargedSince = w.time;
    const inf = createSpecialist(w, me, 'infiltrator', {
      kind: 'outpost',
      id: src.id,
    });
    // Send a tiny sub with the Infiltrator. Drillers don't matter — we
    // only care that on arrival the outpost's shield goes to 0.
    const subId = issueLaunchOrder(w, {
      ownerId: me,
      sourceId: src.id,
      destinationId: target.id,
      drillers: 1,
      specialistIds: [inf.id],
    });
    const sub = w.subs.find((s) => s.id === subId)!;
    tick(w, sub.arrivalAt + 1 - w.time);
    // Outpost may have been captured or held; either way its shield
    // should be 0 right after combat.
    expect(currentShieldCharge(target, w.time, w)).toBe(0);
  });

  it('Sentry deals NO in-combat damage', () => {
    const w = generateWorld({ seed: 13, playerCount: 4 });
    const me = w.players[0]!.id;
    const enemy = w.players[1]!.id;
    const src = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id),
    )!;
    const defenderOutpost = w.outposts.find(
      (o) => o.ownerId === enemy && !hasQueenAt(w, o.id),
    )!;
    (src as { drillers: number }).drillers = 50;
    (defenderOutpost as { drillers: number }).drillers = 30;
    defenderOutpost.shieldKind = 'weak';
    defenderOutpost.shieldCharge = 0; // no shield to confound the count
    // Stage a Sentry at the defender — used to add +5 per Sentry in
    // combat under the old code. The rulebook says Sentry has no
    // in-combat damage, only the 2-hour passive.
    createSpecialist(w, enemy, 'sentry', {
      kind: 'outpost',
      id: defenderOutpost.id,
    });
    const subId = issueLaunchOrder(w, {
      ownerId: me,
      sourceId: src.id,
      destinationId: defenderOutpost.id,
      drillers: 20,
    });
    const sub = w.subs.find((s) => s.id === subId)!;
    // Directly resolve combat at the arrival moment so the Sentry's
    // passive timer doesn't interfere with what we're measuring.
    const r = resolveCombat(w, sub, defenderOutpost);
    // Defender (30) vs attacker (20). No shield. No Sentry in-combat
    // damage → defender takes 20, survives with 10. If the old
    // 5/Sentry bug were still live, attacker would take +5 and lose
    // with 15 left.
    expect(r.defenderSurviving).toBe(10);
    expect(r.outpostCaptured).toBe(false);
  });

  it('Engineer restore cannot ADD drillers above the cap, but defending drillers are preserved', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const enemy = w.players[1]!.id;
    const myOutpost = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id),
    )!;
    const enemyOutpost = w.outposts.find(
      (o) => o.ownerId === enemy && !hasQueenAt(w, o.id),
    )!;
    const cap = electricalOutput(w, me);
    const initialDrillers = Math.max(1, cap - 5);
    (myOutpost as { drillers: number }).drillers = initialDrillers;
    (enemyOutpost as { drillers: number }).drillers = 50;
    createSpecialist(w, me, 'engineer', {
      kind: 'outpost',
      id: myOutpost.id,
    });
    const subId = issueLaunchOrder(w, {
      ownerId: enemy,
      sourceId: enemyOutpost.id,
      destinationId: myOutpost.id,
      drillers: 3,
    });
    const sub = w.subs.find((s) => s.id === subId)!;
    const r = resolveCombat(w, sub, myOutpost);
    expect(r.outpostCaptured).toBe(false);
    // After combat, defending drillers are preserved (combat losses
    // pass through cap-clamping). Engineer restore is bounded by
    // headroom so it can't push the outpost ABOVE its pre-combat
    // count when the owner is at/over cap.
    expect(myOutpost.drillers).toBeLessThanOrEqual(initialDrillers);
    // And the outpost retains a meaningful garrison — the bug we
    // fixed was clamping survivors all the way to 0 because
    // `totalDrillers - outpost.drillers` exceeded cap.
    expect(myOutpost.drillers).toBeGreaterThan(0);
  });
});
