import type { Coord, OutpostId, PlayerId, Sub, World } from './types.js';
import { BASE_MS_PER_UNIT } from './types.js';
import { dist, distSquared, torusDelta, wrapCoord } from './geometry.js';
import { outpostById } from './queries.js';
import { specialistsOnSub } from './specialists.js';
import { subPosition, travelTimeMs } from './subs.js';

/**
 * Pirate target order + chase resolution (Phase 6j).
 *
 * Per docs/05_specialists.md §7.9, a Pirate sub may target an enemy
 * sub anywhere on the map (within sonar of the player). The Pirate
 * sub:
 *
 *   - Detaches from its original destinationId and heads toward a
 *     predicted geometric intercept point at 2× ordinary speed.
 *   - On reaching the intercept, fires sub-vs-sub combat against the
 *     target.
 *   - On surviving the engagement, auto-routes to its owner's
 *     nearest friendly outpost at 4× ordinary speed.
 *
 * The chase intercept is computed by treating both subs as moving
 * in straight lines and solving for the moment they meet.
 *
 * If the target re-routes (Navigator) or arrives at its destination,
 * `recomputeChase` should be called to refresh the intercept.
 */

const PIRATE_CHASE_SPEED = 2.0;
const PIRATE_RETURN_SPEED = 4.0;

/**
 * How close (map units) the pirate and its target must be at the
 * predicted intercept time for combat to actually fire. With a correct
 * intercept the two subs are co-located to within rounding (≤ a couple
 * units), so this is generous slack. A larger gap means the prediction
 * went stale (target trajectory changed without a chase refresh, etc.);
 * the tick re-aims via `recomputeChase` instead of teleport-killing the
 * target across open water.
 */
export const PIRATE_INTERCEPT_TOLERANCE = 50;

export interface PirateTargetOrder {
  readonly ownerId: PlayerId;
  readonly subId: number;
  readonly targetSubId: number;
}

/**
 * Direct a Pirate sub to chase an enemy sub. Validates: pirate
 * specialist aboard, ownership, hostility, target in flight. On
 * success, sets `sub.chase`, rewrites `arrivalAt` to the intercept
 * time, and updates `speedMultiplier` to 2.0.
 */
export function targetSub(world: World, order: PirateTargetOrder): void {
  const sub = world.subs.find((s) => (s.id as unknown as number) === order.subId);
  if (sub === undefined) throw new Error(`sub ${order.subId} not found`);
  if (sub.ownerId !== order.ownerId) {
    throw new Error(`sub ${order.subId} is not owned by player ${order.ownerId}`);
  }
  const target = world.subs.find(
    (s) => (s.id as unknown as number) === order.targetSubId,
  );
  if (target === undefined) throw new Error(`target sub ${order.targetSubId} not found`);
  if (target.ownerId === order.ownerId) {
    throw new Error(`cannot target your own sub`);
  }
  const onboard = specialistsOnSub(world, sub.id);
  const hasPirate = onboard.some(
    (s) => s.state === 'active' && s.kind === 'pirate',
  );
  if (!hasPirate) {
    throw new Error(`sub ${order.subId} has no active Pirate aboard`);
  }
  if (sub.chase !== undefined && sub.chase.phase === 'returning') {
    throw new Error(`pirate is already returning home — cannot retarget`);
  }
  const intercept = computeIntercept(world, sub, target, world.time);
  if (intercept === null) {
    throw new Error(`pirate cannot intercept target (geometry has no solution)`);
  }
  const myPos = subPosition(world, sub, world.time);
  sub.chase = {
    targetSubId: target.id,
    interceptPos: intercept.pos,
    chaseFromPos: myPos,
    chaseStartAt: world.time,
    phase: 'chasing',
  };
  sub.arrivalAt = intercept.time;
  sub.speedMultiplier = PIRATE_CHASE_SPEED;
}

/**
 * After a Pirate has engaged its target (sub-vs-sub combat resolved
 * via the standard resolver), the survivor auto-routes to its
 * owner's nearest friendly outpost at 4× speed. Call this on the
 * pirate sub after the combat completes.
 */
