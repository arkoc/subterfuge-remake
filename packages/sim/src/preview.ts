import type {
  Outpost,
  OutpostId,
  PlayerId,
  Specialist,
  SpecialistId,
  SpecialistKind,
  Sub,
  SubId,
  World,
} from './types.js';
import { LAUNCH_DELAY_MS } from './types.js';
import { tick } from './tick.js';
import { currentShieldCharge } from './shield.js';
import { mirrorEncounterTime } from './combat.js';
import { effectiveSpeed, travelTimeBetween } from './subs.js';
import { outpostById } from './queries.js';

// structuredClone is a WhatWG global available on Node 17+ and modern
// browsers. Declared here because the sim's build lib is `ES2022`
// which doesn't include the DOM/Worker typings (and adding DOM would
// pollute the pure-sim contract).
declare const structuredClone: <T>(value: T) => T;

/**
 * Pure "what would happen if I launched this sub right now?" calculation.
 *
 * Strategy: clone the world, inject the launched sub (or keep the
 * in-flight sub), tick the clone past arrivalAt. The arrival fires
 * through the *real* combat path (`arriveSub` → `resolveCombat`), so
 * specialists, multi-phase resolution, captures, captives, mining
 * penalty etc. all participate. Then we read the outcome from the
 * post-tick outpost state + emitted `combat_outpost` event.
 *
 * The client renders the result in the launch sheet as a combat
 * preview. The server also calls this if it needs to validate a
 * preview before showing it to the player (Phase 8 onwards).
 */
export type ArrivalOutcome =
  | 'capture-dormant'
  | 'reinforce'
  | 'gift'
  | 'attacker-wins'
  | 'defender-wins'
  | 'tie';

/**
 * Per-specialist outcome of a projected combat. Derived by diffing
 * the cloned world's `specialists` list before and after the
 * arrival tick fires.
 *
 * - `attackerKilled` / `defenderKilled`: specialist ids removed
 *   from `world.specialists` (Phase-1 Assassin kills, Martyr blast,
 *   etc.)
 * - `attackerCaptured` / `defenderCaptured`: specialists whose
 *   `state` flipped to `'captive'` (combat losers always become
 *   captives of the winner). The `attackerCaptured` list is the
 *   specialists *the attacker took from the defender* (i.e. the
 *   defender's specialists now held captive by the attacker), and
 *   vice versa.
 *
 * Each entry carries the specialist kind so the UI can render
 * "your Assassin · their Sentry, Foreman" without further lookup.
 */
export interface SpecialistOutcome {
  readonly kind: SpecialistKind;
  readonly id: number;
}

export interface ArrivalPreview {
  /** Sim time at which the sub will arrive. */
  arrivalAt: number;
  /** Travel duration (excludes the 10-min launch delay). */
  travelMs: number;
  /** Sim time at launch (now + 10 min). */
  launchAt: number;
  /** Drillers in the sub. */
  attackerDrillers: number;
  /** Defender drillers at arrival (projected, may differ from now). */
  defenderDrillersAtArrival: number;
  /** Shield charge at arrival (projected). */
  shieldAtArrival: number;
  /** Drillers consumed by the shield in combat. */
  shieldAbsorbed: number;
  /** Drillers each side has after combat resolves. */
  attackerSurviving: number;
  defenderSurviving: number;
  /** Whether the outpost changes hands. */
  outpostCaptured: boolean;
  /** High-level outcome the UI can render directly. */
  outcome: ArrivalOutcome;
  /** Specialist-level breakdown (empty arrays for non-combat outcomes). */
  attackerKilled: readonly SpecialistOutcome[];
  attackerCaptured: readonly SpecialistOutcome[];
  defenderKilled: readonly SpecialistOutcome[];
  defenderCaptured: readonly SpecialistOutcome[];
}

export interface SimulateArrivalInput {
  readonly world: World;
  readonly sourceId: OutpostId;
  readonly destinationId: OutpostId;
  readonly drillers: number;
  readonly attackerId: PlayerId;
  readonly giftTo?: PlayerId;
  /** Specialists to load (defaults to none). Used for speed
   *  calculation and combat-priority effects in the preview. */
  readonly specialistIds?: readonly SpecialistId[];
}

