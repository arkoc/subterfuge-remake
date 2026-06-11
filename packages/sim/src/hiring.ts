import type {
  OutpostId,
  PlayerId,
  Specialist,
  SpecialistKind,
  World,
} from './types.js';
import { HIRE_CADENCE_MS } from './types.js';
import { createRng } from './rng.js';
import { playerById } from './queries.js';
import {
  HIREABLE_BY_CATEGORY,
  activeCountOf,
  createSpecialist,
  isCapReached,
  queenOutpostOf,
  specialistMeta,
  specialistsAtOutpost,
} from './specialists.js';
import { scheduleSentry } from './passives.js';
import { commitShieldAtSpecialistOutpost } from './shield.js';

/**
 * Specialist hiring & promotion — Phase 6b.
 *
 * Per docs/05_specialists.md §1 each player gets one hire 4 hours
 * after game start and another every 18 hours after that. A hire
 * offers three candidates (one Offensive, one Defensive, one Other)
 * deterministically derived from `(worldSeed, playerId, hireIndex)`.
 *
 * Hires only fire while the player's Queen is at one of their own
 * outposts. If the timer fires while she's mid-flight or captive the
 * hire is "available but pending" — `executeHire` / `executePromote`
 * will refuse until she returns.
 */

// ---------- Roster generation ----------

export interface HireRoster {
  readonly offensive: SpecialistKind | null;
  readonly defensive: SpecialistKind | null;
  readonly other: SpecialistKind | null;
}

/** All non-null kinds offered, in offensive-defensive-other order. */
export function rosterKinds(r: HireRoster): SpecialistKind[] {
  const out: SpecialistKind[] = [];
  if (r.offensive !== null) out.push(r.offensive);
  if (r.defensive !== null) out.push(r.defensive);
  if (r.other !== null) out.push(r.other);
  return out;
}

/**
 * Deterministic hire roster from `(worldSeed, playerId, hireIndex)`.
 *
 * Filters out:
 *   - any kind that was offered in the previous hire (rulebook
 *     cooldown — applies to the offer, not the choice);
 *   - any kind at its hard cap for this player (e.g. Assassin/Saboteur
 *     at 2 active).
 *
 * If a category's filtered pool is empty, that slot is null — the
 * player gets fewer than 3 choices that turn.
 */
export function hireRoster(world: World, playerId: PlayerId): HireRoster {
  const player = playerById(world, playerId);
  return hireRosterAt(world, playerId, player.hireIndex, player.lastOfferedKinds);
}

/**
 * Same as `hireRoster`, but with explicit `hireIndex` and prior-offer
 * exclusion list. Used by `previewHireRosters` to project upcoming
 * rosters without mutating player state.
 */
export function hireRosterAt(
  world: World,
  playerId: PlayerId,
  hireIndex: number,
  excludedKinds: readonly SpecialistKind[],
): HireRoster {
  const player = playerById(world, playerId);
  const seed = hireSeed(player.hireSeed, hireIndex);
  const rng = createRng(seed);
  const excluded = new Set<SpecialistKind>(excludedKinds);
  return {
    offensive: pick(world, playerId, HIREABLE_BY_CATEGORY.offensive, excluded, rng.next()),
    defensive: pick(world, playerId, HIREABLE_BY_CATEGORY.defensive, excluded, rng.next()),
    other: pick(world, playerId, HIREABLE_BY_CATEGORY.other, excluded, rng.next()),
  };
}

/**
 * Project the player's current + next (`count - 1`) hire rosters
 * deterministically. Each successive roster's exclusion list is the
 * union of the previous roster's offered kinds (matches what
 * `executeHire` writes into `lastOfferedKinds`).
 *
 * Cap-reached filtering uses the **current** world state — this is a
 * preview, not a simulation, so caps that change between now and the
 * future hire aren't reflected.
 */
