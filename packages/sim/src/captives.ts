import type {
  Outpost,
  PlayerId,
  Specialist,
  Sub,
  SubId,
  World,
} from './types.js';
import { BASE_MS_PER_UNIT } from './types.js';
import { dist, distSquared } from './geometry.js';
import { outpostById } from './queries.js';
import { sonarRange } from './visibility.js';
import { specialistsAtOutpost } from './specialists.js';
import { acquireSpecialist } from './royalty.js';
import { emitEvent } from './events.js';

/**
 * Captive system (Phase 6f).
 *
 * Captives are produced by the combat capture phase (see 6e) — the
 * loser's surviving specialists become captives held by the winner at
 * the win site. This module implements the two ways captives change
 * status:
 *
 *   - **Hypnotist**: converts captives at the Hypnotist's own outpost
 *     to active specialists of the Hypnotist's owner (with second-
 *     Queen demotion).
 *   - **Diplomat**: releases the player's own captives within the
 *     Diplomat's outpost's sonar range — the captives travel home on
 *     a 1× speed sub to the original owner's nearest friendly outpost.
 *
 * The Diplomat scan runs first on each tick, so a Diplomat in sonar
 * range pre-empts an enemy Hypnotist at the same outpost.
 *
 * Per docs/05_specialists.md §8.8, §9.6, §13#3.
 */

/**
 * Run one round of captive resolution: Diplomat releases first, then
 * Hypnotist conversions. Called by the tick loop after every event so
 * captives produced in the same tick are processed immediately, and
 * once at tick start to catch out-of-band server mutations (instant
 * hire / finalize) that happened between tick calls.
 *
 * Eligibility only ever changes at events (specialist moves, outpost
 * captures, hires), never by pure time passing — so running this at
 * event times keeps the sim cadence-independent: `tick(a+b)` and
 * `tick(a); tick(b)` resolve captives at identical sim times.
 *
 * Returns true if any captive changed state (released or converted),
 * so the caller can invalidate caches that depend on specialists.
 */
export function processCaptiveActions(world: World, now: number): boolean {
  // 1. Diplomat releases.
  // Build (diplomat, range) once to avoid recomputing sonar for each captive.
  const diplomats: { spec: Specialist; outpost: Outpost; rangeSq: number }[] = [];
  for (const s of world.specialists) {
    if (s.kind !== 'diplomat') continue;
    if (s.state !== 'active') continue;
    if (s.location.kind !== 'outpost') continue;
    const o = world.outposts[s.location.id as unknown as number];
    if (o === undefined || o.ownerId !== s.ownerId) continue;
    const r = sonarRange(world, o);
    diplomats.push({ spec: s, outpost: o, rangeSq: r * r });
  }

  // Iterate over captives. We collect into a list first so removing
  // captives during iteration doesn't invalidate the loop.
  const releasable: Specialist[] = [];
  for (const captive of world.specialists) {
    if (captive.state !== 'captive') continue;
    if (captive.captiveOf === undefined) continue;
    if (captive.location.kind !== 'outpost') continue;
    const holdingOutpost = world.outposts[captive.location.id as unknown as number];
    if (holdingOutpost === undefined) continue;
    // Find a Diplomat owned by the captive's *original* owner whose
    // outpost's sonar reaches the holding outpost. Toroidal distance —
    // sonar wraps across map edges like everywhere else.
    for (const d of diplomats) {
      if (d.spec.ownerId !== captive.ownerId) continue;
      if (distSquared(d.outpost.pos, holdingOutpost.pos) <= d.rangeSq) {
        releasable.push(captive);
        break;
      }
    }
  }
  for (const captive of releasable) {
    releaseCaptive(world, captive, now);
  }

  // 2. Hypnotist conversions (skip any captives already released this tick).
  let converted = 0;
  const stillCaptive = world.specialists.filter(
    (s) => s.state === 'captive' && s.captiveOf !== undefined,
  );
  for (const captive of stillCaptive) {
    if (captive.location.kind !== 'outpost') continue;
    const holding = world.outposts[captive.location.id as unknown as number];
    if (holding === undefined || holding.ownerId !== captive.captiveOf) continue;
    // Find a Hypnotist OR a King at this outpost owned by the holder.
    // Per docs/05_specialists.md §13#4 "King retains Hypnotist? Yes
    // at the King's outpost only" — the King passively converts
    // captives at his own outpost just like a Hypnotist would.
    for (const spec of specialistsAtOutpost(world, holding.id)) {
      if (spec.state !== 'active') continue;
      if (spec.ownerId !== holding.ownerId) continue;
      if (spec.kind !== 'hypnotist' && spec.kind !== 'king') continue;
      convertCaptive(world, captive, spec.ownerId);
      converted += 1;
      break;
    }
  }
  return releasable.length > 0 || converted > 0;
}

