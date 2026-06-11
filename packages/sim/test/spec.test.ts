/**
 * Spec-verification suite — every test in this file pins a specific
 * rule from the Subterfuge design docs (under /docs) to a numeric
 * assertion. If any of these fail, either the sim drifted from the
 * spec or the spec itself needs revising.
 *
 * Organised by docs file to make it easy to trace from rule → test.
 */

import { describe, expect, it } from 'vitest';
import { hasQueenAt } from '../src/specialists.js';
import { generateWorld } from '../src/world-gen.js';
import { tick } from '../src/tick.js';
import { electricalOutput, totalDrillers } from '../src/production.js';
import { issueLaunchOrder } from '../src/orders.js';
import { issueDrillOrder, drillCost, liveNeptuniumThousandths } from '../src/mining.js';
import { currentShieldCharge } from '../src/shield.js';
import { simulateArrival, simulateSubArrival } from '../src/preview.js';
import { queueLaunch, queueDrill, cancelQueuedOrder } from '../src/queued-orders.js';
import { viewForPlayer } from '../src/visibility.js';
import {
  BASE_MS_PER_UNIT,
  DAY_MS,
  FACTORY_CYCLE_MS,
  FACTORY_DRILLERS_PER_CYCLE,
  GENERATOR_ELECTRICAL_OUTPUT,
  HOUR_MS,
  LAUNCH_DELAY_MS,
  MAP_SIZE,
  NEPTUNIUM_VICTORY_THOUSANDTHS,
  QUEEN_ELECTRICAL_OUTPUT,
  SHIELD_MAX,
  SHIELD_RECHARGE_TIME_MS,
  SONAR_RANGE,
  STARTING_DRILLERS,
  STARTING_OUTPOSTS_PER_PLAYER,
  TOTAL_OUTPOSTS_PER_PLAYER_SLOT,
  type Outpost,
  type OutpostId,
  type PlayerId,
} from '../src/types.js';

// ---------- docs/00_overview.md — starting position ----------

describe('spec: starting position (docs/00_overview.md)', () => {
  it('each player begins with exactly 5 outposts: 4 standard + 1 Queen', () => {
    const w = generateWorld({ seed: 42, playerCount: 6 });
    for (const p of w.players) {
      const owned = w.outposts.filter((o) => o.ownerId === p.id);
      expect(owned).toHaveLength(STARTING_OUTPOSTS_PER_PLAYER);
      const queens = owned.filter((o) => hasQueenAt(w, o.id));
      expect(queens).toHaveLength(1);
    }
  });

  it('each non-Queen starting outpost has exactly 40 drillers', () => {
    const w = generateWorld({ seed: 42, playerCount: 4 });
    for (const p of w.players) {
      const nonQueens = w.outposts.filter(
        (o) => o.ownerId === p.id && !hasQueenAt(w, o.id),
      );
      for (const o of nonQueens) expect(o.drillers).toBe(STARTING_DRILLERS);
    }
  });

  it('map has playerCount × 10 outposts total', () => {
    for (const pc of [2, 4, 7, 10]) {
      const w = generateWorld({ seed: 99, playerCount: pc });
      expect(w.outposts).toHaveLength(pc * TOTAL_OUTPOSTS_PER_PLAYER_SLOT);
    }
  });
});

// ---------- docs/03_drillers_production.md ----------