export function simulateArrival(input: SimulateArrivalInput): ArrivalPreview {
  const { world, sourceId, destinationId, drillers, attackerId, giftTo, specialistIds } = input;

  const projected = structuredClone(world) as World;
  const projSource = outpostById(projected, sourceId);
  const projDest = outpostById(projected, destinationId);
  const launchAt = projected.time + LAUNCH_DELAY_MS;
  // Build the synthetic sub. We allocate using the projected world's
  // next-sub-id counter so the sub is well-formed; this never
  // mutates the caller's world because `projected` is a deep clone.
  const subId = projected.nextSubId as unknown as SubId;
  projected.nextSubId += 1;
  const synth: Sub = {
    id: subId,
    ownerId: attackerId,
    sourceId,
    destinationId,
    launchAt,
    arrivalAt: launchAt, // placeholder, filled below after speed math
    drillers,
    speedMultiplier: 1,
    ...(giftTo !== undefined ? { giftTo } : {}),
  };
  // Move requested specialists onto the synthetic sub (preview math
  // needs cargo on the sub for speed + combat).
  if (specialistIds !== undefined) {
    for (const sid of specialistIds) {
      const s = projected.specialists.find(
        (x) => (x.id as unknown as number) === (sid as unknown as number),
      );
      if (s === undefined) continue;
      if (s.ownerId !== attackerId || s.state !== 'active') continue;
      if (s.location.kind !== 'outpost' || s.location.id !== sourceId) continue;
      s.location = { kind: 'sub', id: subId };
    }
  }
  // Speed depends on cargo; compute on the projected world.
  synth.speedMultiplier = effectiveSpeed(projected, synth);
  const travelMs = travelTimeBetween(projSource, projDest, synth.speedMultiplier);
  synth.arrivalAt = launchAt + travelMs;
  projected.subs.push(synth);

  return runAndDiff(projected, destinationId, attackerId, drillers, synth.arrivalAt, launchAt, travelMs, giftTo);
}

/**
 * Combat preview for a sub that's **already in flight**. Re-uses the
 * sub's existing `launchAt` / `arrivalAt` (so the preview reflects
 * its actual time-of-arrival, not a fresh-launch projection).
 */
export function simulateSubArrival(world: World, sub: Sub): ArrivalPreview {
  const projected = structuredClone(world) as World;
  // The sub is already in projected.subs (deep-cloned). Tick will fire
  // its arrival naturally.
  const travelMs = sub.arrivalAt - sub.launchAt;
  return runAndDiff(
    projected,
    sub.destinationId,
    sub.ownerId,
    sub.drillers,
    sub.arrivalAt,
    sub.launchAt,
    travelMs,
    sub.giftTo,
  );
}

/**
 * Batched arrival preview. Projects MANY in-flight subs in a single
 * cloned world by ticking through arrivals in chronological order
 * and reading the post-tick outcome per sub.
 *
 * Each sub's `id` in the returned map points to its `ArrivalPreview`.
 * Subs that throw mid-projection (transitional state) are silently
 * skipped.
 *
 * This replaces N × `simulateSubArrival(world, sub)` calls — each of
 * which does its own `structuredClone(world)` — with one shared
 * clone. On the client's will-lose refresh path that's the single
 * biggest GC pressure source.
 */
export function simulateMultipleSubArrivals(
  world: World,
  subs: readonly Sub[],
): Map<number, ArrivalPreview> {
  const out = new Map<number, ArrivalPreview>();
  if (subs.length === 0) return out;
  const projected = structuredClone(world) as World;
  // Sort a local copy so we don't mutate the caller's order.
  const ordered = [...subs].sort((a, b) => a.arrivalAt - b.arrivalAt);
  for (const sub of ordered) {
    // Find the cloned-world counterpart by id (structuredClone gives
    // us distinct objects).
    const subId = sub.id as unknown as number;
    const cloneSub = projected.subs.find(
      (s) => (s.id as unknown as number) === subId,
    );
    if (cloneSub === undefined) continue; // already arrived & consumed
    try {
      const travelMs = cloneSub.arrivalAt - cloneSub.launchAt;
      const preview = runAndDiff(
        projected,
        cloneSub.destinationId,
        cloneSub.ownerId,
        cloneSub.drillers,
        cloneSub.arrivalAt,
        cloneSub.launchAt,
        travelMs,
        cloneSub.giftTo,
      );
      out.set(subId, preview);
    } catch {
      // ignore transitional states
    }
  }
  return out;
}

/**
 * Projected outcome of an upcoming sub-vs-sub mirror-route encounter
 * (two subs on opposite directions of the same line, on a collision
 * course). The sim resolves this via `resolveSubVsSub` at the
 * geometric meet time; the preview projects that outcome.
 */