export function returnPirateHome(world: World, sub: Sub, now: number): void {
  const home = nearestOutpostOf(world, sub.ownerId, subPosition(world, sub, now));
  if (home === null) {
    // No friendly outposts left — pirate has nowhere to go. Remove it.
    const idx = world.subs.indexOf(sub);
    if (idx >= 0) world.subs.splice(idx, 1);
    return;
  }
  const fromPos = subPosition(world, sub, now);
  const distance = dist(fromPos, home.pos);
  sub.destinationId = home.id;
  // Re-use the previous targetSubId if one was set (the chase ended);
  // when the pirate was abandoning without a prior chase the id is
  // synthetic. Either way it's never consulted in 'returning' phase.
  const lastTarget = sub.chase?.targetSubId ?? sub.id;
  sub.chase = {
    targetSubId: lastTarget,
    interceptPos: home.pos,
    chaseFromPos: fromPos,
    chaseStartAt: now,
    phase: 'returning',
  };
  sub.arrivalAt = now + travelTimeMs(distance, PIRATE_RETURN_SPEED);
  sub.speedMultiplier = PIRATE_RETURN_SPEED;
}

/**
 * If a chase target's parameters changed (Navigator redirect, target
 * arrived elsewhere, target swapped owners via Double Agent), refresh
 * the pirate's intercept. If no intercept is solvable, the pirate
 * gives up and returns home.
 */
export function recomputeChase(world: World, sub: Sub, now: number): void {
  if (sub.chase === undefined || sub.chase.phase !== 'chasing') return;
  const target = world.subs.find(
    (s) => (s.id as unknown as number) === (sub.chase!.targetSubId as unknown as number),
  );
  if (target === undefined) {
    // Target gone (killed, captured). Return home.
    returnPirateHome(world, sub, now);
    return;
  }
  if (target.ownerId === sub.ownerId) {
    // Target is now friendly (Double Agent swap). Return home.
    returnPirateHome(world, sub, now);
    return;
  }
  const intercept = computeIntercept(world, sub, target, now);
  if (intercept === null) {
    returnPirateHome(world, sub, now);
    return;
  }
  const myPos = subPosition(world, sub, now);
  sub.chase = {
    targetSubId: target.id,
    interceptPos: intercept.pos,
    chaseFromPos: myPos,
    chaseStartAt: now,
    phase: 'chasing',
  };
  sub.arrivalAt = intercept.time;
  sub.speedMultiplier = PIRATE_CHASE_SPEED;
}

// ---------------------------------------------------------------------
// Geometric intercept
// ---------------------------------------------------------------------

/**
 * Solve for the time and position at which a pirate sub catches its
 * target, assuming both travel in straight lines.
 *
 *   P(t) = P0 + (I - P0) * (t - t0) / δ_pirate, δ_pirate = |I - P0| / Vp
 *   T(t) = T0 + D * (t - t0) / δ_target,           δ_target = T's flight remaining time
 *
 * Setting P(t_intercept) = T(t_intercept) = I:
 *   |I - P0| = Vp · (t_intercept - t0)
 *   I = T0 + D · (t_intercept - t0) / δ_target
 *
 * Let U = T0 - P0, s = (t_intercept - t0) / δ_target. Substituting:
 *   |U + s·D|² = (s · δ_target · Vp)²
 *   |U|² + 2s(U·D) + s²|D|² = s²(δ_target · Vp)²
 *   A·s² + B·s + C = 0,   A = |D|² - (δ_target·Vp)², B = 2(U·D), C = |U|²
 *
 * Returns the earliest valid intercept (smallest non-negative s
 * such that the intercept happens within the target's remaining
 * flight window), or null if no solution exists.
 */