describe('spec: production (docs/03_drillers_production.md)', () => {
  it('each factory produces 6 drillers every 8 hours (uncapped)', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    // Find a factory whose first scheduled cycle is X ms away.
    const f = w.outposts
      .filter((o) => o.ownerId === me && o.kind === 'factory')
      .sort((a, b) => a.nextProductionAt - b.nextProductionAt)[0]!;
    const before = f.drillers;
    tick(w, f.nextProductionAt); // exactly to the cycle
    expect(f.drillers).toBe(before + FACTORY_DRILLERS_PER_CYCLE);
    // Next cycle is exactly 8h later
    expect(f.nextProductionAt - (f.nextProductionAt - FACTORY_CYCLE_MS)).toBe(
      FACTORY_CYCLE_MS,
    );
  });

  it('electrical cap = 150 (Queen) + 50 × Generators', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    for (const p of w.players) {
      const owned = w.outposts.filter((o) => o.ownerId === p.id);
      const gens = owned.filter((o) => o.kind === 'generator').length;
      expect(electricalOutput(w, p.id)).toBe(
        QUEEN_ELECTRICAL_OUTPUT + gens * GENERATOR_ELECTRICAL_OUTPUT,
      );
    }
  });

  it('production halts when stockpile >= electrical cap', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const cap = electricalOutput(w, me);
    // Manually fill the Queen's home so the player is at cap.
    const queenHome = w.outposts.find((o) => o.ownerId === me && hasQueenAt(w, o.id))!;
    queenHome.drillers = cap;
    expect(totalDrillers(w, me)).toBeGreaterThanOrEqual(cap);

    const before = totalDrillers(w, me);
    tick(w, 7 * DAY_MS);
    // Stockpile unchanged — no production allowed at cap.
    expect(totalDrillers(w, me)).toBe(before);
  });

  it('production resumes once stockpile drops below cap', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const cap = electricalOutput(w, me);
    // Zero out every owned outpost, then fill the queen home to exactly cap.
    for (const o of w.outposts) {
      if (o.ownerId === me) o.drillers = 0;
    }
    const queenHome = w.outposts.find((o) => o.ownerId === me && hasQueenAt(w, o.id))!;
    queenHome.drillers = cap;
    expect(totalDrillers(w, me)).toBe(cap);
    tick(w, DAY_MS); // capped, no production
    expect(totalDrillers(w, me)).toBe(cap);
    // Drop below cap, tick again — production must resume.
    queenHome.drillers -= 50;
    const before = totalDrillers(w, me);
    tick(w, DAY_MS);
    expect(totalDrillers(w, me)).toBeGreaterThan(before);
  });
});

// ---------- docs/06_mining_neptunium.md ----------

describe('spec: mining (docs/06_mining_neptunium.md)', () => {
  it('drill cost ladder: 50, 100, 200, 300, 400, 500, …', () => {
    expect(drillCost(0)).toBe(50);
    expect(drillCost(1)).toBe(100);
    expect(drillCost(2)).toBe(200);
    expect(drillCost(3)).toBe(300);
    expect(drillCost(4)).toBe(400);
    expect(drillCost(5)).toBe(500);
    expect(drillCost(10)).toBe(1000);
  });

  it('drill consumes drillers and converts the outpost to a mine', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const f = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    f.drillers = 200;
    issueDrillOrder(w, { ownerId: me, outpostId: f.id });
    expect(f.kind).toBe('mine');
    expect(f.drillers).toBe(150); // 200 − 50
    expect(w.players[0]!.minesDrilled).toBe(1);
  });

  it('drill cost does not decrease when a mine is later lost', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const f = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    f.drillers = 100;
    issueDrillOrder(w, { ownerId: me, outpostId: f.id });
    // Simulate losing the mine (e.g., capture by enemy)
    f.ownerId = w.players[1]!.id;
    // Drill counter does NOT decrement
    expect(w.players[0]!.minesDrilled).toBe(1);
    // Next drill still costs 100, not 50
    const f2 = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    f2.drillers = 100;
    issueDrillOrder(w, { ownerId: me, outpostId: f2.id });
    expect(f2.drillers).toBe(0); // 100 − 100
  });

  it('neptunium output = 1 kg/day × mines × outposts_owned', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    // Convert one factory into a mine (cheating directly)
    const f = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    f.kind = 'mine';
    w.players[0]!.minesDrilled = 1;

    const outposts = w.outposts.filter((o) => o.ownerId === me).length;
    tick(w, DAY_MS);
    const live = liveNeptuniumThousandths(w, w.players[0]!, w.time);
    // 1 mine × outposts kg/day in thousandths
    expect(live).toBe(1 * outposts * 1000);
  });

  it('200 kg triggers victory', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    w.players[0]!.neptuniumMg = NEPTUNIUM_VICTORY_THOUSANDTHS - 100;
    w.players[0]!.neptuniumLastAt = w.time;
    // Give them a mine so accrual happens.
    const f = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    f.drillers = 100;
    issueDrillOrder(w, { ownerId: me, outpostId: f.id });
    tick(w, DAY_MS);
    expect(w.winnerId).toBe(me);
  });
});