/**
 * Execute a manual release-captive order. The captor (holder) chooses
 * to send a captive home as a diplomatic gesture.
 */
export function executeReleaseCaptive(
  world: World,
  order: { ownerId: PlayerId; specialistId: number },
): void {
  const captive = world.specialists.find(
    (s) => (s.id as unknown as number) === order.specialistId,
  );
  if (!captive) throw new Error('specialist not found');
  if (captive.state !== 'captive') throw new Error('specialist is not a captive');
  if (captive.captiveOf !== order.ownerId) throw new Error('you are not the holder');
  if (captive.location.kind !== 'outpost') throw new Error('captive is not at an outpost');
  const outpost = world.outposts[captive.location.id as unknown as number];
  if (!outpost || outpost.ownerId !== order.ownerId) {
    throw new Error('captive is not at one of your outposts');
  }
  releaseCaptive(world, captive, world.time);
}

export function releaseCaptive(world: World, captive: Specialist, now: number): void {
  // Find nearest friendly outpost of captive.ownerId.
  if (captive.location.kind !== 'outpost') return;
  const here = outpostById(world, captive.location.id);
  const home = nearestOutpostOf(world, captive.ownerId, here.pos);
  if (home === null) {
    // Original owner has no outposts left — captive is freed but has
    // nowhere to go. Drop them.
    removeSpecialist(world, captive);
    return;
  }
  // Spawn a release sub: 1× speed, 0 drillers, gift-to-self so the
  // gift-arrival path in `arriveSub` routes through acquireSpecialist
  // and re-applies the at-most-one-Queen invariant on landing.
  const id = world.nextSubId as SubId;
  world.nextSubId += 1;
  const travelMs = Math.round((dist(here.pos, home.pos) * BASE_MS_PER_UNIT) / 1.0);
  const sub: Sub = {
    id,
    ownerId: captive.ownerId,
    sourceId: here.id,
    destinationId: home.id,
    launchAt: now,
    arrivalAt: now + travelMs,
    drillers: 0,
    speedMultiplier: 1.0,
    giftTo: captive.ownerId,
  };
  world.subs.push(sub);
  captive.location = { kind: 'sub', id };
  const originalOwner = captive.ownerId;
  const holder = captive.captiveOf ?? captive.ownerId;
  // Flip back to active + apply the at-most-one-Queen invariant
  // immediately so even an in-transit released Queen doesn't violate
  // it. The gift-arrival path will re-check at landing in case the
  // owner acquired yet another Queen during the trip (e.g. a Princess
  // auto-promoted in the meantime).
  acquireSpecialist(world, captive, captive.ownerId);
  emitEvent(
    world,
    'captive_released',
    [originalOwner, holder],
    `${captive.kind} released — heading home to ${home.name}`,
  );
}

function convertCaptive(world: World, captive: Specialist, newOwnerId: PlayerId): void {
  const formerOwner = captive.ownerId;
  // Unified acquisition path — enforces at-most-one-active-Queen
  // automatically. Location is unchanged (captive stays at the
  // Hypnotist's outpost).
  acquireSpecialist(world, captive, newOwnerId);
  emitEvent(
    world,
    'captive_converted',
    [formerOwner, newOwnerId],
    `${captive.kind} converted by hypnotist`,
  );
}

function removeSpecialist(world: World, s: Specialist): void {
  const idx = world.specialists.indexOf(s);
  if (idx >= 0) world.specialists.splice(idx, 1);
}

function nearestOutpostOf(
  world: World,
  ownerId: PlayerId,
  from: { x: number; y: number },
): Outpost | null {
  let best: Outpost | null = null;
  let bestSq = Number.POSITIVE_INFINITY;
  for (const o of world.outposts) {
    if (o.ownerId !== ownerId) continue;
    const d = distSquared(from, o.pos);
    if (d < bestSq) {
      best = o;
      bestSq = d;
    }
  }
  return best;
}

/**
 * When an outpost changes ownership in combat, captives held at that
 * outpost transfer to the new owner. Captives whose original owner
 * matches the new owner are *freed* (released and active in place).
 *
 * Call from the combat capture path after `outpost.ownerId` has been
 * set to the new owner.
 */
export function transferCaptivesOnCapture(
  world: World,
  outpost: Outpost,
  newOwnerId: PlayerId,
): void {
  for (const s of specialistsAtOutpost(world, outpost.id)) {
    if (s.state !== 'captive') continue;
    if (s.ownerId === newOwnerId) {
      // The new owner is the captive's original owner — freed.
      s.state = 'active';
      delete s.captiveOf;
      continue;
    }
    s.captiveOf = newOwnerId;
  }
}

// Re-export the type that tests find easiest to reach from this module.
export type { Specialist };