export interface SubEncounterPreview {
  /** The "this sub" perspective the caller asked about. */
  readonly subId: SubId;
  /** The opposing sub on a mirror trajectory. */
  readonly otherSubId: SubId;
  /** Sim time the encounter fires. */
  readonly encounterAt: number;
  readonly subDrillersBefore: number;
  readonly otherDrillersBefore: number;
  /** Winner from the perspective of `subId`. */
  readonly outcome: 'win' | 'lose' | 'tie';
  /** Drillers the winning side has after combat. 0 on tie. */
  readonly survivingDrillers: number;
}

/**
 * For an in-flight sub, find the earliest mirror-route encounter it
 * will hit before reaching its destination, and project the
 * outcome. Returns `null` when no other sub in `world.subs` is on a
 * mirror trajectory.
 *
 * Implementation strategy mirrors `simulateSubArrival`: clone the
 * world, tick past the encounter time, then read the resulting sub
 * states. We could have called `resolveSubVsSub` directly, but
 * routing through `tick()` ensures factory cycles, sentry shots,
 * and other simultaneous events apply in the same order as in the
 * live sim (so the projected drillers exactly match what arrives).
 */
export function simulateSubEncounter(
  world: World,
  sub: Sub,
): SubEncounterPreview | null {
  // Find the earliest mirror-route partner for this sub.
  let bestPartner: Sub | null = null;
  let bestMeet = Number.POSITIVE_INFINITY;
  for (const other of world.subs) {
    if ((other.id as unknown as number) === (sub.id as unknown as number)) continue;
    const meet = mirrorEncounterTime(sub, other);
    if (meet === null) continue;
    if (meet >= sub.arrivalAt) continue; // sub arrives first; no encounter
    if (meet >= other.arrivalAt) continue; // other arrives first
    if (meet < bestMeet) {
      bestPartner = other;
      bestMeet = meet;
    }
  }
  if (bestPartner === null) return null;

  // Clone the world and tick past the encounter so the real combat
  // path runs. After the tick, look up the subs by id to determine
  // who survived.
  const projected = structuredClone(world) as World;
  const subId = sub.id as unknown as number;
  const otherId = bestPartner.id as unknown as number;
  const projSub = projected.subs.find((s) => (s.id as unknown as number) === subId);
  const projOther = projected.subs.find((s) => (s.id as unknown as number) === otherId);
  if (projSub === undefined || projOther === undefined) return null;
  const subDrillersBefore = projSub.drillers;
  const otherDrillersBefore = projOther.drillers;

  try {
    const dt = bestMeet + 1 - projected.time;
    if (dt > 0) tick(projected, dt);
  } catch {
    return null;
  }

  const subAfter = projected.subs.find((s) => (s.id as unknown as number) === subId);
  const otherAfter = projected.subs.find((s) => (s.id as unknown as number) === otherId);
  // Outcome: who survived? subAfter undefined → sub destroyed.
  // Both undefined → tie. subAfter defined, otherAfter undefined → win.
  let outcome: 'win' | 'lose' | 'tie';
  let survivingDrillers = 0;
  if (subAfter === undefined && otherAfter === undefined) {
    outcome = 'tie';
  } else if (subAfter !== undefined && otherAfter === undefined) {
    outcome = 'win';
    survivingDrillers = subAfter.drillers;
  } else if (subAfter === undefined && otherAfter !== undefined) {
    outcome = 'lose';
    survivingDrillers = otherAfter.drillers;
  } else {
    // Both still exist post-tick — this means the combat resulted in
    // a Double-Agent swap (both subs continue under flipped owners
    // with 0 drillers) or otherwise resolved without destroying
    // either entity. From `sub`'s perspective this is effectively a
    // tie of normal combat semantics.
    outcome = 'tie';
  }

  return {
    subId: sub.id,
    otherSubId: bestPartner.id,
    encounterAt: bestMeet,
    subDrillersBefore,
    otherDrillersBefore,
    outcome,
    survivingDrillers,
  };
}

/** Pre-tick snapshot of a specialist's relevant state. */
interface SpecSnapshot {
  readonly kind: SpecialistKind;
  readonly ownerId: PlayerId;
  readonly state: 'active' | 'captive';
}

/**
 * Tick the cloned world past arrivalAt and read the outcome from the
 * post-arrival outpost state + emitted events.
 */