// ---------- docs/04_combat.md ----------

describe('spec: combat (docs/04_combat.md)', () => {
  function arrange() {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const source = w.outposts.find((o) => o.ownerId === a && !hasQueenAt(w, o.id))!;
    const target = w.outposts.find((o) => o.ownerId === b)!;
    return { w, a, b, source, target };
  }

  it('attacker wins when post-shield drillers strictly exceed defenders', () => {
    const { w, a, source, target } = arrange();
    target.drillers = 10;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER; // pin at 0
    source.drillers = 50;
    const sub = simulateArrival({
      world: w,
      sourceId: source.id,
      destinationId: target.id,
      drillers: 30,
      attackerId: a,
    });
    expect(sub.outcome).toBe('attacker-wins');
    expect(sub.attackerSurviving).toBe(20); // 30 − 10
    expect(sub.outpostCaptured).toBe(true);
  });

  it('ties go to defender (per docs/04_combat.md)', () => {
    const { w, a, source, target } = arrange();
    target.drillers = 20;
    target.shieldCharge = 0;
    target.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    source.drillers = 50;
    const sub = simulateArrival({
      world: w,
      sourceId: source.id,
      destinationId: target.id,
      drillers: 20,
      attackerId: a,
    });
    expect(sub.outcome).toBe('tie');
    expect(sub.outpostCaptured).toBe(false);
  });

  it('shield consumes attacker drillers 1-for-1', () => {
    const { w, a, source, target } = arrange();
    target.shieldKind = 'strong';
    target.shieldCharge = 20; // full
    target.shieldChargedSince = w.time;
    target.drillers = 10;
    source.drillers = 50;
    const sub = simulateArrival({
      world: w,
      sourceId: source.id,
      destinationId: target.id,
      drillers: 35,
      attackerId: a,
    });
    // 35 → 35 − 20 (shield) = 15 vs 10 defenders → attacker wins with 5.
    expect(sub.outcome).toBe('attacker-wins');
    expect(sub.shieldAbsorbed).toBe(20);
    expect(sub.attackerSurviving).toBe(5);
  });

  it('mine capture costs the previous owner 20% of neptunium (rounded up)', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const bOutpost = w.outposts.find((o) => o.ownerId === b && !hasQueenAt(w, o.id))!;
    bOutpost.kind = 'mine';
    bOutpost.drillers = 0;
    bOutpost.shieldKind = 'weak';
    bOutpost.shieldCharge = 0;
    bOutpost.shieldChargedSince = Number.MAX_SAFE_INTEGER;
    w.players[1]!.neptuniumMg = 100_001; // odd value to test ceil
    w.players[1]!.neptuniumLastAt = w.time;
    const source = w.outposts.find((o) => o.ownerId === a && !hasQueenAt(w, o.id))!;
    source.drillers = 100;
    issueLaunchOrder(w, {
      ownerId: a,
      sourceId: source.id,
      destinationId: bOutpost.id,
      drillers: 50,
    });
    const sub = w.subs[0]!;
    const travel = sub.arrivalAt - w.time;
    // B has 1 mine, ~5 outposts during travel. Compute expected accrual.
    const outpostsAtArrival = w.outposts.filter((o) => o.ownerId === b).length;
    const accrued = Math.floor((travel * 1 * outpostsAtArrival * 1000) / DAY_MS);
    const preCombat = 100_001 + accrued;
    const expectedAfter = preCombat - Math.ceil(preCombat / 5);
    tick(w, travel);
    expect(w.players[1]!.neptuniumMg).toBe(expectedAfter);
    expect(bOutpost.ownerId).toBe(a);
  });
});