export function previewHireRosters(
  world: World,
  playerId: PlayerId,
  count: number,
): HireRoster[] {
  const player = playerById(world, playerId);
  const out: HireRoster[] = [];
  let excluded: readonly SpecialistKind[] = player.lastOfferedKinds;
  for (let i = 0; i < count; i++) {
    const roster = hireRosterAt(world, playerId, player.hireIndex + i, excluded);
    out.push(roster);
    excluded = rosterKinds(roster);
  }
  return out;
}

function pick(
  world: World,
  playerId: PlayerId,
  pool: readonly SpecialistKind[],
  excluded: Set<SpecialistKind>,
  r: number,
): SpecialistKind | null {
  const candidates = pool.filter(
    (k) => !excluded.has(k) && !isCapReached(world, playerId, k),
  );
  if (candidates.length === 0) return null;
  return candidates[Math.floor(r * candidates.length)] ?? null;
}

/**
 * Hash `(worldSeed, playerId)` into the player's private hire seed.
 * Called once at world-gen; the result lives on `Player.hireSeed` so
 * views can redact it (see the `Player.hireSeed` doc comment).
 *
 * This is the first half of the original
 * `(worldSeed, playerId, hireIndex)` splitmix-style hash — splitting
 * it keeps every roster stream byte-identical to the pre-split sim.
 */
export function playerHireSeed(worldSeed: number, playerId: PlayerId): number {
  const h = (worldSeed | 0) ^ 0x9e3779b9;
  return Math.imul(h ^ (playerId as unknown as number), 0x85ebca6b) | 0;
}

/**
 * Mix the player's private hire seed with `hireIndex` into a 32-bit
 * seed for the hire RNG. Second half of the original hash — see
 * `playerHireSeed`.
 */
function hireSeed(playerSeed: number, hireIndex: number): number {
  let h = Math.imul((playerSeed | 0) ^ hireIndex, 0xc2b2ae35) | 0;
  h ^= h >>> 16;
  return h >>> 0;
}

// ---------- Execute / promote ----------

export interface HireDecision {
  readonly ownerId: PlayerId;
  readonly kind: SpecialistKind;
}

export interface PromoteDecision {
  readonly ownerId: PlayerId;
  /** The specialist to promote (must be at the Queen's outpost and have a promoted form). */
  readonly specialistId: number;
}

/**
 * Hire one of the three candidates in the player's current roster.
 *
 * Validates: hire is due, Queen at one of player's outposts, the
 * picked kind appears in the live roster, the kind's hard cap is not
 * yet reached. Throws on any violation.
 *
 * On success: spawns the specialist at the Queen's outpost,
 * advances `hireIndex`, sets `nextHireAt = world.time + 18h`,
 * records the roster as `lastOfferedKinds` so next hire excludes it.
 */
export function executeHire(world: World, decision: HireDecision): Specialist {
  const player = playerById(world, decision.ownerId);
  if (player.eliminated) {
    throw new Error(`player ${player.id} is eliminated`);
  }
  if (world.time < player.nextHireAt) {
    throw new Error(
      `hire not yet available — next at ${player.nextHireAt}, world is ${world.time}`,
    );
  }
  const queenAt = queenOutpostOf(world, decision.ownerId);
  if (queenAt === null) {
    throw new Error(
      `cannot hire while Queen is not at one of player ${decision.ownerId} outposts`,
    );
  }
  const roster = hireRoster(world, decision.ownerId);
  if (!rosterKinds(roster).includes(decision.kind)) {
    throw new Error(
      `kind ${decision.kind} is not in this player's current hire roster`,
    );
  }
  if (isCapReached(world, decision.ownerId, decision.kind)) {
    throw new Error(`hard cap reached for ${decision.kind}`);
  }

  const spec = createSpecialist(world, decision.ownerId, decision.kind, {
    kind: 'outpost',
    id: queenAt,
  });
  if (spec.kind === 'sentry') scheduleSentry(spec, world.time);
  advanceHire(world, decision.ownerId, rosterKinds(roster));
  return spec;
}