function runAndDiff(
  projected: World,
  destinationId: OutpostId,
  attackerId: PlayerId,
  attackerDrillers: number,
  arrivalAt: number,
  launchAt: number,
  travelMs: number,
  giftTo: PlayerId | undefined,
): ArrivalPreview {
  // Snapshot the projected state at the moment of arrival (defender
  // drillers + shield at arrival, before combat). We tick to
  // arrivalAt - 1 so any factory cycles + shield recharge that
  // happen before the sub lands are baked in, but the sub itself
  // hasn't arrived yet.
  const tickToBefore = Math.max(0, arrivalAt - 1 - projected.time);
  if (tickToBefore > 0) tick(projected, tickToBefore);
  const destBefore = outpostById(projected, destinationId);
  const defenderDrillers = destBefore.drillers;
  const shieldAtArrival = currentShieldCharge(destBefore, arrivalAt);
  const ownerBefore = destBefore.ownerId;

  // Snapshot specialists involved in *this* combat (either at the
  // defender outpost, or on a sub arriving here at this exact
  // arrivalAt). Diffing this set after the arrival tick reveals who
  // was killed (id gone) and who was captured (state flipped).
  const specsBefore = new Map<number, SpecSnapshot>();
  for (const s of projected.specialists) {
    let involved = false;
    if (s.location.kind === 'outpost') {
      if ((s.location.id as unknown as number) === (destinationId as unknown as number)) {
        involved = true;
      }
    } else {
      const subId = s.location.id as unknown as number;
      const onSub = projected.subs.find(
        (x) => (x.id as unknown as number) === subId,
      );
      if (
        onSub !== undefined &&
        (onSub.destinationId as unknown as number) === (destinationId as unknown as number) &&
        onSub.arrivalAt === arrivalAt
      ) {
        involved = true;
      }
    }
    if (involved) {
      specsBefore.set(s.id as unknown as number, {
        kind: s.kind,
        ownerId: s.ownerId,
        state: s.state,
      });
    }
  }

  // Capture the highest event id so we can spot what fires during
  // the arrival tick (combat_outpost, martyr_blast, etc.).
  const eventIdBefore = projected.nextEventId;

  // Tick past arrivalAt so the real combat path runs.
  const tickPast = arrivalAt + 1 - projected.time;
  if (tickPast > 0) tick(projected, tickPast);

  const destAfter = outpostById(projected, destinationId);
  const newEvents = projected.events.filter((e) => e.id >= eventIdBefore);
  const combatEvt = newEvents.find(
    (e) => e.kind === 'combat_outpost' && e.pos &&
      e.pos.x === destAfter.pos.x && e.pos.y === destAfter.pos.y,
  );

  // Build post-tick specialist index and compute the four diff lists.
  const specsAfter = new Map<number, Specialist>();
  for (const s of projected.specialists) {
    specsAfter.set(s.id as unknown as number, s);
  }
  const attackerKilled: SpecialistOutcome[] = [];
  const attackerCaptured: SpecialistOutcome[] = [];
  const defenderKilled: SpecialistOutcome[] = [];
  const defenderCaptured: SpecialistOutcome[] = [];
  for (const [id, before] of specsBefore) {
    const after = specsAfter.get(id);
    const wasAttacker = before.ownerId === attackerId;
    const wasDefender = ownerBefore !== null && before.ownerId === ownerBefore;
    if (after === undefined) {
      // Specialist removed → killed in combat (Phase-1 Assassin,
      // Martyr blast, etc.). Attribute to its pre-combat side.
      if (wasAttacker) attackerKilled.push({ id, kind: before.kind });
      else if (wasDefender) defenderKilled.push({ id, kind: before.kind });
    } else if (before.state === 'active' && after.state === 'captive') {
      // State flipped → newly captured by the winner. The list is
      // named for the *losing side* (their specialists become the
      // other side's captives).
      if (wasAttacker) attackerCaptured.push({ id, kind: before.kind });
      else if (wasDefender) defenderCaptured.push({ id, kind: before.kind });
    }
  }

  // Gift to current owner: cargo transfers, no combat.
  if (giftTo !== undefined && ownerBefore === giftTo) {
    return base(arrivalAt, launchAt, travelMs, attackerDrillers, defenderDrillers, shieldAtArrival, {
      shieldAbsorbed: 0,
      attackerSurviving: 0,
      defenderSurviving: defenderDrillers,
      outpostCaptured: false,
      outcome: 'gift',
    });
  }

  // Dormant capture (no defender).
  if (ownerBefore === null) {
    return base(arrivalAt, launchAt, travelMs, attackerDrillers, 0, 0, {
      shieldAbsorbed: 0,
      attackerSurviving: attackerDrillers,
      defenderSurviving: 0,
      outpostCaptured: true,
      outcome: 'capture-dormant',
    });
  }

  // Friendly reinforcement (sub from defender's owner).
  if (ownerBefore === attackerId) {
    return base(arrivalAt, launchAt, travelMs, attackerDrillers, defenderDrillers, shieldAtArrival, {
      shieldAbsorbed: 0,
      attackerSurviving: 0,
      defenderSurviving: defenderDrillers + attackerDrillers,
      outpostCaptured: false,
      outcome: 'reinforce',
    });
  }

  // Hostile: combat fired. Read the result from the resulting outpost
  // state + the combat_outpost event's summary.
  const outpostCaptured = destAfter.ownerId === attackerId;
  const winner = combatEvt?.summary.includes('attacker') === true ? 'attacker' : 'defender';

  // Reconstruct shield absorption + surviving drillers from the post-
  // combat outpost state. After combat:
  //   - Defender wins / tie: outpost.drillers is the defender survivors.
  //     Attackers reduced shield first (full drain or partial), then
  //     met drillers. Shield absorption = min(initial shield, initial
  //     attackers). Survivors = drillers after shield - actual losses.
  //   - Attacker wins (capture): outpost.drillers is attacker survivors.
  const specialists = {
    attackerKilled,
    attackerCaptured,
    defenderKilled,
    defenderCaptured,
  };
  if (outpostCaptured) {
    const shieldAbsorbed = Math.min(shieldAtArrival, attackerDrillers);
    return base(
      arrivalAt, launchAt, travelMs, attackerDrillers, defenderDrillers, shieldAtArrival,
      {
        shieldAbsorbed,
        attackerSurviving: destAfter.drillers,
        defenderSurviving: 0,
        outpostCaptured: true,
        outcome: 'attacker-wins',
      },
      specialists,
    );
  }
  const shieldAbsorbed = Math.min(shieldAtArrival, attackerDrillers);
  const defenderSurviving = destAfter.drillers;
  // tie: defender's drillers were reduced to 0 but attacker also 0 (or
  // less after shield).
  const outcome: ArrivalOutcome =
    winner === 'attacker'
      ? 'attacker-wins'
      : defenderSurviving === 0
        ? 'tie'
        : 'defender-wins';
  return base(
    arrivalAt, launchAt, travelMs, attackerDrillers, defenderDrillers, shieldAtArrival,
    {
      shieldAbsorbed,
      attackerSurviving: 0,
      defenderSurviving,
      outpostCaptured: false,
      outcome,
    },
    specialists,
  );
}