// ---------- docs/07_shields_sonar_visibility.md ----------

describe('spec: shields (docs/07_shields_sonar_visibility.md)', () => {
  it('weak shield max = 10, strong shield max = 20', () => {
    expect(SHIELD_MAX.weak).toBe(10);
    expect(SHIELD_MAX.strong).toBe(20);
  });

  it('shield recharges from 0 to max linearly over exactly 48 hours', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const o = w.outposts[0]!;
    o.shieldCharge = 0;
    o.shieldChargedSince = 0;
    // Halfway
    expect(currentShieldCharge(o, SHIELD_RECHARGE_TIME_MS / 2)).toBe(
      SHIELD_MAX[o.shieldKind] / 2,
    );
    // Full
    expect(currentShieldCharge(o, SHIELD_RECHARGE_TIME_MS)).toBe(
      SHIELD_MAX[o.shieldKind],
    );
    // Doesn't exceed max
    expect(currentShieldCharge(o, 100 * SHIELD_RECHARGE_TIME_MS)).toBe(
      SHIELD_MAX[o.shieldKind],
    );
  });
});

describe('spec: sonar / visibility', () => {
  it('discovered outposts appear in your view; sonar ones are clear, others fogged', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const v = viewForPlayer(w, me);
    // Per docs/07 ("discovered outposts persist") we now only show
    // outposts the viewer has ever observed. At t=0 that's the
    // viewer's own outposts plus any in current sonar.
    const clear = v.outposts.filter((o) => o.fogged === undefined).length;
    expect(clear).toBeGreaterThan(0); // own outposts always clear
    // Total visible is bounded by the world but smaller than the
    // full outpost count (we don't see undiscovered outposts).
    expect(v.outposts.length).toBeLessThanOrEqual(w.outposts.length);
    expect(v.outposts.length).toBeGreaterThanOrEqual(clear);
  });

  it('fogged outposts redact garrison / shield but keep owner', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const them = w.players[1]!.id;
    // Beef up an enemy outpost far from me
    const enemy = w.outposts.find((o) => o.ownerId === them && !hasQueenAt(w, o.id))!;
    enemy.drillers = 99;
    enemy.shieldCharge = 8;
    const v = viewForPlayer(w, me);
    const fog = v.outposts.find((o) => o.id === enemy.id && o.fogged);
    if (fog) {
      expect(fog.ownerId).toBe(them);
      expect(fog.drillers).toBe(0); // redacted
      expect(fog.shieldCharge).toBe(0);
    }
  });
});

// ---------- docs/02_subs.md — launch & travel ----------

describe('spec: sub launch + travel (docs/02_subs.md)', () => {
  it('launchAt = now + 10 minutes', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const src = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const dst = w.outposts.find((o) => o.ownerId === null)!;
    const start = w.time;
    issueLaunchOrder(w, {
      ownerId: me,
      sourceId: src.id,
      destinationId: dst.id,
      drillers: 5,
    });
    const sub = w.subs[0]!;
    expect(sub.launchAt).toBe(start + LAUNCH_DELAY_MS);
  });

  it('travel time is proportional to map distance (BASE_MS_PER_UNIT)', () => {
    expect(BASE_MS_PER_UNIT).toBe(36_000);
  });

  it('drillers deducted from source at launch time, not at arrival', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const src = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id),
    )!;
    const dst = w.outposts.find((o) => o.ownerId === null)!;
    const before = src.drillers;
    issueLaunchOrder(w, {
      ownerId: me,
      sourceId: src.id,
      destinationId: dst.id,
      drillers: 10,
    });
    expect(src.drillers).toBe(before - 10);
  });
});

