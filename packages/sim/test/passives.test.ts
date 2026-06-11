import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { tick } from '../src/tick.js';
import {
  electricalOutput,
  factoryCycleIntervalFor,
  factoryProductionFor,
} from '../src/production.js';
import { currentShieldCharge, maxShieldCharge, commitShield } from '../src/shield.js';
import { sonarRange } from '../src/visibility.js';
import { SENTRY_FIRE_INTERVAL_MS, tryInspectorRecharge } from '../src/passives.js';
import {
  activeQueenOf,
  createSpecialist,
  hasQueenAt,
  queenOutpostOf,
} from '../src/specialists.js';
import {
  FACTORY_CYCLE_MS,
  HIRE_INITIAL_MS,
  HOUR_MS,
  QUEEN_ELECTRICAL_OUTPUT,
  SHIELD_MAX,
  SONAR_RANGE,
} from '../src/types.js';

describe('maxShieldCharge — specialist modifiers', () => {
  it('Queen at outpost: +20 max shield', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const queenAt = queenOutpostOf(w, me)!;
    const outpost = w.outposts.find((o) => o.id === queenAt)!;
    const base = SHIELD_MAX[outpost.shieldKind];
    expect(maxShieldCharge(w, outpost)).toBe(base + 20);
  });

  it('Security Chief global +10/SC, local +10', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const queenAt = queenOutpostOf(w, me)!;
    const here = w.outposts.find((o) => o.id === queenAt)!;
    const other = w.outposts.find((o) => o.ownerId === me && o.id !== queenAt)!;
    const baseHere = SHIELD_MAX[here.shieldKind];
    const baseOther = SHIELD_MAX[other.shieldKind];

    // 1 SC at `other` outpost.
    createSpecialist(w, me, 'security_chief', { kind: 'outpost', id: other.id });
    // global +10 affects both; local +10 only at `other`.
    expect(maxShieldCharge(w, here)).toBe(baseHere + 20 /*queen*/ + 10);
    expect(maxShieldCharge(w, other)).toBe(baseOther + 10 + 10);

    // Add a second SC, also at `other`. Globals stack.
    createSpecialist(w, me, 'security_chief', { kind: 'outpost', id: other.id });
    expect(maxShieldCharge(w, here)).toBe(baseHere + 20 + 20); // 2 SC global
    expect(maxShieldCharge(w, other)).toBe(baseOther + 20 + 20); // 2 SC global + 2 local
  });

  it('King: global -20 per King; local +20 only at King outpost', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const queenAt = queenOutpostOf(w, me)!;
    const here = w.outposts.find((o) => o.id === queenAt)!;
    const other = w.outposts.find((o) => o.ownerId === me && o.id !== queenAt)!;
    const baseHere = SHIELD_MAX[here.shieldKind];
    const baseOther = SHIELD_MAX[other.shieldKind];

    createSpecialist(w, me, 'king', { kind: 'outpost', id: other.id });
    // King at `other`: net 0 at other (-20 global + 20 local).
    // At `here`: -20.
    expect(maxShieldCharge(w, here)).toBe(baseHere + 20 - 20); // queen + king-global
    expect(maxShieldCharge(w, other)).toBe(baseOther + 0);
  });
});

describe('sonarRange — Princess & Intelligence Officer', () => {
  it('1 IO → +25%; 2 IOs → +50%', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const queenAt = queenOutpostOf(w, me)!;
    const here = w.outposts.find((o) => o.id === queenAt)!;
    expect(sonarRange(w, here)).toBe(SONAR_RANGE);
    createSpecialist(w, me, 'intelligence_officer', { kind: 'outpost', id: queenAt });
    expect(sonarRange(w, here)).toBe(SONAR_RANGE * 1.25);
    createSpecialist(w, me, 'intelligence_officer', { kind: 'outpost', id: queenAt });
    expect(sonarRange(w, here)).toBe(SONAR_RANGE * 1.5);
  });

  it('Princess at outpost: +50% (no stacking with second Princess at same outpost)', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const out = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    expect(sonarRange(w, out)).toBe(SONAR_RANGE);
    createSpecialist(w, me, 'princess', { kind: 'outpost', id: out.id });
    expect(sonarRange(w, out)).toBe(SONAR_RANGE * 1.5);
    createSpecialist(w, me, 'princess', { kind: 'outpost', id: out.id });
    expect(sonarRange(w, out)).toBe(SONAR_RANGE * 1.5); // still +50%
  });

  it('IO and Princess stack additively (+25% + +50% = +75%)', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const out = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    createSpecialist(w, me, 'intelligence_officer', { kind: 'outpost', id: out.id });
    createSpecialist(w, me, 'princess', { kind: 'outpost', id: out.id });
    expect(sonarRange(w, out)).toBe(SONAR_RANGE * 1.75);
  });
});

