import type { Coord, Outpost, PlayerId, Sub, World } from './types.js';
import { BASE_MS_PER_UNIT, MAP_SIZE } from './types.js';
import { dist, torusDelta, wrapCoord } from './geometry.js';
import { outpostById } from './queries.js';
import { resolveCombat } from './combat.js';
import { commitNeptunium } from './mining.js';
import { specialistsOnSub, activeCountOf } from './specialists.js';
import { tryInspectorRecharge } from './passives.js';
import { acquireSpecialist } from './royalty.js';
import { commitShield } from './shield.js';

/**
 * Compute the travel time (ms) for a sub crossing `distance` map units
 * at base speed (no specialist modifiers). Integer-valued for sim
 * determinism.
 */
export function travelTimeMs(distance: number, speedMultiplier = 1): number {
  if (speedMultiplier <= 0) {
    throw new Error(`speedMultiplier must be > 0, got ${speedMultiplier}`);
  }
  return Math.round((distance * BASE_MS_PER_UNIT) / speedMultiplier);
}

/**
 * Convenience: travel time between two outposts at the given speed.
 */
export function travelTimeBetween(
  source: Outpost,
  destination: Outpost,
  speedMultiplier = 1,
): number {
  return travelTimeMs(dist(source.pos, destination.pos), speedMultiplier);
}

/**
 * Local-max speed multipliers per specialist kind. See
 * docs/05_specialists.md §10 — among Helmsman, Smuggler, Pirate,
 * Admiral local, General local, Lieutenant local, only the largest
 * applies on a given sub. Smuggler is conditional on the destination
 * being owned by the Smuggler's owner; that filter is applied in
 * `effectiveSpeed` below.
 */
const LOCAL_SPEED: Partial<Record<string, number>> = {
  helmsman: 2.0,
  pirate: 2.0, // 2× chase mode is the default; 4× home-return triggers in 6g
  smuggler: 3.0, // conditional — see effectiveSpeed
  lieutenant: 1.5,
  general: 1.5,
  admiral: 1.5,
};

/**
 * Pure-data variant of `effectiveSpeed` — given the cargo kinds and
 * destination ownership, compute the multiplier. Useful for UI
 * previews where no Sub object exists yet.
 */
export function previewSpeed(
  world: World,
  ownerId: PlayerId,
  cargoKinds: readonly string[],
  destinationOwnerId: PlayerId | null,
): number {
  if (cargoKinds.length === 0) {
    const admirals = activeCountOf(world, ownerId, 'admiral');
    return 1.0 + 0.5 * admirals;
  }
  let max = 1.0;
  for (const kind of cargoKinds) {
    let v = LOCAL_SPEED[kind] ?? 0;
    if (kind === 'smuggler' && destinationOwnerId !== ownerId) {
      v = 1.0;
    }
    if (v > max) max = v;
  }
  return max;
}

/**
 * Composite speed multiplier for a sub.
 *
 * Local-max: only the largest local speed bonus applies. Admiral
 * global passive: every Admiral the player owns (anywhere) adds
 * +0.5× to subs that carry NO specialists at all.
 *
 * Per docs/05_specialists.md §10.
 */
export function effectiveSpeed(world: World, sub: Sub): number {
  // Pirate returning home runs at a fixed 4× — bypasses the local-max
  // calc so a subsequent recomputeSpeedAndArrival on the chase sub
  // (e.g. Smuggler-onboard logic) does not collapse it back to 2×.
  if (sub.chase !== undefined && sub.chase.phase === 'returning') {
    return 4.0;
  }
  const onboard = specialistsOnSub(world, sub.id);
  if (onboard.length === 0) {
    // Admiral global passive: +0.5 per Admiral owned, additive.
    const admirals = activeCountOf(world, sub.ownerId, 'admiral');
    return 1.0 + 0.5 * admirals;
  }
  let max = 1.0;
  const dest = outpostById(world, sub.destinationId);
  for (const s of onboard) {
    let v = LOCAL_SPEED[s.kind] ?? 0;
    if (s.kind === 'smuggler' && dest.ownerId !== sub.ownerId) {
      // Smuggler bonus evaporates when the destination isn't friendly.
      v = 1.0;
    }
    if (v > max) max = v;
  }
  return max;
}

/**
 * Recompute `sub.speedMultiplier` and `sub.arrivalAt` based on the
 * sub's current specialist roster and destination. If the sub is
 * mid-flight when this is called, the surviving leg's distance is
 * measured from the sub's current position (so a speed change does
 * not visually teleport the sub).
 */