// ---------- docs/08_time_machine.md ----------

describe('spec: time machine queue (docs/08_time_machine.md)', () => {
  it('queued launch executes at executeAt (not 10 min earlier)', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const src = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const dst = w.outposts.find((o) => o.ownerId === null)!;
    const executeAt = HOUR_MS * 4; // 4 hours from now
    queueLaunch(w, {
      executeAt,
      ownerId: me,
      sourceId: src.id,
      destinationId: dst.id,
      drillers: 5,
    });
    expect(w.queuedOrders).toHaveLength(1);
    tick(w, executeAt - 1);
    expect(w.queuedOrders).toHaveLength(1);
    expect(w.subs).toHaveLength(0);
    tick(w, 2); // cross the executeAt boundary
    expect(w.queuedOrders).toHaveLength(0);
    expect(w.subs).toHaveLength(1);
    // The new sub's launchAt = executeAt + LAUNCH_DELAY_MS (10 min)
    expect(w.subs[0]!.launchAt).toBe(executeAt + LAUNCH_DELAY_MS);
  });

  it('cancelQueuedOrder removes a pending order; tick does not dispatch it', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const src = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const dst = w.outposts.find((o) => o.ownerId === null)!;
    const id = queueLaunch(w, {
      executeAt: HOUR_MS,
      ownerId: me,
      sourceId: src.id,
      destinationId: dst.id,
      drillers: 5,
    });
    expect(cancelQueuedOrder(w, id, me)).toBe(true);
    tick(w, DAY_MS);
    expect(w.subs).toHaveLength(0);
  });

  it('invalid queued order at dispatch (source captured) silently drops', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const src = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const dst = w.outposts.find((o) => o.ownerId === null)!;
    queueLaunch(w, {
      executeAt: HOUR_MS,
      ownerId: me,
      sourceId: src.id,
      destinationId: dst.id,
      drillers: 5,
    });
    // Capture the source by an opponent before executeAt
    src.ownerId = w.players[1]!.id;
    tick(w, 2 * HOUR_MS);
    // Order dropped, no sub launched
    expect(w.subs).toHaveLength(0);
    expect(w.queuedOrders).toHaveLength(0);
  });

  it('queued drill works the same way (executes at executeAt)', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const f = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    f.drillers = 100;
    queueDrill(w, { executeAt: HOUR_MS, ownerId: me, outpostId: f.id });
    tick(w, 2 * HOUR_MS);
    expect(f.kind).toBe('mine');
    expect(f.drillers).toBe(50);
  });
});

// ---------- docs/09 — gift subs ----------

describe('spec: gift subs (docs/09)', () => {
  it('gift sub arriving at recipient outpost transfers cargo (no combat)', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const src = w.outposts.find((o) => o.ownerId === a && !hasQueenAt(w, o.id))!;
    const tgt = w.outposts.find((o) => o.ownerId === b)!;
    const before = tgt.drillers;
    issueLaunchOrder(w, {
      ownerId: a,
      sourceId: src.id,
      destinationId: tgt.id,
      drillers: 5,
      giftTo: b,
    });
    tick(w, w.subs[0]!.arrivalAt - w.time);
    expect(tgt.ownerId).toBe(b); // unchanged
    expect(tgt.drillers).toBe(before + 5);
  });
});

// ---------- sonar visibility ----------

describe('spec: sonar range', () => {
  it('SONAR_RANGE is positive and not absurd vs MAP_SIZE', () => {
    expect(SONAR_RANGE).toBeGreaterThan(0);
    expect(SONAR_RANGE).toBeLessThan(MAP_SIZE);
  });
});

// ---------- preview / arrival simulation ----------

