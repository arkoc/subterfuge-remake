import type {
  OutpostId,
  PlayerId,
  Specialist,
  SpecialistId,
  Sub,
  SubId,
  World,
} from './types.js';
import { LAUNCH_DELAY_MS } from './types.js';
import { outpostById } from './queries.js';
import {
  effectiveSpeed,
  recomputeSpeedAndArrival,
  subPosition,
  travelTimeBetween,
} from './subs.js';
import { specialistsOnSub } from './specialists.js';
import { commitShieldAtSpecialistOutpost } from './shield.js';
import { recomputeChase } from './pirate.js';

export interface LaunchOrder {
  readonly ownerId: PlayerId;
  readonly sourceId: OutpostId;
  readonly destinationId: OutpostId;
  /** Drillers to load onto the sub. Must be > 0 and <= source.drillers. */
  readonly drillers: number;
  /**
   * Optional gift recipient. When set, the sub's cargo transfers to
   * this player on arrival at any outpost they own (instead of
   * fighting / merging). Doesn't take effect if the destination isn't
   * owned by the recipient at arrival time.
   */
  readonly giftTo?: PlayerId;
  /**
   * Optional specialists to load onto the sub. Each must be owned by
   * `ownerId`, **active** (captives cannot board), and currently at
   * the source outpost. Every kind of specialist is mobile — the
   * `abilityScope` field describes where the *ability* fires, not
   * where the unit may be. On success, each one's location is moved
   * to the new sub.
   */
  readonly specialistIds?: readonly SpecialistId[];
}

/**
 * Issue a launch order. On success:
 *   - The requested drillers are immediately deducted from the source
 *     outpost's garrison (reserved on the sub).
 *   - A new sub is appended to `world.subs` with `launchAt = now + 10min`
 *     and `arrivalAt = launchAt + travelTime(distance)`.
 *   - The sub's id is returned.
 *
 * Validation errors throw before any state mutation.
 *
 * Phase 3 forbids targeting an enemy-owned outpost. That restriction
 * goes away in Phase 4 when combat lands.
 */
export function issueLaunchOrder(world: World, order: LaunchOrder): SubId {
  if (!Number.isInteger(order.drillers) || order.drillers < 0) {
    throw new Error(
      `drillers must be a non-negative integer, got ${order.drillers}`,
    );
  }
  // A sub must carry SOMETHING — either drillers or at least one
  // specialist. Empty subs (0 drillers + 0 specialists) are rejected.
  const specialistsRequested = order.specialistIds?.length ?? 0;
  if (order.drillers === 0 && specialistsRequested === 0) {
    throw new Error(`sub must carry drillers or at least one specialist`);
  }
  if (order.sourceId === order.destinationId) {
    throw new Error('sourceId and destinationId must differ');
  }

  const source = outpostById(world, order.sourceId);
  const destination = outpostById(world, order.destinationId);

  if (source.ownerId !== order.ownerId) {
    throw new Error(
      `player ${order.ownerId} does not own source outpost ${source.id}`,
    );
  }
  if (source.drillers < order.drillers) {
    throw new Error(
      `source outpost ${source.id} has ${source.drillers} drillers; need ${order.drillers}`,
    );
  }
  // Phase 4+: enemy targeting is allowed — arrival will run combat.

  // Validate optional specialist cargo before mutating state.
  const specialistsToBoard: Specialist[] = [];
  if (order.specialistIds && order.specialistIds.length > 0) {
    for (const sid of order.specialistIds) {
      const s = world.specialists.find(
        (x) => (x.id as unknown as number) === (sid as unknown as number),
      );
      if (s === undefined) {
        throw new Error(`specialist ${sid as unknown as number} not found`);
      }
      if (s.ownerId !== order.ownerId) {
        throw new Error(
          `specialist ${sid as unknown as number} is not owned by player ${order.ownerId}`,
        );
      }
      if (s.state !== 'active') {
        throw new Error(
          `specialist ${sid as unknown as number} is captive and cannot board a sub`,
        );
      }
      if (s.location.kind !== 'outpost' || s.location.id !== source.id) {
        throw new Error(
          `specialist ${sid as unknown as number} is not at the source outpost`,
        );
      }
      // No `abilityScope` placement check — every specialist is
      // physically mobile. Captives are filtered above; that's the
      // only loading restriction in the official rules.
      specialistsToBoard.push(s);
    }
  }

  source.drillers -= order.drillers;
  const launchAt = world.time + LAUNCH_DELAY_MS;
  const id = world.nextSubId as SubId;
  world.nextSubId += 1;
  const sub: Sub = {
    id,
    ownerId: order.ownerId,
    sourceId: source.id,
    destinationId: destination.id,
    launchAt,
    arrivalAt: launchAt, // placeholder; filled after speed computation
    drillers: order.drillers,
    speedMultiplier: 1.0,
    ...(order.giftTo !== undefined ? { giftTo: order.giftTo } : {}),
  };
  world.subs.push(sub);

  // Move boarding specialists onto the sub before computing speed.
  // Commit shield first so any Tinkerer leaving an outpost has their
  // drain baked into the checkpoint at the old rate.
  for (const s of specialistsToBoard) {
    if (s.kind === 'tinkerer') {
      commitShieldAtSpecialistOutpost(world, s, world.time);
    }
    s.location = { kind: 'sub', id };
  }

  // Now that the roster aboard is fixed, compute the effective speed
  // and arrival time. Future events (Smuggler destination flip,
  // Navigator redirect, Pirate state transitions) call
  // recomputeSpeedAndArrival to refresh these.
  sub.speedMultiplier = effectiveSpeed(world, sub);
  sub.arrivalAt = launchAt + travelTimeBetween(source, destination, sub.speedMultiplier);

  return id;
}