function base(
  arrivalAt: number,
  launchAt: number,
  travelMs: number,
  attackerDrillers: number,
  defenderDrillers: number,
  shieldAtArrival: number,
  rest: Pick<
    ArrivalPreview,
    'shieldAbsorbed' | 'attackerSurviving' | 'defenderSurviving' | 'outpostCaptured' | 'outcome'
  >,
  specialists?: {
    attackerKilled: readonly SpecialistOutcome[];
    attackerCaptured: readonly SpecialistOutcome[];
    defenderKilled: readonly SpecialistOutcome[];
    defenderCaptured: readonly SpecialistOutcome[];
  },
): ArrivalPreview {
  return {
    arrivalAt,
    launchAt,
    travelMs,
    attackerDrillers,
    defenderDrillersAtArrival: defenderDrillers,
    shieldAtArrival,
    ...rest,
    attackerKilled: specialists?.attackerKilled ?? [],
    attackerCaptured: specialists?.attackerCaptured ?? [],
    defenderKilled: specialists?.defenderKilled ?? [],
    defenderCaptured: specialists?.defenderCaptured ?? [],
  };
}

/** Convenience accessor: extract just the live source outpost. */
export function previewableSource(world: World, sourceId: OutpostId): Outpost {
  return outpostById(world, sourceId);
}

// Re-export Specialist to satisfy unused-import strictness when callers
// (server, client) only need ArrivalPreview / SimulateArrivalInput
// types. We keep `Specialist` referenced so the type-only re-export
// can be pulled in upstream without warnings.
export type { Specialist };