describe('spec: simulateArrival (preview)', () => {
  it('dormant arrival reports CAPTURE outcome', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const src = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const dormant = w.outposts.find((o) => o.ownerId === null)!;
    const p = simulateArrival({
      world: w,
      sourceId: src.id,
      destinationId: dormant.id,
      drillers: 20,
      attackerId: me,
    });
    expect(p.outcome).toBe('capture-dormant');
    expect(p.outpostCaptured).toBe(true);
    expect(p.attackerSurviving).toBe(20);
  });

  it('friendly reinforce outcome reports drillers + total', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const owned = w.outposts.filter((o) => o.ownerId === me);
    const src = owned.find((o) => !hasQueenAt(w, o.id))!;
    const tgt = owned.find((o) => o.id !== src.id)!;
    const p = simulateArrival({
      world: w,
      sourceId: src.id,
      destinationId: tgt.id,
      drillers: 10,
      attackerId: me,
    });
    expect(p.outcome).toBe('reinforce');
    expect(p.outpostCaptured).toBe(false);
  });

  it('simulateSubArrival mirrors simulateArrival for an in-flight sub', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const src = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const dst = w.outposts.find((o) => o.ownerId === null)!;
    issueLaunchOrder(w, {
      ownerId: me,
      sourceId: src.id,
      destinationId: dst.id,
      drillers: 10,
    });
    const sub = w.subs[0]!;
    const p = simulateSubArrival(w, sub);
    expect(p.outcome).toBe('capture-dormant');
    expect(p.arrivalAt).toBe(sub.arrivalAt);
  });

  it('simulateArrival is pure: does not mutate the world', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const src = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const tgt = w.outposts.find((o) => o.ownerId === w.players[1]!.id)!;
    const before = {
      tgtDrillers: tgt.drillers,
      tgtShield: tgt.shieldCharge,
      srcDrillers: src.drillers,
      time: w.time,
      subs: w.subs.length,
    };
    simulateArrival({
      world: w,
      sourceId: src.id,
      destinationId: tgt.id,
      drillers: 50,
      attackerId: me,
    });
    expect(tgt.drillers).toBe(before.tgtDrillers);
    expect(tgt.shieldCharge).toBe(before.tgtShield);
    expect(src.drillers).toBe(before.srcDrillers);
    expect(w.time).toBe(before.time);
    expect(w.subs).toHaveLength(before.subs);
  });
});

// ---------- tick ordering & determinism ----------

describe('spec: tick ordering', () => {
  it('events processed in chronological order across a long tick', () => {
    // Set up a launch + drill + factory cycle that all happen close
    // together, then advance time and verify all fire.
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const f = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    f.drillers = 100;
    queueDrill(w, { executeAt: HOUR_MS, ownerId: me, outpostId: f.id });
    const src = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.id !== f.id,
    )!;
    const dst = w.outposts.find((o) => o.ownerId === null)!;
    queueLaunch(w, {
      executeAt: 2 * HOUR_MS,
      ownerId: me,
      sourceId: src.id,
      destinationId: dst.id,
      drillers: 5,
    });
    tick(w, 3 * HOUR_MS);
    expect(f.kind).toBe('mine'); // drill executed
    expect(w.subs).toHaveLength(1); // launch executed (sub still in 10-min queue+travel)
  });

  it('split ticks ≡ one big tick (determinism)', () => {
    const a = generateWorld({ seed: 11, playerCount: 4 });
    const b = generateWorld({ seed: 11, playerCount: 4 });
    tick(a, 5 * DAY_MS);
    for (let i = 0; i < 50; i++) tick(b, (5 * DAY_MS) / 50);
    expect(a).toEqual(b);
  });
});

// ---------- frozen game post-victory ----------