export function recomputeSpeedAndArrival(
  world: World,
  sub: Sub,
  now: number,
): void {
  const newSpeed = effectiveSpeed(world, sub);
  sub.speedMultiplier = newSpeed;
  // If the sub has not yet launched, recompute the full trip.
  if (now < sub.launchAt) {
    const source = outpostById(world, sub.sourceId);
    const dest = outpostById(world, sub.destinationId);
    sub.arrivalAt = sub.launchAt + travelTimeBetween(source, dest, newSpeed);
    // A pre-launch sub has no flight history — no anchor to keep.
    delete sub.legFromPos;
    delete sub.legStartAt;
    return;
  }
  // Mid-flight: from current position to destination at new speed.
  // Anchor the new leg AT that position — `subPosition` interpolates
  // legFromPos→destination over [legStartAt, arrivalAt], so the course
  // change pivots from where the sub actually is instead of snapping
  // onto the source→new-destination line (the "redirected sub
  // teleports / moves from a random direction" bug).
  const pos = subPosition(world, sub, now);
  const dest = outpostById(world, sub.destinationId);
  const dx = torusDelta(pos.x, dest.pos.x);
  const dy = torusDelta(pos.y, dest.pos.y);
  const remaining = Math.sqrt(dx * dx + dy * dy);
  sub.legFromPos = pos;
  sub.legStartAt = now;
  sub.arrivalAt = now + travelTimeMs(remaining, newSpeed);
}

/**
 * Recompute speed + arrival for every in-flight sub whose
 * `destinationId` equals `outpostId`. Used whenever an outpost's
 * ownership changes — Smuggler's 3× speed is conditional on the
 * destination being friendly, so a capture / recapture / dormant-
 * claim flips the bonus on or off for any sub heading there.
 */
export function recomputeSubsTargeting(
  world: World,
  outpostId: Sub['destinationId'],
  now: number,
): void {
  for (const sub of world.subs) {
    if (sub.destinationId === outpostId) {
      recomputeSpeedAndArrival(world, sub, now);
    }
  }
}

export type SubStatus = 'queued' | 'in_flight';

export function subStatus(sub: Sub, now: number): SubStatus {
  return now < sub.launchAt ? 'queued' : 'in_flight';
}

/**
 * Current position of a sub in map coordinates.
 *
 *   - Queued (now < launchAt): the sub is at its source.
 *   - In flight: linear interpolation between source and destination
 *     by elapsed-flight-time fraction.
 *   - Arrived (now >= arrivalAt): at the destination — but a sub that
 *     has arrived should already have been removed from `world.subs`
 *     by `tick`; in that case this function still returns the
 *     destination for convenience.
 */
export function subPosition(world: World, sub: Sub, now: number): Coord {
  // Pirate chase / return: interpolate from chaseFromPos toward
  // interceptPos over [chaseStartAt, arrivalAt].
  if (sub.chase !== undefined) {
    const c = sub.chase;
    if (now <= c.chaseStartAt) return c.chaseFromPos;
    if (now >= sub.arrivalAt) return c.interceptPos;
    const span = sub.arrivalAt - c.chaseStartAt;
    const t = (now - c.chaseStartAt) / span;
    const dx = torusDelta(c.chaseFromPos.x, c.interceptPos.x);
    const dy = torusDelta(c.chaseFromPos.y, c.interceptPos.y);
    return {
      x: Math.round(wrapCoord(c.chaseFromPos.x + dx * t)),
      y: Math.round(wrapCoord(c.chaseFromPos.y + dy * t)),
    };
  }
  const source = outpostById(world, sub.sourceId);
  const dest = outpostById(world, sub.destinationId);
  // Mid-flight trajectory change (Navigator redirect / Smuggler speed
  // flip): the current leg runs from the anchor, not the source.
  if (sub.legFromPos !== undefined && sub.legStartAt !== undefined) {
    if (now <= sub.legStartAt) return sub.legFromPos;
    if (now >= sub.arrivalAt) return dest.pos;
    const span = sub.arrivalAt - sub.legStartAt;
    const t = (now - sub.legStartAt) / span;
    const dx = torusDelta(sub.legFromPos.x, dest.pos.x);
    const dy = torusDelta(sub.legFromPos.y, dest.pos.y);
    return {
      x: Math.round(wrapCoord(sub.legFromPos.x + dx * t)),
      y: Math.round(wrapCoord(sub.legFromPos.y + dy * t)),
    };
  }
  if (now <= sub.launchAt) return source.pos;
  if (now >= sub.arrivalAt) return dest.pos;
  const span = sub.arrivalAt - sub.launchAt;
  const elapsed = now - sub.launchAt;
  const t = elapsed / span;
  // Toroidal interpolation: the sub takes the shorter wrap direction.
  const dx = torusDelta(source.pos.x, dest.pos.x);
  const dy = torusDelta(source.pos.y, dest.pos.y);
  return {
    x: Math.round(wrapCoord(source.pos.x + dx * t)),
    y: Math.round(wrapCoord(source.pos.y + dy * t)),
  };
}