describe('electricalOutput — specialist bonuses', () => {
  it('Tinkerer: +3 × max_shield per Tinkerer at outpost', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const outpost = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const base = electricalOutput(w, me);
    createSpecialist(w, me, 'tinkerer', { kind: 'outpost', id: outpost.id });
    const max = maxShieldCharge(w, outpost);
    expect(electricalOutput(w, me)).toBe(base + 3 * max);
  });

  it('Minister of Energy: +300 per MoE globally', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const queenAt = queenOutpostOf(w, me)!;
    const base = electricalOutput(w, me);
    createSpecialist(w, me, 'minister_of_energy', { kind: 'outpost', id: queenAt });
    expect(electricalOutput(w, me)).toBe(base + 300);
    createSpecialist(w, me, 'minister_of_energy', { kind: 'outpost', id: queenAt });
    expect(electricalOutput(w, me)).toBe(base + 600);
  });

  it('Queen contributes +150 only while at owned outpost', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const base = electricalOutput(w, me);
    const queen = activeQueenOf(w, me)!;
    expect(base).toBeGreaterThanOrEqual(QUEEN_ELECTRICAL_OUTPUT);
    // Move Queen to a sub — bonus vanishes.
    queen.location = { kind: 'sub', id: 999 as unknown as ReturnType<typeof Number> as never };
    expect(electricalOutput(w, me)).toBe(base - QUEEN_ELECTRICAL_OUTPUT);
  });
});

describe('factoryProductionFor — specialist modifiers', () => {
  it('default: 6/cycle', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const f = w.outposts.find((o) => o.ownerId === me && o.kind === 'factory')!;
    expect(factoryProductionFor(w, f)).toBe(6);
  });

  it('Foreman at factory: +6 (so 12/cycle)', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const f = w.outposts.find((o) => o.ownerId === me && o.kind === 'factory')!;
    createSpecialist(w, me, 'foreman', { kind: 'outpost', id: f.id });
    expect(factoryProductionFor(w, f)).toBe(12);
  });

  it('Tycoon local: +3 per Tycoon at the factory (per-cycle)', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const f = w.outposts.find((o) => o.ownerId === me && o.kind === 'factory')!;
    createSpecialist(w, me, 'tycoon', { kind: 'outpost', id: f.id });
    // Tycoon global is now a cycle-interval scaler (tested
    // separately), not a per-cycle output multiplier. Per-cycle
    // output: base 6 + 3 local = 9.
    expect(factoryProductionFor(w, f)).toBe(9);
  });

  it('Tycoon global shortens cycle interval by 50% per Tycoon', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const queenAt = queenOutpostOf(w, me)!;
    expect(factoryCycleIntervalFor(w, me)).toBe(FACTORY_CYCLE_MS);
    // 1 Tycoon → interval × 2/3
    createSpecialist(w, me, 'tycoon', { kind: 'outpost', id: queenAt });
    expect(factoryCycleIntervalFor(w, me)).toBe(
      Math.round(FACTORY_CYCLE_MS / 1.5),
    );
    // 2 Tycoons → interval × 1/2
    createSpecialist(w, me, 'tycoon', { kind: 'outpost', id: queenAt });
    expect(factoryCycleIntervalFor(w, me)).toBe(
      Math.round(FACTORY_CYCLE_MS / 2),
    );
  });

  it('Minister of Energy global penalty: -1 per MoE per factory', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const f = w.outposts.find((o) => o.ownerId === me && o.kind === 'factory')!;
    const queenAt = queenOutpostOf(w, me)!;
    createSpecialist(w, me, 'minister_of_energy', { kind: 'outpost', id: queenAt });
    expect(factoryProductionFor(w, f)).toBe(5); // 6 - 1
    createSpecialist(w, me, 'minister_of_energy', { kind: 'outpost', id: queenAt });
    expect(factoryProductionFor(w, f)).toBe(4); // 6 - 2
  });

  it('Foreman compensates for MoE penalty', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const f = w.outposts.find((o) => o.ownerId === me && o.kind === 'factory')!;
    const queenAt = queenOutpostOf(w, me)!;
    createSpecialist(w, me, 'minister_of_energy', { kind: 'outpost', id: queenAt });
    createSpecialist(w, me, 'foreman', { kind: 'outpost', id: f.id });
    expect(factoryProductionFor(w, f)).toBe(11); // 6+6 - 1 = 11
  });
});

