import type {
  Outpost,
  PlayerId,
  Specialist,
  Sub,
  World,
} from './types.js';
import { HOUR_MS } from './types.js';
import { distSquared } from './geometry.js';
import { outpostById } from './queries.js';
import { maxShieldCharge } from './shield.js';
import { sonarRange } from './visibility.js';
import { subPosition } from './subs.js';
import { specialistsAtOutpost } from './specialists.js';
import { emitEvent } from './events.js';

/**
 * Cadence between Sentry shots per docs/05_specialists.md §7.4.
 * Each Sentry has its own timer; the timer starts on hire/relocation
 * and resets every shot.
 */
export const SENTRY_FIRE_INTERVAL_MS = 2 * HOUR_MS;

/**
 * Returns the next sentry shot due before `deadline`, or null. Each
 * Sentry's `nextActionAt` is the scheduled-fire time; we pick the
 * earliest. Ties broken by specialist id ascending for determinism.
 */
export function earliestSentryShot(
  world: World,
  deadline: number,
): { sentry: Specialist; time: number } | null {
  let best: { sentry: Specialist; time: number } | null = null;
  for (const s of world.specialists) {
    if (s.kind !== 'sentry') continue;
    if (s.state !== 'active') continue;
    if (s.location.kind !== 'outpost') continue;
    const out = world.outposts[s.location.id as unknown as number];
    if (out === undefined || out.ownerId !== s.ownerId) continue;
    const t = s.nextActionAt ?? 0;
    if (t > deadline) continue;
    if (best === null || t < best.time) {
      best = { sentry: s, time: t };
    } else if (t === best.time) {
      const a = s.id as unknown as number;
      const b = best.sentry.id as unknown as number;
      if (a < b) best = { sentry: s, time: t };
    }
  }
  return best;
}

/**
 * Process one Sentry shot. Finds the enemy sub within 0.5 ×
 * sonarRange that would lose the most drillers (ceil 5%); destroys
 * that many drillers from it. If no target is in range, the Sentry
 * just resets its timer and waits.
 */
export function fireSentry(world: World, sentry: Specialist, now: number): void {
  if (sentry.location.kind !== 'outpost') {
    sentry.nextActionAt = now + SENTRY_FIRE_INTERVAL_MS;
    return;
  }
  const outpost = outpostById(world, sentry.location.id);
  const range = sonarRange(world, outpost) * 0.5;
  const rangeSq = range * range;
  let bestSub: Sub | null = null;
  let bestDamage = 0;
  let bestId = Number.POSITIVE_INFINITY;
  for (const sub of world.subs) {
    if (sub.ownerId === sentry.ownerId) continue;
    if (sub.giftTo !== undefined) continue; // gift subs pass freely
    if (now < sub.launchAt) continue; // sub not yet in flight
    const pos = subPosition(world, sub, now);
    if (distSquared(outpost.pos, pos) > rangeSq) continue;
    const dmg = Math.max(1, Math.ceil(sub.drillers * 0.05));
    const id = sub.id as unknown as number;
    if (dmg > bestDamage || (dmg === bestDamage && id < bestId)) {
      bestSub = sub;
      bestDamage = dmg;
      bestId = id;
    }
  }
  if (bestSub !== null) {
    const targetPos = subPosition(world, bestSub, now);
    bestSub.drillers = Math.max(0, bestSub.drillers - bestDamage);
    emitEvent(
      world,
      'sentry_shot',
      [sentry.ownerId, bestSub.ownerId],
      `sentry at ${outpost.name} hit a sub for ${bestDamage} drillers`,
      outpost.pos,
      targetPos,
    );
  }
  sentry.nextActionAt = now + SENTRY_FIRE_INTERVAL_MS;
}

/**
 * Schedule a Sentry's first shot. Call this when a Sentry is hired
 * or arrives at an outpost (Phase 6f will wire up the latter).
 */
export function scheduleSentry(sentry: Specialist, now: number): void {
  sentry.nextActionAt = now + SENTRY_FIRE_INTERVAL_MS;
}

/**
 * If `outpost` has an active Inspector owned by the outpost's owner,
 * fully recharge the outpost's shield. Used on sub arrival at a
 * friendly outpost and after a victorious combat (Phase 6e wires the
 * latter).
 *
 * Per docs/05_specialists.md §8.5.
 */
export function tryInspectorRecharge(
  world: World,
  outpost: Outpost,
  now: number,
): void {
  if (outpost.ownerId === null) return;
  let hasInspector = false;
  for (const s of specialistsAtOutpost(world, outpost.id)) {
    if (s.state !== 'active') continue;
    if (s.ownerId !== outpost.ownerId) continue;
    if (s.kind === 'inspector' || s.kind === 'security_chief') {
      hasInspector = true;
      break;
    }
  }
  if (!hasInspector) return;
  outpost.shieldCharge = maxShieldCharge(world, outpost);
  outpost.shieldChargedSince = now;
}

/**
 * Best-effort callsite hook for tracking active Princess sonar
 * coverage when the visibility filter needs to invalidate caches.
 * No-op for now — included for completeness so the import surface
 * matches the rest of the passives module.
 */
export function noopMarker(_world: World, _playerId: PlayerId): void {
  /* placeholder */
}
