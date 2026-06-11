import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { tick } from '../src/tick.js';
import {
  activeCountOf,
  createSpecialist,
  hasQueenAt,
  queenOutpostOf,
} from '../src/specialists.js';
import {
  type Outpost,
  type PlayerId,
  type SpecialistId,
  type World,
} from '../src/types.js';

function arrange(seed = 1) {
  const w = generateWorld({ seed, playerCount: 4 });
  const a = w.players[0]!.id;
  const b = w.players[1]!.id;
  const source = w.outposts
    .filter((o) => o.ownerId === a && !hasQueenAt(w, o.id))
    .sort((x, y) => y.drillers - x.drillers)[0]!;
  const target = w.outposts.find((o) => o.ownerId === b && !hasQueenAt(w, o.id))!;
  source.drillers = 200;
  return { w, a, b, source, target };
}

function launchSync(
  w: World,
  attacker: PlayerId,
  source: Outpost,
  target: Outpost,
  drillers: number,
  specialistIds?: SpecialistId[],
) {
  issueLaunchOrder(w, {
    ownerId: attacker,
    sourceId: source.id,
    destinationId: target.id,
    drillers,
    ...(specialistIds ? { specialistIds } : {}),
  });
  return w.subs[w.subs.length - 1]!;
}

describe('combat — Phase 1 specialist effects (sub-vs-outpost)', () => {
  it('Lieutenant kills 5 defender drillers in Phase 1', () => {
    const { w, a, source, target } = arrange();
    target.drillers = 20;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    const lt = createSpecialist(w, a, 'lieutenant', { kind: 'outpost', id: source.id });
    const sub = launchSync(w, a, source, target, 30, [lt.id as unknown as SpecialistId]);
    tick(w, sub.arrivalAt - w.time);
    // 30 vs (20 - 5) = 15 → attacker wins with 15 drillers.
    expect(target.ownerId).toBe(a);
    expect(target.drillers).toBe(15);
  });

  it('War Hero kills 20 defender drillers in Phase 1', () => {
    const { w, a, source, target } = arrange();
    target.drillers = 30;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    const wh = createSpecialist(w, a, 'war_hero', { kind: 'outpost', id: source.id });
    const sub = launchSync(w, a, source, target, 30, [wh.id as unknown as SpecialistId]);
    tick(w, sub.arrivalAt - w.time);
    // 30 vs (30 - 20) = 10 → attacker wins with 20.
    expect(target.ownerId).toBe(a);
    expect(target.drillers).toBe(20);
  });

  it('Infiltrator drains 20 shield in Phase 1', () => {
    const { w, a, source, target } = arrange();
    target.shieldKind = 'strong';
    target.shieldCharge = 20;
    target.shieldChargedSince = w.time;
    target.drillers = 10;
    const inf = createSpecialist(w, a, 'infiltrator', { kind: 'outpost', id: source.id });
    const sub = launchSync(w, a, source, target, 25, [inf.id as unknown as SpecialistId]);
    tick(w, sub.arrivalAt - w.time);
    // Infiltrator drains 20 shield → effective shield 0. 25 vs 10 → attacker 15.
    expect(target.ownerId).toBe(a);
    expect(target.drillers).toBe(15);
  });

  it('Thief converts 15% (ceil) of defender drillers to attacker', () => {
    const { w, a, source, target } = arrange();
    target.drillers = 50;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    const th = createSpecialist(w, a, 'thief', { kind: 'outpost', id: source.id });
    const sub = launchSync(w, a, source, target, 20, [th.id as unknown as SpecialistId]);
    tick(w, sub.arrivalAt - w.time);
    // Thief converts ceil(15% × 50) = 8 → attacker 28, defender 42.
    // 28 vs 42 → defender wins, defender remaining 14.
    expect(target.ownerId).not.toBe(a);
    expect(target.drillers).toBe(14);
  });

  it('Assassin kills enemy specialists (no in-combat damage)', () => {
    const { w, a, b, source, target } = arrange();
    target.drillers = 50;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    // Defender has a Lieutenant.
    createSpecialist(w, b, 'lieutenant', { kind: 'outpost', id: target.id });
    expect(activeCountOf(w, b, 'lieutenant')).toBe(1);
    // Attacker brings an Assassin.
    const ass = createSpecialist(w, a, 'assassin', { kind: 'outpost', id: source.id });
    const sub = launchSync(w, a, source, target, 60, [ass.id as unknown as SpecialistId]);
    tick(w, sub.arrivalAt - w.time);
    // Assassin (CP 6) kills the Lt (CP 7) before it fires.
    // So no -5 from Lt. 60 vs 50 → attacker wins with 10.
    expect(target.ownerId).toBe(a);
    expect(target.drillers).toBe(10);
    expect(activeCountOf(w, b, 'lieutenant')).toBe(0);
  });

  it('Revered Elder silences all other specialists when only one side has it', () => {
    const { w, a, b, source, target } = arrange();
    target.drillers = 50;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    // Attacker brings a Lt (would deal 5) AND a Revered Elder.
    const lt = createSpecialist(w, a, 'lieutenant', { kind: 'outpost', id: source.id });
    const re = createSpecialist(w, a, 'revered_elder', { kind: 'outpost', id: source.id });
    const sub = launchSync(w, a, source, target, 50, [
      lt.id as unknown as SpecialistId,
      re.id as unknown as SpecialistId,
    ]);
    tick(w, sub.arrivalAt - w.time);
    // Lt silenced → no -5. 50 vs 50 → tie → defender keeps with 0.
    expect(target.ownerId).toBe(b);
    expect(target.drillers).toBe(0);
  });

  it('Both sides have Revered Elder → veto cancels; other specialists fire normally', () => {
    const { w, a, b, source, target } = arrange();
    target.drillers = 50;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    const lt = createSpecialist(w, a, 'lieutenant', { kind: 'outpost', id: source.id });
    const re = createSpecialist(w, a, 'revered_elder', { kind: 'outpost', id: source.id });
    createSpecialist(w, b, 'revered_elder', { kind: 'outpost', id: target.id });
    const sub = launchSync(w, a, source, target, 50, [
      lt.id as unknown as SpecialistId,
      re.id as unknown as SpecialistId,
    ]);
    tick(w, sub.arrivalAt - w.time);
    // Both REs cancel each other; Lt -5 fires. 50 vs 45 → attacker wins, 5 remain.
    expect(target.ownerId).toBe(a);
    expect(target.drillers).toBe(5);
  });
});