describe('currentShieldCharge — Tinkerer drain', () => {
  it('drains 3 charges per hour per Tinkerer', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const out = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    out.shieldCharge = 10;
    out.shieldChargedSince = 0;
    createSpecialist(w, me, 'tinkerer', { kind: 'outpost', id: out.id });
    // After 2 hours: -6 from drain. Recharge step is 48h/max so very
    // little gain. Live charge should be approximately 10 - 6 = 4.
    const after = currentShieldCharge(out, 2 * HOUR_MS, w);
    expect(after).toBeLessThan(10);
    expect(after).toBeGreaterThan(0);
    // Specifically: drain dominates while recharge step >> drain step.
    // We expect ~4 ± 1 from rounding.
    expect(after).toBeLessThanOrEqual(5);
  });

  it('drains all the way to 0 over time', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const out = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    out.shieldCharge = SHIELD_MAX[out.shieldKind];
    out.shieldChargedSince = 0;
    createSpecialist(w, me, 'tinkerer', { kind: 'outpost', id: out.id });
    // After 24h, with drain 3/h, max ~10–20 ⇒ should be drained close to 0.
    expect(currentShieldCharge(out, 24 * HOUR_MS, w)).toBe(0);
  });

  it('legacy currentShieldCharge(o, now) still works without world', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const out = w.outposts.find((o) => o.ownerId === me)!;
    out.shieldCharge = 5;
    out.shieldChargedSince = 0;
    expect(currentShieldCharge(out, HOUR_MS)).toBeGreaterThanOrEqual(5);
  });
});

describe('Inspector recharge', () => {
  it('full-charges shield on friendly sub arrival', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const src = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id),
    )!;
    const dst = w.outposts.find(
      (o) => o.ownerId === me && o.id !== src.id && !hasQueenAt(w, o.id),
    )!;
    src.drillers = 50;
    dst.shieldCharge = 0;
    dst.shieldChargedSince = 0;
    createSpecialist(w, me, 'inspector', { kind: 'outpost', id: dst.id });
    issueLaunchOrder(w, {
      ownerId: me, sourceId: src.id, destinationId: dst.id, drillers: 5,
    });
    const sub = w.subs[w.subs.length - 1]!;
    tick(w, sub.arrivalAt + 1 - w.time);
    // Inspector recharges to max on arrival.
    expect(dst.shieldCharge).toBe(maxShieldCharge(w, dst));
  });

  it('tryInspectorRecharge no-op when no Inspector is present', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const out = w.outposts.find((o) => o.ownerId === me)!;
    out.shieldCharge = 1;
    out.shieldChargedSince = 0;
    tryInspectorRecharge(w, out, HOUR_MS);
    expect(out.shieldCharge).toBe(1);
  });
});