// ---------------------------------------------------------------------
// Pre-launch cancel / edit (10-minute window per docs/02_subs.md §1)
// ---------------------------------------------------------------------

export interface CancelSubOrder {
  readonly ownerId: PlayerId;
  readonly subId: SubId;
}

/**
 * Cancel a sub that is still in its 10-minute pre-launch window.
 * Refunds drillers and disembarks any specialists back to the source
 * outpost, then removes the sub from `world.subs`.
 *
 * Throws if the sub has already departed (now >= launchAt), or if the
 * caller does not own it. No state is mutated on failure.
 */
export function cancelSub(world: World, order: CancelSubOrder): void {
  const sub = world.subs.find(
    (s) => (s.id as unknown as number) === (order.subId as unknown as number),
  );
  if (sub === undefined) throw new Error(`sub ${order.subId} not found`);
  if (sub.ownerId !== order.ownerId) {
    throw new Error(`sub ${order.subId} is not owned by player ${order.ownerId}`);
  }
  if (world.time >= sub.launchAt) {
    throw new Error(`sub ${order.subId} has already launched`);
  }

  const source = outpostById(world, sub.sourceId);
  source.drillers += sub.drillers;
  for (const s of specialistsOnSub(world, sub.id)) {
    if (s.kind === 'tinkerer') {
      // Returning Tinkerer re-engages drain at the source — commit
      // the source outpost's shield history first.
      commitShieldAtSpecialistOutpost(world, s, world.time);
    }
    s.location = { kind: 'outpost', id: source.id };
  }
  const idx = world.subs.indexOf(sub);
  if (idx >= 0) world.subs.splice(idx, 1);
}

export interface EditPreLaunchSubOrder {
  readonly ownerId: PlayerId;
  readonly subId: SubId;
  /** New driller count. Must be a positive integer; difference is
   *  added back to (or taken from) the source outpost garrison. */
  readonly drillers: number;
  /** Optional: replace the sub's specialist roster wholesale.
   *  Each id must be an active specialist owned by the player and
   *  currently at the source outpost OR already on this sub. */
  readonly specialistIds?: readonly SpecialistId[];
}

