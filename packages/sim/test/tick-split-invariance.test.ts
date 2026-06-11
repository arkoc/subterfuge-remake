import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { tick } from '../src/tick.js';
import { issueLaunchOrder } from '../src/orders.js';
import { queueLaunch } from '../src/queued-orders.js';
import { defer } from '../src/pending-commands.js';
import { createSpecialist, hasQueenAt, queenOutpostOf } from '../src/specialists.js';
import { scheduleSentry } from '../src/passives.js';
import { createRng } from '../src/rng.js';
import { DAY_MS, HOUR_MS, type World } from '../src/types.js';

/**
 * SPLIT INVARIANCE — the property the whole persistence architecture
 * rests on: `tick(w, a + b)` must produce a world bit-for-bit equal to
 * `tick(w, a); tick(w, b)` for ANY split.
 *
 * The live server advances the sim in fixed 500ms wall-clock ticks;
 * boot recovery, `/api/replay`, and the client Time Machine advance it
 * in event-gap-sized leaps. If tick were cadence-dependent, the event
 * log could no longer reproduce the live world and the "event log is
 * the source of truth" contract would silently break. Anything in
 * tick() that acts at the call boundary instead of at a sim-time
 * derived from world state (the old end-of-tick captive / funding /
 * victory sweeps) violates this property — this test is the guard.
 */

const TOTAL = 5 * DAY_MS;

/**
 * A deliberately busy world: cross-player attacks (combat, captures,
 * captive production), a Diplomat in range of the capture site
 * (event-time release), a Hypnotist (conversion race), a Sentry on a
 * 2h cadence, queued Time-Machine launches, pending (deferred) drill
 * commands, and a funding relationship whose lead decays through the
 * auto-stop threshold mid-window with no order at the crossing.
 */
function buildScenario(seed: number): World {
  const w = generateWorld({ seed, playerCount: 4 });
  const a = w.players[0]!.id;
  const b = w.players[1]!.id;
  const c = w.players[2]!.id;

  const aSrc = w.outposts.find((o) => o.ownerId === a && !hasQueenAt(w, o.id))!;
  const bSite = w.outposts.find((o) => o.ownerId === b && !hasQueenAt(w, o.id))!;
  const cSrc = w.outposts.find((o) => o.ownerId === c && !hasQueenAt(w, o.id))!;

  // --- combat + captive production: A overruns bSite where B keeps a
  // specialist; the survivor becomes A's captive at the win site.
  aSrc.drillers = 220;
  bSite.drillers = 10;
  bSite.shieldCharge = 0;
  bSite.shieldChargedSince = Number.MAX_SAFE_INTEGER;
  createSpecialist(w, b, 'helmsman', { kind: 'outpost', id: bSite.id });
  issueLaunchOrder(w, {
    ownerId: a,
    sourceId: aSrc.id,
    destinationId: bSite.id,
    drillers: 40,
  });

  // --- captive resolution race: B has a Diplomat at their Queen
  // outpost (releases B's captives within sonar); A has a Hypnotist
  // at the future capture site (converts captives held there).
  createSpecialist(w, b, 'diplomat', {
    kind: 'outpost',
    id: queenOutpostOf(w, b)!,
  });
  createSpecialist(w, a, 'hypnotist', { kind: 'outpost', id: bSite.id });

  // --- sentry attrition on a 2h cadence near C's outpost.
  const sentry = createSpecialist(w, c, 'sentry', {
    kind: 'outpost',
    id: cSrc.id,
  });
  scheduleSentry(sentry, w.time);
  // Give the sentry something to shoot at eventually: B attacks C.
  const bSrc = w.outposts.find(
    (o) => o.ownerId === b && !hasQueenAt(w, o.id) && o.id !== bSite.id,
  )!;
  bSrc.drillers = 120;
  issueLaunchOrder(w, {
    ownerId: b,
    sourceId: bSrc.id,
    destinationId: cSrc.id,
    drillers: 25,
  });

  // --- Time-Machine queue + pending command.
  queueLaunch(w, {
    executeAt: 12 * HOUR_MS,
    ownerId: a,
    sourceId: aSrc.id,
    destinationId: bSite.id,
    drillers: 15,
  });
  cSrc.drillers = 150;
  defer(w, {
    issuedAt: w.time,
    command: { kind: 'drill', ownerId: c, outpostId: cSrc.id },
  });

  // --- live Neptunium accrual mid-window: A owns a mine, so kg
  // accumulates continuously between events and the analytic victory
  // crossing has a live rate to work against. (This block previously
  // also exercised funding auto-stop; funding was removed — see
  // docs/21_contracts_and_drowned_queen_plan.md.)
  w.players[2]!.neptuniumMg = 50_000;
  w.players[2]!.neptuniumLastAt = w.time;
  w.players[0]!.neptuniumMg = 25_000;
  w.players[0]!.neptuniumLastAt = w.time;
  const aMineSite = w.outposts.find(
    (o) => o.ownerId === a && !hasQueenAt(w, o.id) && o.id !== aSrc.id,
  )!;
  aMineSite.kind = 'mine';

  return w;
}