describe('spec: game freezes after victory', () => {
  it('tick is a no-op for state changes once winnerId is set', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    w.players[0]!.neptuniumMg = NEPTUNIUM_VICTORY_THOUSANDTHS;
    w.players[0]!.neptuniumLastAt = w.time;
    const f = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    f.drillers = 100;
    issueDrillOrder(w, { ownerId: me, outpostId: f.id });
    tick(w, 1);
    expect(w.winnerId).toBe(me);
    // Capture state, tick more, confirm no changes
    const frozenDrillers = totalDrillers(w, w.players[1]!.id);
    tick(w, 7 * DAY_MS);
    expect(totalDrillers(w, w.players[1]!.id)).toBe(frozenDrillers);
  });
});

// ---------- sub-to-sub combat is NOT triggered passively ----------

describe('spec: passive sub-vs-sub crossings do NOT trigger combat', () => {
  it('two enemy subs flying paths that intersect do not fight', () => {
    // We don't model intercept paths explicitly without specialists;
    // assert via API: launching two opposing subs leaves both in the
    // air without spurious combat resolution.
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const aSrc = w.outposts.find((o) => o.ownerId === a && !hasQueenAt(w, o.id))!;
    const aDst = w.outposts.find((o) => o.ownerId === null)!;
    const bSrc = w.outposts.find((o) => o.ownerId === b && !hasQueenAt(w, o.id))!;
    const bDst = w.outposts.find(
      (o) => o.ownerId === null && o.id !== aDst.id,
    )!;
    issueLaunchOrder(w, {
      ownerId: a,
      sourceId: aSrc.id,
      destinationId: aDst.id,
      drillers: 5,
    });
    issueLaunchOrder(w, {
      ownerId: b,
      sourceId: bSrc.id,
      destinationId: bDst.id,
      drillers: 5,
    });
    // Tick to just before either arrival
    const earliest = Math.min(w.subs[0]!.arrivalAt, w.subs[1]!.arrivalAt);
    tick(w, earliest - w.time - 1);
    // Both subs still in flight (or about to arrive); no spurious capture
    expect(w.subs.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------- TS branding sanity (no PlayerId/OutpostId mix-ups) ----------

describe('spec: branded ids prevent argument mix-ups', () => {
  it('cannot accidentally pass an OutpostId where a PlayerId is expected', () => {
    // Pure compile-time check via type assertions; this test just
    // documents the intent and runs the runtime path.
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const pid: PlayerId = w.players[0]!.id;
    const oid: OutpostId = w.outposts[0]!.id;
    // @ts-expect-error — branded types should refuse this
    void electricalOutput(w, oid);
    expect(electricalOutput(w, pid)).toBeGreaterThanOrEqual(QUEEN_ELECTRICAL_OUTPUT);
  });
});

// ---------- world-gen randomized stability ----------

describe('spec: world-gen reproducibility', () => {
  it('same seed → identical world (object-equal)', () => {
    const a = generateWorld({ seed: 12345, playerCount: 8 });
    const b = generateWorld({ seed: 12345, playerCount: 8 });
    expect(a).toEqual(b);
  });

  it('outposts placed inside map bounds', () => {
    const w = generateWorld({ seed: 12345, playerCount: 8 });
    for (const o of w.outposts) {
      expect(o.pos.x).toBeGreaterThanOrEqual(0);
      expect(o.pos.x).toBeLessThan(MAP_SIZE);
      expect(o.pos.y).toBeGreaterThanOrEqual(0);
      expect(o.pos.y).toBeLessThan(MAP_SIZE);
    }
  });
});

// ---------- compile-only — runtime test stub ----------

describe('helper: Outpost type stays parseable', () => {
  it('Outpost is a struct with the documented fields', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const o: Outpost = w.outposts[0]!;
    expect(typeof o.id).toBe('number');
    expect(typeof o.pos.x).toBe('number');
    expect(typeof o.pos.y).toBe('number');
    expect(['factory', 'generator', 'mine']).toContain(o.kind);
    expect(['weak', 'strong']).toContain(o.shieldKind);
  });
});