/**
 * Edit a pre-launch sub's cargo (drillers and/or specialists). Only
 * valid before `sub.launchAt`. The arrival time is recomputed if the
 * specialist roster changes (speed depends on cargo).
 *
 * Validation:
 *   - Drillers must be > 0 and ≤ (source.drillers + sub.drillers).
 *   - Each id in `specialistIds` must be active, owned by the caller,
 *     and currently at the source outpost OR already aboard the sub.
 *   - Specialists removed from the sub are returned to the source
 *     outpost; specialists added move from the source onto the sub.
 *
 * Throws on any violation; no state is mutated on failure.
 */
export function editPreLaunchSub(
  world: World,
  order: EditPreLaunchSubOrder,
): void {
  if (!Number.isInteger(order.drillers) || order.drillers < 0) {
    throw new Error(
      `drillers must be a non-negative integer, got ${order.drillers}`,
    );
  }
  const sub = world.subs.find(
    (s) => (s.id as unknown as number) === (order.subId as unknown as number),
  );
  if (sub === undefined) throw new Error(`sub ${order.subId} not found`);
  if (sub.ownerId !== order.ownerId) {
    throw new Error(`sub ${order.subId} is not owned by player ${order.ownerId}`);
  }
  if (world.time >= sub.launchAt) {
    throw new Error(`sub ${order.subId} has already launched`);
  }
  const source = outpostById(world, sub.sourceId);
  const available = source.drillers + sub.drillers;
  if (order.drillers > available) {
    throw new Error(
      `cannot set drillers to ${order.drillers}: source has only ${available} available`,
    );
  }

  // Empty-cargo guard: a pre-launch sub may not end with 0 drillers
  // AND 0 specialists aboard. Compute the resulting roster size now
  // so we can reject the edit before mutating.
  const subId = sub.id as unknown as number;
  const currentRosterSize = world.specialists.filter(
    (s) =>
      s.location.kind === 'sub' &&
      (s.location.id as unknown as number) === subId,
  ).length;
  const resultingRosterSize =
    order.specialistIds === undefined
      ? currentRosterSize
      : order.specialistIds.length;
  if (order.drillers === 0 && resultingRosterSize === 0) {
    throw new Error(`sub must carry drillers or at least one specialist`);
  }

  // Resolve and validate the specialist roster before mutating.
  let nextSpecialists: Specialist[] | null = null;
  if (order.specialistIds !== undefined) {
    nextSpecialists = [];
    for (const sid of order.specialistIds) {
      const s = world.specialists.find(
        (x) => (x.id as unknown as number) === (sid as unknown as number),
      );
      if (s === undefined) {
        throw new Error(`specialist ${sid as unknown as number} not found`);
      }
      if (s.ownerId !== order.ownerId) {
        throw new Error(
          `specialist ${sid as unknown as number} is not owned by player ${order.ownerId}`,
        );
      }
      if (s.state !== 'active') {
        throw new Error(
          `specialist ${sid as unknown as number} is captive and cannot board a sub`,
        );
      }
      const onSourceOrSub =
        (s.location.kind === 'outpost' && s.location.id === source.id) ||
        (s.location.kind === 'sub' &&
          (s.location.id as unknown as number) ===
            (sub.id as unknown as number));
      if (!onSourceOrSub) {
        throw new Error(
          `specialist ${sid as unknown as number} is not at the source outpost or on this sub`,
        );
      }
      nextSpecialists.push(s);
    }
  }

  // Mutate drillers.
  const delta = order.drillers - sub.drillers;
  source.drillers -= delta;
  sub.drillers = order.drillers;

  // Mutate roster if requested. Three groups: (a) currently on sub,
  // not in new list → move back to source; (b) in new list, not yet
  // on sub → move onto sub; (c) already correct → no-op.
  if (nextSpecialists !== null) {
    const desiredIds = new Set(
      nextSpecialists.map((s) => s.id as unknown as number),
    );
    const subId = sub.id as unknown as number;
    for (const s of world.specialists) {
      if (
        s.location.kind === 'sub' &&
        (s.location.id as unknown as number) === subId &&
        !desiredIds.has(s.id as unknown as number)
      ) {
        // Removed: send back to source.
        s.location = { kind: 'outpost', id: source.id };
      }
    }
    for (const s of nextSpecialists) {
      if (
        s.location.kind !== 'sub' ||
        (s.location.id as unknown as number) !== subId
      ) {
        s.location = { kind: 'sub', id: sub.id };
      }
    }
    // Speed depends on the roster; recompute arrivalAt.
    recomputeSpeedAndArrival(world, sub, world.time);
  }
}