function splitsFor(total: number): { name: string; steps: number[] }[] {
  const halves = [total / 2, total / 2];
  const lopsided = [1, total - 1];
  const hourly: number[] = [];
  for (let t = 0; t < total; t += HOUR_MS) {
    hourly.push(Math.min(HOUR_MS, total - t));
  }
  // The live server's cadence at SIM_SPEED=1000: 500ms real = 500s sim.
  const liveCadence: number[] = [];
  for (let t = 0; t < total; t += 500_000) {
    liveCadence.push(Math.min(500_000, total - t));
  }
  // Deterministic "random" splits via the sim's own PRNG.
  const rng = createRng(0xc0ffee);
  const random: number[] = [];
  let acc = 0;
  while (acc < total) {
    const step = Math.min(rng.range(1, 6 * HOUR_MS), total - acc);
    random.push(step);
    acc += step;
  }
  return [
    { name: 'two halves', steps: halves },
    { name: '1ms then rest', steps: lopsided },
    { name: 'hourly', steps: hourly },
    { name: 'live 500s cadence', steps: liveCadence },
    { name: 'random steps', steps: random },
  ];
}

/**
 * Walk `steps` incrementally and, at ~`checks` evenly-spaced prefix
 * boundaries (plus the final one), compare the stepped world against a
 * fresh scenario advanced in ONE tick to the same sim time.
 *
 * Comparing intermediate states matters: a cadence-dependent bug (e.g.
 * a tick-boundary sweep flipping a funding flag early) can transiently
 * diverge and then reconverge by the end of the window — a final-state
 * check alone misses it.
 */
function expectPrefixInvariance(
  seed: number,
  name: string,
  steps: readonly number[],
  checks = 12,
): void {
  const stepped = buildScenario(seed);
  const every = Math.max(1, Math.floor(steps.length / checks));
  let acc = 0;
  for (let i = 0; i < steps.length; i++) {
    tick(stepped, steps[i]!);
    acc += steps[i]!;
    if (i % every === 0 || i === steps.length - 1) {
      const whole = buildScenario(seed);
      tick(whole, acc);
      expect(stepped, `split "${name}" diverged at t=${acc}`).toStrictEqual(
        whole,
      );
    }
  }
}

describe('tick split invariance (event-sourcing keystone)', () => {
  for (const seed of [7, 42]) {
    it(`seed ${seed}: every split matches the single-leap world at every checkpoint`, () => {
      for (const split of splitsFor(TOTAL)) {
        const sum = split.steps.reduce((s, x) => s + x, 0);
        expect(sum).toBe(TOTAL); // guard the test itself
        expectPrefixInvariance(seed, split.name, split.steps);
      }
    });
  }

  it('a Neptunium victory crossing between events freezes identically across splits', () => {
    const build = (): World => {
      const w = generateWorld({ seed: 11, playerCount: 4 });
      const p = w.players[0]!;
      // 190kg banked; one mine × N outposts gives a rate that crosses
      // 200kg mid-window, far from any scheduled event.
      p.neptuniumMg = 190_000;
      p.neptuniumLastAt = w.time;
      const site = w.outposts.find(
        (o) => o.ownerId === p.id && !hasQueenAt(w, o.id),
      )!;
      site.kind = 'mine';
      return w;
    };
    const whole = build();
    tick(whole, TOTAL);
    expect(whole.winnerId).toBe(build().players[0]!.id);

    const rng = createRng(0xbeef);
    const stepped = build();
    let acc = 0;
    while (acc < TOTAL) {
      const step = Math.min(rng.range(1, 9 * HOUR_MS), TOTAL - acc);
      tick(stepped, step);
      acc += step;
    }
    expect(stepped).toStrictEqual(whole);
  });
});
