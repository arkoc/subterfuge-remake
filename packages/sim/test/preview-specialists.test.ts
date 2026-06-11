import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { simulateArrival, simulateSubArrival } from '../src/preview.js';
import {
  createSpecialist,
  hasQueenAt,
} from '../src/specialists.js';

/**
 * Combat-preview now carries a per-specialist diff. These tests
 * exercise the four diff lists (attackerKilled, attackerCaptured,
 * defenderKilled, defenderCaptured) under representative outcomes.
 */
describe('ArrivalPreview specialist breakdown', () => {
  it('non-combat outcomes have empty specialist arrays', () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
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
    expect(p.attackerKilled).toEqual([]);
    expect(p.attackerCaptured).toEqual([]);
    expect(p.defenderKilled).toEqual([]);
    expect(p.defenderCaptured).toEqual([]);
  });

  it('attacker-wins captures the defender specialists', () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    const enemy = w.players[1]!.id;
    const source = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.drillers >= 10,
    )!;
    const target = w.outposts.find(
      (o) => o.ownerId === enemy && !hasQueenAt(w, o.id),
    )!;
    // Stage a Foreman at the defender outpost; overwhelming attack
    // should capture (and capture the Foreman as a side effect).
    createSpecialist(w, enemy, 'foreman', { kind: 'outpost', id: target.id });
    const p = simulateArrival({
      world: w,
      sourceId: source.id,
      destinationId: target.id,
      drillers: 250, // overwhelming
      attackerId: me,
    });
    expect(p.outcome).toBe('attacker-wins');
    // defenderCaptured = the defender's specialists I now hold.
    const captured = p.defenderCaptured.map((s) => s.kind);
    expect(captured).toContain('foreman');
  });

  it('defender-wins captures the attacker specialists', () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    const enemy = w.players[1]!.id;
    const source = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.drillers >= 10,
    )!;
    const target = w.outposts.find(
      (o) => o.ownerId === enemy && !hasQueenAt(w, o.id),
    )!;
    // Stage a Helmsman on my sub; small attack will lose, and my
    // surviving Helmsman becomes a captive of the defender.
    const helm = createSpecialist(w, me, 'helmsman', {
      kind: 'outpost',
      id: source.id,
    });
    const subId = issueLaunchOrder(w, {
      ownerId: me,
      sourceId: source.id,
      destinationId: target.id,
      drillers: 2,
      specialistIds: [helm.id],
    });
    expect(subId).toBeDefined();
    const sub = w.subs.find((s) => s.id === subId)!;
    const p = simulateSubArrival(w, sub);
    expect(p.outcome).toBe('defender-wins');
    // attackerCaptured = my specialists the defender took prisoner.
    const lost = p.attackerCaptured.map((s) => s.kind);
    expect(lost).toContain('helmsman');
  });
});
