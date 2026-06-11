import type { OutpostId, Player, PlayerId, World } from './types.js';
import { DAY_MS, NEVER_PRODUCE } from './types.js';
import { outpostById, playerById } from './queries.js';
import { hasQueenAt } from './specialists.js';

// ---------- Counts ----------

export function mineCount(world: World, playerId: PlayerId): number {
  let n = 0;
  for (const o of world.outposts) {
    if (o.ownerId === playerId && o.kind === 'mine') n++;
  }
  return n;
}

export function outpostCount(world: World, playerId: PlayerId): number {
  let n = 0;
  for (const o of world.outposts) {
    if (o.ownerId === playerId) n++;
  }
  return n;
}

// ---------- Neptunium accrual ----------

/**
 * Live neptunium total for a player, in thousandths-of-a-kilogram.
 *
 * Production formula (per docs/06_mining_neptunium.md):
 *   rate (kg/day) = mines_owned × outposts_owned
 *
 * In thousandths per ms:
 *   per_ms = mines × outposts × 1000 / DAY_MS
 *
 * Live total = checkpoint + floor(elapsed_ms × per_ms).
 */
export function liveNeptuniumThousandths(
  world: World,
  player: Player,
  now: number,
): number {
  const dt = now - player.neptuniumLastAt;
  if (dt <= 0) return player.neptuniumMg;
  const mines = mineCount(world, player.id);
  const outposts = outpostCount(world, player.id);
  if (mines === 0 || outposts === 0) return player.neptuniumMg;
  const gained = Math.floor((dt * mines * outposts * 1000) / DAY_MS);
  return player.neptuniumMg + gained;
}

/**
 * Earliest sim time at which the player's live Neptunium reaches
 * `thresholdThousandths`, given the *current* production rate, or
 * `null` if the player produces nothing (rate 0 and below threshold).
 *
 * Exact inverse of `liveNeptuniumThousandths`:
 *   live(t) >= T  ⇔  floor(dt·k / DAY_MS) >= needed  ⇔  dt·k >= needed·DAY_MS
 * so the crossing is at dt = ceil(needed·DAY_MS / k). All quantities
 * stay well below 2^53, so the integer arithmetic is exact in doubles
 * and the returned time is guaranteed to satisfy the live check —
 * which the tick scheduler relies on to avoid livelock.
 *
 * May return a time in the past (≤ now) when the threshold is already
 * met; callers clamp to the current sim time.
 */
export function neptuniumCrossingTime(
  world: World,
  player: Player,
  thresholdThousandths: number,
): number | null {
  const needed = thresholdThousandths - player.neptuniumMg;
  if (needed <= 0) return player.neptuniumLastAt;
  const k = mineCount(world, player.id) * outpostCount(world, player.id) * 1000;
  if (k === 0) return null;
  const a = needed * DAY_MS;
  let dt = Math.floor(a / k);
  if (dt * k < a) dt += 1;
  return player.neptuniumLastAt + dt;
}

/**
 * Update a player's neptunium checkpoint to the live value at `now`.
 * Call this *before* changing anything that affects the player's
 * production rate (capturing an outpost, drilling a mine, losing an
 * outpost). Otherwise the rate-change moment is lost.
 */
export function commitNeptunium(world: World, playerId: PlayerId, now: number): void {
  const player = playerById(world, playerId);
  player.neptuniumMg = liveNeptuniumThousandths(world, player, now);
  player.neptuniumLastAt = now;
}

// ---------- Drilling ----------

/**
 * Driller cost to drill the (n+1)-th mine, given the player has
 * previously drilled `minesAlreadyDrilled`.
 *
 *   already=0 → 1st mine →  50
 *   already=1 → 2nd mine → 100
 *   already=2 → 3rd mine → 200
 *   already=3 → 4th mine → 300
 *   already=n (n≥1)     → n × 100
 */
export function drillCost(minesAlreadyDrilled: number): number {
  if (minesAlreadyDrilled < 0) {
    throw new Error(`minesAlreadyDrilled must be >= 0, got ${minesAlreadyDrilled}`);
  }
  if (minesAlreadyDrilled === 0) return 50;
  return minesAlreadyDrilled * 100;
}

export interface DrillOrder {
  readonly ownerId: PlayerId;
  readonly outpostId: OutpostId;
}

/**
 * Drill a Mine at an owned Factory or Generator.
 *
 *  - Validates ownership, eligibility (not already a Mine, not the
 *    Queen's home), and driller cost.
 *  - Commits neptunium for the player before changing state so the
 *    rate-change boundary is captured.
 *  - Consumes the drill cost from the outpost.
 *  - Converts the outpost permanently to a Mine.
 *  - Increments the player's `minesDrilled` counter (does not decrease
 *    if the Mine is later lost; the next drill cost still escalates).
 */
export function issueDrillOrder(world: World, order: DrillOrder): void {
  const outpost = outpostById(world, order.outpostId);
  if (outpost.ownerId !== order.ownerId) {
    throw new Error(`player ${order.ownerId} does not own outpost ${outpost.id}`);
  }
  if (outpost.kind === 'mine') {
    throw new Error(`outpost ${outpost.id} is already a Mine`);
  }
  if (hasQueenAt(world, outpost.id)) {
    throw new Error(`cannot drill an outpost the Queen is currently at`);
  }
  const player = playerById(world, order.ownerId);
  const cost = drillCost(player.minesDrilled);
  if (outpost.drillers < cost) {
    throw new Error(
      `drilling outpost ${outpost.id} needs ${cost} drillers; has ${outpost.drillers}`,
    );
  }

  commitNeptunium(world, order.ownerId, world.time);

  outpost.drillers -= cost;
  outpost.kind = 'mine';
  outpost.nextProductionAt = NEVER_PRODUCE;
  player.minesDrilled += 1;
}