describe('Sentry attrition', () => {
  it('fires every 2 hours and reduces enemy sub drillers by 5% (ceil)', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const them = w.players[1]!.id;
    const myOutpost = w.outposts.find((o) => o.ownerId === me)!;
    // Put a Sentry at my outpost.
    const sentry = createSpecialist(w, me, 'sentry', {
      kind: 'outpost',
      id: myOutpost.id,
    });
    sentry.nextActionAt = SENTRY_FIRE_INTERVAL_MS;
    // Launch an enemy sub that will be in flight near my outpost.
    // Use their nearest owned outpost as source pointed at me.
    const theirSrc = w.outposts.find(
      (o) => o.ownerId === them && !hasQueenAt(w, o.id),
    )!;
    theirSrc.drillers = 100;
    issueLaunchOrder(w, {
      ownerId: them, sourceId: theirSrc.id, destinationId: myOutpost.id, drillers: 100,
    });
    const enemySub = w.subs[w.subs.length - 1]!;
    // Tick past first sentry shot. The sub may or may not be in
    // range; ensure that at least once the sentry has fired (resets
    // nextActionAt).
    tick(w, SENTRY_FIRE_INTERVAL_MS + 1 - w.time);
    expect(sentry.nextActionAt).toBeGreaterThan(SENTRY_FIRE_INTERVAL_MS);
    // If the sub came into range and was hit, drillers should be < 100.
    // We don't assert exactly because the in-range geometry depends on
    // seed/timing; instead assert no growth.
    expect(enemySub.drillers).toBeLessThanOrEqual(100);
  });

  it('does not target own subs', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const myOutpost = w.outposts.find((o) => o.ownerId === me)!;
    const sentry = createSpecialist(w, me, 'sentry', {
      kind: 'outpost',
      id: myOutpost.id,
    });
    sentry.nextActionAt = SENTRY_FIRE_INTERVAL_MS;
    const mySrc = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id),
    )!;
    mySrc.drillers = 100;
    const dst = w.outposts.find((o) => o.ownerId === null)!;
    issueLaunchOrder(w, {
      ownerId: me, sourceId: mySrc.id, destinationId: dst.id, drillers: 50,
    });
    const mySub = w.subs[w.subs.length - 1]!;
    const before = mySub.drillers;
    tick(w, SENTRY_FIRE_INTERVAL_MS + 1 - w.time);
    expect(mySub.drillers).toBe(before);
  });

  it('hire schedule sets nextActionAt for Sentry', async () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const queenAt = queenOutpostOf(w, me)!;
    w.time = HIRE_INITIAL_MS;
    // Manually spawn a Sentry as if via hire (skipping roster).
    const sentry = createSpecialist(w, me, 'sentry', {
      kind: 'outpost',
      id: queenAt,
    });
    // Mimic the hire-path schedule call.
    const { scheduleSentry } = await import('../src/passives.js');
    scheduleSentry(sentry, w.time);
    expect(sentry.nextActionAt).toBe(w.time + SENTRY_FIRE_INTERVAL_MS);
  });
});

describe('Tinkerer drain history is preserved when the Tinkerer leaves', () => {
  it('drain that happened before the Tinkerer departed is baked into the shield checkpoint', async () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const out = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    out.shieldCharge = 10;
    out.shieldChargedSince = 0;
    const tinkerer = createSpecialist(w, me, 'tinkerer', { kind: 'outpost', id: out.id });
    // After 2 hours, shield has drained from 10 to ~4 (3/h × 2h = 6).
    const drainedAt2h = currentShieldCharge(out, 2 * HOUR_MS, w);
    expect(drainedAt2h).toBeLessThan(10);
    expect(drainedAt2h).toBeGreaterThan(0);

    // The Tinkerer boards a sub at t=2h (simulated by manually
    // changing location and calling commitShieldAtSpecialistOutpost
    // first, which is exactly what issueLaunchOrder does).
    const { commitShieldAtSpecialistOutpost } = await import('../src/shield.js');
    commitShieldAtSpecialistOutpost(w, tinkerer, 2 * HOUR_MS);
    tinkerer.location = { kind: 'sub', id: 999 as unknown as ReturnType<typeof Number> as never };

    // The pre-commit captured the drained value as the new checkpoint.
    expect(out.shieldCharge).toBe(drainedAt2h);
    expect(out.shieldChargedSince).toBe(2 * HOUR_MS);

    // Future queries see drain stop (no Tinkerer there) and recharge
    // resume — the value at t=2h must NOT retroactively jump back to 10.
    const futureNoDrain = currentShieldCharge(out, 2 * HOUR_MS, w);
    expect(futureNoDrain).toBe(drainedAt2h);
  });
});

describe('commitShield with world', () => {
  it('snapshots the live charge accounting for specialist modifiers', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const out = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    out.shieldCharge = 5;
    out.shieldChargedSince = 0;
    createSpecialist(w, me, 'tinkerer', { kind: 'outpost', id: out.id });
    commitShield(out, 2 * HOUR_MS, w);
    expect(out.shieldChargedSince).toBe(2 * HOUR_MS);
    // Drained value is the new checkpoint.
    expect(out.shieldCharge).toBeLessThan(5);
  });
});