/**
 * Sub's position **without** wrapping back into [0, MAP_SIZE). Useful
 * for rendering the visible trajectory continuously across map edges.
 * Lies in `[source - MAP_SIZE, source + MAP_SIZE]`.
 */
export function subUnwrappedPosition(world: World, sub: Sub, now: number): Coord {
  const source = outpostById(world, sub.sourceId);
  const dest = outpostById(world, sub.destinationId);
  if (sub.legFromPos !== undefined && sub.legStartAt !== undefined) {
    const span = sub.arrivalAt - sub.legStartAt;
    const t = Math.min(1, Math.max(0, (now - sub.legStartAt) / span));
    const dx = torusDelta(sub.legFromPos.x, dest.pos.x);
    const dy = torusDelta(sub.legFromPos.y, dest.pos.y);
    return {
      x: sub.legFromPos.x + dx * t,
      y: sub.legFromPos.y + dy * t,
    };
  }
  if (now <= sub.launchAt) return source.pos;
  const span = sub.arrivalAt - sub.launchAt;
  const t = Math.min(1, Math.max(0, (now - sub.launchAt) / span));
  const dx = torusDelta(source.pos.x, dest.pos.x);
  const dy = torusDelta(source.pos.y, dest.pos.y);
  return {
    x: source.pos.x + dx * t,
    y: source.pos.y + dy * t,
  };
}

/**
 * Returns the "virtual destination" position relative to a source —
 * the destination shifted by ±MAP_SIZE when needed so the line from
 * source to virtual-dest follows the shortest toroidal path. Useful
 * for drawing sub trails / launch previews continuously across edges.
 */
export function virtualDestination(source: Coord, dest: Coord): Coord {
  return {
    x: source.x + torusDelta(source.x, dest.x),
    y: source.y + torusDelta(source.y, dest.y),
  };
}

// Re-export MAP_SIZE for convenience to callers building tile renders.
export { MAP_SIZE };

/**
 * Resolve a sub arriving at its destination.
 *
 * Three arrival outcomes:
 *   - Dormant outpost: the sub's owner claims it.
 *   - Friendly outpost: cargo merges into the outpost.
 *   - Enemy outpost: combat per docs/04_combat.md.
 */
export function arriveSub(world: World, sub: Sub): void {
  const dest = outpostById(world, sub.destinationId);

  // Move any specialists on the sub to the destination so subsequent
  // arrival logic (Inspector recharge, friendly-merge, combat capture
  // in 6f) sees them at the outpost.
  const onboard = specialistsOnSub(world, sub.id);
  // If any onboard specialist is a Tinkerer, commit the destination
  // outpost's shield BEFORE adding the new drain source so the
  // history-pre-arrival is baked in at the old rate.
  if (onboard.some((s) => s.kind === 'tinkerer')) {
    commitShield(dest, world.time, world);
  }
  // Gift sub arriving at the gift recipient's own outpost: cargo
  // transfers to the recipient regardless of who owned it before.
  // (Per docs/09: gifts pass through other players without combat.)
  if (sub.giftTo !== undefined && dest.ownerId === sub.giftTo) {
    commitNeptunium(world, sub.giftTo, world.time);
    dest.drillers += sub.drillers;
    for (const s of onboard) {
      // Route through acquireSpecialist so Queen-arrivals demote to
      // Princess when the recipient already has an active Queen, and
      // Diplomat-released captives flipping back to active land
      // correctly under the at-most-one-Queen invariant.
      s.location = { kind: 'outpost', id: dest.id };
      acquireSpecialist(world, s, sub.giftTo);
    }
    tryInspectorRecharge(world, dest, world.time);
    return;
  }

  if (dest.ownerId === null) {
    commitNeptunium(world, sub.ownerId, world.time);
    dest.ownerId = sub.ownerId;
    dest.drillers += sub.drillers;
    dest.shieldCharge = 0;
    dest.shieldChargedSince = world.time;
    for (const s of onboard) {
      s.location = { kind: 'outpost', id: dest.id };
    }
    tryInspectorRecharge(world, dest, world.time);
    // Dormant → owned: any Smuggler-laden sub also targeting this
    // outpost gains the 3× bonus now.
    recomputeSubsTargeting(world, dest.id, world.time);
  } else if (dest.ownerId === sub.ownerId) {
    dest.drillers += sub.drillers;
    for (const s of onboard) {
      s.location = { kind: 'outpost', id: dest.id };
    }
    tryInspectorRecharge(world, dest, world.time);
  } else {
    // Combat handles surviving-specialist relocation and the capture
    // path internally (see combat.ts capture phase + captives.ts).
    resolveCombat(world, sub, dest);
  }
}

export function isFriendlyTo(outpost: Outpost, playerId: PlayerId): boolean {
  return outpost.ownerId === playerId;
}

export function isDormant(outpost: Outpost): boolean {
  return outpost.ownerId === null;
}