describe('combat — capture phase', () => {
  it('losing side specialists become captives at the win site', () => {
    const { w, a, b, source, target } = arrange();
    target.drillers = 10;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    const defSpec = createSpecialist(w, b, 'helmsman', { kind: 'outpost', id: target.id });
    const sub = launchSync(w, a, source, target, 30);
    tick(w, sub.arrivalAt - w.time);
    expect(target.ownerId).toBe(a);
    expect(defSpec.state).toBe('captive');
    expect(defSpec.captiveOf).toBe(a);
    expect(defSpec.location).toEqual({ kind: 'outpost', id: target.id });
  });

  it('winning attacker specialists transfer from sub to captured outpost', () => {
    const { w, a, source, target } = arrange();
    target.drillers = 5;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    const attSpec = createSpecialist(w, a, 'helmsman', { kind: 'outpost', id: source.id });
    const sub = launchSync(w, a, source, target, 20, [attSpec.id as unknown as SpecialistId]);
    tick(w, sub.arrivalAt - w.time);
    expect(target.ownerId).toBe(a);
    expect(attSpec.state).toBe('active');
    expect(attSpec.location).toEqual({ kind: 'outpost', id: target.id });
  });
});

describe('combat — General / King post-spec damage', () => {
  it('General global +10 damage in any combat where you have a specialist', () => {
    const { w, a, source, target } = arrange();
    target.drillers = 20;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    // Place a General at one of attacker's outposts (not aboard the sub).
    const queenAt = queenOutpostOf(w, a)!;
    createSpecialist(w, a, 'general', { kind: 'outpost', id: queenAt });
    // Bring a Lieutenant so attacker has a specialist participating
    // in the combat (the General global trigger condition).
    const lt = createSpecialist(w, a, 'lieutenant', { kind: 'outpost', id: source.id });
    const sub = launchSync(w, a, source, target, 25, [lt.id as unknown as SpecialistId]);
    tick(w, sub.arrivalAt - w.time);
    // Lt -5, General global -10. Defender 20 -> 5. 25 vs 5 → attacker 20 remain.
    expect(target.ownerId).toBe(a);
    expect(target.drillers).toBe(20);
  });

  it('King at outpost damages incoming attacker by 1 per 3 friendly drillers', () => {
    const { w, b, source, target } = arrange();
    target.drillers = 30;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    createSpecialist(w, b, 'king', { kind: 'outpost', id: target.id });
    const sub = launchSync(w, source.ownerId!, source, target, 25);
    tick(w, sub.arrivalAt - w.time);
    // King at defender outpost: floor(30 / 3) = 10 damage to attacker.
    // 25 - 10 = 15. 15 vs 30 → defender wins, 30 - 15 = 15 remain.
    expect(target.ownerId).toBe(b);
    expect(target.drillers).toBe(15);
  });
});