// ---------------------------------------------------------------------
// Mid-flight redirect (Navigator — see docs/05_specialists.md §9.8)
// ---------------------------------------------------------------------

export interface RedirectSubOrder {
  readonly ownerId: PlayerId;
  readonly subId: SubId;
  readonly newDestinationId: OutpostId;
}

/**
 * Re-target a sub in flight. Requires a Navigator (or Admiral —
 * Admiral *loses* the Navigator ability per spec §9.9, so only
 * Navigator) aboard the sub. The sub's destination is rewritten and
 * `arrivalAt` recomputed from the sub's current position at the
 * sub's current speed.
 *
 * Throws if validation fails. No state is mutated on failure.
 */
export function redirectSub(world: World, order: RedirectSubOrder): void {
  const sub = world.subs.find(
    (s) => (s.id as unknown as number) === (order.subId as unknown as number),
  );
  if (sub === undefined) throw new Error(`sub ${order.subId} not found`);
  if (sub.ownerId !== order.ownerId) {
    throw new Error(`sub ${order.subId} is not owned by player ${order.ownerId}`);
  }
  if (sub.sourceId === order.newDestinationId) {
    throw new Error(`new destination must differ from source`);
  }
  const onboard = specialistsOnSub(world, sub.id);
  const hasNavigator = onboard.some(
    (s) => s.state === 'active' && s.kind === 'navigator',
  );
  if (!hasNavigator) {
    throw new Error(
      `sub ${order.subId} has no active Navigator — cannot redirect`,
    );
  }
  // Make sure the new destination exists. Reading via outpostById
  // throws on missing ids.
  outpostById(world, order.newDestinationId);
  // Pin the leg anchor at the sub's position on its CURRENT trajectory
  // BEFORE swapping the destination — subPosition reads destinationId,
  // so capturing it afterwards would compute the position on the new
  // line (the teleport this anchor exists to prevent).
  if (world.time >= sub.launchAt) {
    sub.legFromPos = subPosition(world, sub, world.time);
    sub.legStartAt = world.time;
  }
  sub.destinationId = order.newDestinationId;
  recomputeSpeedAndArrival(world, sub, world.time);
  // Any pirate currently chasing this sub had its interceptPos
  // pinned to the OLD trajectory. After the destination change the
  // intercept geometry is stale, so re-aim every chaser. If a
  // chaser can no longer intercept, recomputeChase routes it home.
  recomputeChasersOf(world, sub, world.time);
}

/**
 * After `target` has been redirected, destroyed, or swapped owners,
 * re-aim every pirate sub currently chasing it. Skips chases in the
 * `'returning'` phase — that's a committed return trip and isn't
 * affected by target trajectory changes.
 */
export function recomputeChasersOf(world: World, target: Sub, now: number): void {
  const targetId = target.id as unknown as number;
  // Snapshot the chasers first — recomputeChase can mutate sub.chase
  // (switch to returning) which would invalidate iteration.
  const chasers: Sub[] = [];
  for (const s of world.subs) {
    if (s.chase === undefined) continue;
    if (s.chase.phase !== 'chasing') continue;
    if ((s.chase.targetSubId as unknown as number) !== targetId) continue;
    chasers.push(s);
  }
  for (const chaser of chasers) {
    recomputeChase(world, chaser, now);
  }
}