/**
 * Promote a specialist instead of taking a hire. The specialist must
 * be at the Queen's outpost and have a `promotesTo` kind.
 *
 * Per the rulebook, a promotion does **not** count as a hire offer
 * for the cooldown — `lastOfferedKinds` is left untouched. The
 * `nextHireAt` and `hireIndex` advance normally.
 */
export function executePromote(world: World, decision: PromoteDecision): Specialist {
  const player = playerById(world, decision.ownerId);
  if (player.eliminated) {
    throw new Error(`player ${player.id} is eliminated`);
  }
  if (world.time < player.nextHireAt) {
    throw new Error(
      `promotion not yet available — next hire at ${player.nextHireAt}, world is ${world.time}`,
    );
  }
  const queenAt = queenOutpostOf(world, decision.ownerId);
  if (queenAt === null) {
    throw new Error(
      `cannot promote while Queen is not at one of player ${decision.ownerId} outposts`,
    );
  }
  const target = world.specialists.find(
    (s) => (s.id as unknown as number) === decision.specialistId,
  );
  if (target === undefined) {
    throw new Error(`specialist ${decision.specialistId} not found`);
  }
  if (target.ownerId !== decision.ownerId) {
    throw new Error(`specialist ${decision.specialistId} is not owned by player ${decision.ownerId}`);
  }
  if (target.state !== 'active') {
    throw new Error(`captive specialists cannot be promoted`);
  }
  if (target.location.kind !== 'outpost' || target.location.id !== queenAt) {
    throw new Error(`specialist must be at the Queen's outpost to be promoted`);
  }
  const meta = specialistMeta(target.kind);
  if (meta.promotesTo === null) {
    throw new Error(`${target.kind} has no promoted form`);
  }
  // Princess→Queen promotion is automatic on succession; not allowed
  // as a manual hire-skip.
  if (target.kind === 'princess') {
    throw new Error(`Princess promotes to Queen only on succession`);
  }

  // Tinkerer → MoE removes a drain source from the outpost; snapshot
  // shield first so the prior drain is captured.
  if (target.kind === 'tinkerer') {
    commitShieldAtSpecialistOutpost(world, target, world.time);
  }
  target.kind = meta.promotesTo;
  // Do NOT touch lastOfferedKinds — promotions skip the cooldown rule.
  const player2 = playerById(world, decision.ownerId);
  player2.hireIndex += 1;
  player2.nextHireAt = world.time + HIRE_CADENCE_MS;
  return target;
}

function advanceHire(
  world: World,
  playerId: PlayerId,
  offered: SpecialistKind[],
): void {
  const player = playerById(world, playerId);
  player.hireIndex += 1;
  player.nextHireAt = world.time + HIRE_CADENCE_MS;
  player.lastOfferedKinds = offered;
}

// ---------- Promotion targets at the Queen's outpost (for UI) ----------

/**
 * Return all specialists currently at the Queen's outpost that can
 * be promoted by the player. Used by the hire-skip UI to surface
 * promotion options.
 */
export function promotionCandidates(world: World, playerId: PlayerId): Specialist[] {
  const queenAt = queenOutpostOf(world, playerId);
  if (queenAt === null) return [];
  return specialistsAtOutpost(world, queenAt).filter(
    (s) =>
      s.ownerId === playerId &&
      s.state === 'active' &&
      specialistMeta(s.kind).promotesTo !== null &&
      s.kind !== 'princess',
  );
}

/** True if the player has at least one active specialist of `kind` somewhere. */
export function hasActiveOf(world: World, playerId: PlayerId, kind: SpecialistKind): boolean {
  return activeCountOf(world, playerId, kind) > 0;
}

/** Convenience for the UI: the next-hire-eligible outposts (Queen's outposts). */
export function queenLocationOf(world: World, playerId: PlayerId): OutpostId | null {
  return queenOutpostOf(world, playerId);
}