function computeIntercept(
  world: World,
  pirate: Sub,
  target: Sub,
  now: number,
): { time: number; pos: Coord } | null {
  const P0 = subPosition(world, pirate, now);
  const T0 = subPosition(world, target, now);
  // Vp = base × pirate chase multiplier (per-ms per unit).
  // Effective ms/unit = BASE_MS_PER_UNIT / Vp = BASE_MS_PER_UNIT / 2.
  const Vp_msPerUnit = BASE_MS_PER_UNIT / PIRATE_CHASE_SPEED;
  // δ_target: remaining ms until target arrives at its current destination.
  const deltaTarget = target.arrivalAt - now;
  if (deltaTarget <= 0) {
    // Target has already arrived / will arrive at exactly now. Intercept
    // is the target's current position.
    const d = dist(P0, T0);
    return { time: now + d * Vp_msPerUnit, pos: T0 };
  }
  // D = T1 - T0 (in map units, vector). Taken along the SHORTER
  // toroidal direction — the target travels the short way around the
  // wrap (see subPosition), so its trajectory vector must too. Using
  // raw (T1 - T0) here makes a target crossing the seam appear to fly
  // the long way across the whole map, and the pirate plans toward a
  // bogus intercept.
  const T1 = target.chase !== undefined ? target.chase.interceptPos : outpostById(world, target.destinationId).pos;
  const Dx = torusDelta(T0.x, T1.x);
  const Dy = torusDelta(T0.y, T1.y);
  const Dmag = Math.sqrt(Dx * Dx + Dy * Dy);
  // Vp in units/ms.
  const Vp = 1 / Vp_msPerUnit;
  // (δ_target · Vp) in units (max distance pirate can travel in δ_target).
  const maxPirateRange = deltaTarget * Vp;
  // Set up quadratic A·s² + B·s + C = 0. U = T0 - P0, again along the
  // shorter toroidal direction so the pirate aims across the seam when
  // that is the closer approach.
  const Ux = torusDelta(P0.x, T0.x);
  const Uy = torusDelta(P0.y, T0.y);
  const Umag2 = Ux * Ux + Uy * Uy;
  const UdotD = Ux * Dx + Uy * Dy;
  const A = Dmag * Dmag - maxPirateRange * maxPirateRange;
  const B = 2 * UdotD;
  const C = Umag2;

  let bestS: number | null = null;
  if (Math.abs(A) < 1e-9) {
    // Linear: B·s + C = 0
    if (Math.abs(B) < 1e-9) {
      // Degenerate: pirate at target's position already.
      bestS = 0;
    } else {
      bestS = -C / B;
    }
  } else {
    const disc = B * B - 4 * A * C;
    if (disc < 0) return null;
    const sqrtDisc = Math.sqrt(disc);
    const s1 = (-B - sqrtDisc) / (2 * A);
    const s2 = (-B + sqrtDisc) / (2 * A);
    // Pick the smallest non-negative s ∈ [0, 1].
    const candidates = [s1, s2].filter((s) => s >= 0 && s <= 1);
    if (candidates.length === 0) return null;
    bestS = Math.min(...candidates);
  }
  if (bestS === null || bestS < 0 || bestS > 1) return null;

  const interceptTime = now + bestS * deltaTarget;
  // T0 + s·D can land off-plane (D was extended off-plane by
  // torusDelta); wrap it back into [0, MAP_SIZE) so the intercept is a
  // real on-map coordinate.
  const interceptPos: Coord = {
    x: wrapCoord(Math.round(T0.x + bestS * Dx)),
    y: wrapCoord(Math.round(T0.y + bestS * Dy)),
  };
  return { time: Math.round(interceptTime), pos: interceptPos };
}

function nearestOutpostOf(
  world: World,
  ownerId: PlayerId,
  from: Coord,
): { id: OutpostId; pos: Coord } | null {
  let best: { id: OutpostId; pos: Coord } | null = null;
  let bestSq = Number.POSITIVE_INFINITY;
  for (const o of world.outposts) {
    if (o.ownerId !== ownerId) continue;
    // Torus-aware distance — without this, an outpost on the "wrong
    // side" of the wrap is mis-classified as far even though it is
    // actually the closest landing site for the returning pirate.
    const d = distSquared(o.pos, from);
    if (d < bestSq) {
      best = { id: o.id, pos: o.pos };
      bestSq = d;
    }
  }
  return best;
}