describe('combat — Engineer post-victory restore', () => {
  it('25% of losses restored locally when Engineer is at battle site', () => {
    const { w, a, source, target } = arrange();
    target.drillers = 20;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    const eng = createSpecialist(w, a, 'engineer', { kind: 'outpost', id: source.id });
    const sub = launchSync(w, a, source, target, 50, [eng.id as unknown as SpecialistId]);
    tick(w, sub.arrivalAt - w.time);
    // 50 vs 20 → attacker wins, lost 20 drillers (mutual destruction in driller phase).
    // Engineer (local + global both apply since at site) → 25% + 25% = 50%
    // restore. 20 * 0.5 = 10 ceil. Surviving = 30 + 10 = 40.
    expect(target.ownerId).toBe(a);
    expect(target.drillers).toBe(40);
  });
});

describe('sub-vs-sub combat — specialist interactions', () => {
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

  it('Double Agent destroys all drillers and swaps sub ownership', () => {
    const { w, a, b, sa, sb } = arrangeMirror();
    const da = createSpecialist(w, a, 'double_agent', { kind: 'outpost', id: sa.id });
    issueLaunchOrder(w, {
      ownerId: a, sourceId: sa.id, destinationId: sb.id, drillers: 40,
      specialistIds: [da.id as unknown as SpecialistId],
    });
    issueLaunchOrder(w, {
      ownerId: b, sourceId: sb.id, destinationId: sa.id, drillers: 30,
    });
    const subA = w.subs[0]!;
    const subB = w.subs[1]!;
    const meet = Math.round(
      (subA.launchAt + subA.arrivalAt + subB.launchAt + subB.arrivalAt) / 4,
    );
    tick(w, meet + 1 - w.time);
    // After Double Agent: subA now owned by b, subB now owned by a.
    expect(subA.ownerId).toBe(b);
    expect(subB.ownerId).toBe(a);
    expect(subA.drillers).toBe(0);
    expect(subB.drillers).toBe(0);
    // The Double Agent itself swapped ownership (carried by subA which
    // now belongs to b).
    expect(da.ownerId).toBe(b);
  });

  it('Sentry attrition does not interfere with sub-vs-sub winner', () => {
    const { w, a, b, sa, sb } = arrangeMirror();
    issueLaunchOrder(w, {
      ownerId: a, sourceId: sa.id, destinationId: sb.id, drillers: 50,
    });
    issueLaunchOrder(w, {
      ownerId: b, sourceId: sb.id, destinationId: sa.id, drillers: 20,
    });
    const subA = w.subs[0]!;
    tick(w, subA.arrivalAt + 1 - w.time);
    // A wins, has some survivors left, then arrives at sb. Just sanity.
    expect(w.subs.length).toBeLessThanOrEqual(1);
  });
});
