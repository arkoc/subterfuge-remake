import type {
  PlayerId,
  Specialist,
  SpecialistLocation,
  World,
} from './types.js';
import { dist } from './geometry.js';
import { outpostById, playerById } from './queries.js';
import { activeQueenOf, createSpecialist } from './specialists.js';
import { commitShieldAtSpecialistOutpost } from './shield.js';
import { emitEvent } from './events.js';

/**
 * Royalty succession & player elimination (Phase 6b).
 *
 * Per docs/05_specialists.md §12:
 *
 *   - Loss of the active Queen triggers succession atomically with
 *     the loss event. If the player has any active Princess, the
 *     nearest one to the Queen's last known location promotes to
 *     Queen. Otherwise the player is eliminated.
 *
 *   - Acquiring a second active Queen demotes the *new* arrival to
 *     a Princess (the original Queen keeps her crown). This is the
 *     mechanism that prevents gifted/converted Queens from creating
 *     two-Queen states.
 *
 *   - Elimination cascade: every owned outpost goes dormant, every
 *     in-flight sub is destroyed, every active specialist owned by
 *     the player is destroyed. Captives held by the player are
 *     released to nowhere (they vanish — original owner is gone if
 *     it's themselves; otherwise the captive is simply lost).
 */

/**
 * Called by the combat / capture path when a player's active Queen is
 * destroyed or captured. Promotes the nearest active Princess to Queen
 * in place; if no Princess exists, eliminates the player.
 *
 * `lastQueenPos` is the position the Queen was at when she was lost
 * (passed in by the caller because the Queen specialist may have
 * already been mutated/removed by the time this fires). For Queens
 * lost at outposts this is the outpost position; for Queens lost on
 * subs it's the sub's encounter position.
 */
export function onQueenLost(
  world: World,
  playerId: PlayerId,
  lastQueenPos: { x: number; y: number } | null,
): void {
  const player = playerById(world, playerId);
  if (player.eliminated) return;

  // If the Queen is still in world.specialists with state=active,
  // succession isn't actually needed yet. Defensive guard.
  if (activeQueenOf(world, playerId) !== null) return;

  const princess = nearestActivePrincess(world, playerId, lastQueenPos);
  if (princess !== null) {
    princess.kind = 'queen';
    emitEvent(
      world,
      'princess_promoted',
      [playerId],
      `princess promoted to queen after queen loss`,
    );
    return;
  }
  emitEvent(
    world,
    'player_eliminated',
    world.players.map((p) => p.id),
    `player ${playerId} eliminated — no queen, no princess`,
  );
  eliminatePlayer(world, playerId);
}

function nearestActivePrincess(
  world: World,
  playerId: PlayerId,
  ref: { x: number; y: number } | null,
): Specialist | null {
  let best: Specialist | null = null;
  let bestDist = Number.POSITIVE_INFINITY;
  let bestId = Number.POSITIVE_INFINITY;
  for (const s of world.specialists) {
    if (s.ownerId !== playerId) continue;
    if (s.kind !== 'princess') continue;
    if (s.state !== 'active') continue;
    // Princesses can only legally be at outposts; ignore others.
    if (s.location.kind !== 'outpost') continue;
    const o = outpostById(world, s.location.id);
    const d = ref === null ? 0 : dist(o.pos, ref);
    const id = s.id as unknown as number;
    if (d < bestDist || (d === bestDist && id < bestId)) {
      best = s;
      bestDist = d;
      bestId = id;
    }
  }
  return best;
}

/**
 * Eliminate a player. Sets `eliminated = true`; their outposts go
 * dormant (drillers/shield zeroed, ownership cleared); their subs
 * and active specialists are removed; captives held by them are
 * dropped (their original owners get nothing — Phase 6f will refine
 * this when the captive system goes live).
 */
export function eliminatePlayer(world: World, playerId: PlayerId): void {
  const player = playerById(world, playerId);
  if (player.eliminated) return;
  player.eliminated = true;

  for (const o of world.outposts) {
    if (o.ownerId !== playerId) continue;
    o.ownerId = null;
    o.drillers = 0;
    o.shieldCharge = 0;
    o.shieldChargedSince = world.time;
  }
  world.subs = world.subs.filter((s) => s.ownerId !== playerId);
  world.specialists = world.specialists.filter(
    (s) => s.ownerId !== playerId && s.captiveOf !== playerId,
  );
}

/**
 * Add a Queen specialist to a player, with second-Queen demotion.
 *
 * If the player already has an active Queen, the new arrival is
 * spawned as a Princess at the same location instead. Used by the
 * capture/convert/gift paths in later sub-phases — kept here so the
 * royalty invariant ("at most one active Queen per player") lives
 * in one place.
 */
export function grantQueen(
  world: World,
  ownerId: PlayerId,
  location: SpecialistLocation,
): Specialist {
  const existing = activeQueenOf(world, ownerId);
  if (existing !== null) {
    // Princess is outpost-only — if the arrival is on a sub, demote
    // anyway. The behaviour-when-she-lands will resolve at the sub's
    // arrival site.
    return createSpecialist(world, ownerId, 'princess', location);
  }
  return createSpecialist(world, ownerId, 'queen', location);
}

/**
 * Acquire (or re-acquire) an *existing* specialist for a player. This
 * is the unified entry point for every event that hands a specialist
 * to a player:
 *
 *   - A gift sub arriving at the gift recipient's outpost (recipient
 *     becomes the new owner).
 *   - A Hypnotist converting a captive (Hypnotist's owner becomes the
 *     captive's new owner).
 *   - A Diplomat-released captive arriving home (original owner
 *     re-acquires; ownership doesn't change but `state` flips back
 *     to active).
 *   - A Princess auto-promoting to Queen (kind changes, ownership
 *     doesn't).
 *
 * Enforces the at-most-one-active-Queen invariant: if `spec.kind ===
 * 'queen'` and the new owner already has another active Queen, the
 * arriving one is demoted to Princess. Caller still mutates location
 * separately if needed (this helper only touches owner, state,
 * kind, captiveOf).
 *
 * No-op for the trivial case (already owner, already active).
 */
export function acquireSpecialist(
  world: World,
  spec: Specialist,
  newOwnerId: PlayerId,
): void {
  // Tinkerer drain depends on the current ownerId match; flipping
  // ownership / state changes whether this Tinkerer counts for the
  // outpost's shield drain, so snapshot the shield at the old rate
  // first.
  if (spec.kind === 'tinkerer') {
    commitShieldAtSpecialistOutpost(world, spec, world.time);
  }
  // Resolve the kind transition BEFORE flipping state to active — if
  // we flip state first, activeQueenOf returns `spec` itself and
  // we'd miss the "owner already has a Queen" case.
  if (spec.kind === 'queen') {
    let otherActiveQueen: Specialist | null = null;
    for (const other of world.specialists) {
      if (other === spec) continue;
      if (other.kind !== 'queen') continue;
      if (other.state !== 'active') continue;
      if (other.ownerId !== newOwnerId) continue;
      otherActiveQueen = other;
      break;
    }
    if (otherActiveQueen !== null) {
      spec.kind = 'princess';
    }
  }
  spec.ownerId = newOwnerId;
  spec.state = 'active';
  delete spec.captiveOf;
}
