import type { Outpost, World } from './types.js';
import { SHIELD_MAX, SHIELD_RECHARGE_TIME_MS, HOUR_MS } from './types.js';
import { specialistsAtOutpost } from './specialists.js';

/**
 * Per-Tinkerer shield drain rate, in charges per hour, per
 * docs/05_specialists.md §9.2. Each Tinkerer at the outpost
 * continuously drains 3 charge/hour.
 */
const TINKERER_DRAIN_PER_HOUR = 3;

/**
 * Live max shield charge for an outpost. Base from `shieldKind`, plus
 * specialist modifiers (Queen +20 at her outpost, Security Chief +10
 * globally per SC plus +10 local, King ±20 — global -20 to every
 * owned outpost, local +20 at the King's outpost).
 *
 * Per docs/05_specialists.md §6, §8.6, §9.7.
 */
export function maxShieldCharge(world: World, outpost: Outpost): number {
  let max = SHIELD_MAX[outpost.shieldKind];
  if (outpost.ownerId === null) return max;
  const ownerId = outpost.ownerId;

  // Queen at this outpost: +20 (Queen's effects apply at her outpost only).
  for (const s of specialistsAtOutpost(world, outpost.id)) {
    if (s.kind === 'queen' && s.state === 'active' && s.ownerId === ownerId) {
      max += 20;
    }
  }

  // King: global -20 per King owned, local +20 if the King is at this outpost.
  let kingsOwned = 0;
  let kingsHere = 0;
  let scLocal = 0;
  let scGlobal = 0;
  for (const s of world.specialists) {
    if (s.state !== 'active' || s.ownerId !== ownerId) continue;
    if (s.kind === 'king') {
      kingsOwned += 1;
      if (s.location.kind === 'outpost' && s.location.id === outpost.id) {
        kingsHere += 1;
      }
    } else if (s.kind === 'security_chief') {
      scGlobal += 1;
      if (s.location.kind === 'outpost' && s.location.id === outpost.id) {
        scLocal += 1;
      }
    }
  }
  max += -20 * kingsOwned + 20 * kingsHere;
  max += 10 * scGlobal + 10 * scLocal;

  if (max < 0) return 0;
  return max;
}

/**
 * Net charge change per ms at this outpost, expressed as the per-charge
 * intervals for recharge (positive) and drain (negative). Used by
 * `currentShieldCharge` to do all the arithmetic in integer ms.
 */
interface ShieldRates {
  /** ms per +1 charge from recharge; Infinity if there's no recharge. */
  readonly rechargeStepMs: number;
  /** ms per -1 charge from drain; Infinity if no drain. */
  readonly drainStepMs: number;
}

function shieldRates(world: World, outpost: Outpost): ShieldRates {
  const max = maxShieldCharge(world, outpost);
  const rechargeStepMs = max > 0 ? Math.floor(SHIELD_RECHARGE_TIME_MS / max) : Number.POSITIVE_INFINITY;
  let tinkererCount = 0;
  if (outpost.ownerId !== null) {
    for (const s of specialistsAtOutpost(world, outpost.id)) {
      if (s.kind === 'tinkerer' && s.state === 'active' && s.ownerId === outpost.ownerId) {
        tinkererCount += 1;
      }
    }
  }
  const drainStepMs =
    tinkererCount > 0
      ? Math.floor(HOUR_MS / (TINKERER_DRAIN_PER_HOUR * tinkererCount))
      : Number.POSITIVE_INFINITY;
  return { rechargeStepMs, drainStepMs };
}

/**
 * Live shield charge of `outpost` at time `now`. Accounts for:
 *
 *   - The dynamic max from `maxShieldCharge` (Queen/SC/King).
 *   - Continuous recharge at `max / 48h`.
 *   - Continuous drain at `3/h per Tinkerer` at the outpost.
 *
 * Net change per ms is `floor(elapsed / rechargeStep) -
 * floor(elapsed / drainStep)`. The result is clamped to `[0, max]`.
 *
 * The function signature accepts `world` so dynamic shield modifiers
 * (which depend on specialist locations) are visible. Callers that
 * don't have `world` handy can use `currentShieldChargeStatic` for
 * the legacy formula.
 */
export function currentShieldCharge(
  outpost: Outpost,
  now: number,
  world?: World,
): number {
  if (world === undefined) return currentShieldChargeStatic(outpost, now);
  const max = maxShieldCharge(world, outpost);
  if (max <= 0) return 0;
  const { rechargeStepMs, drainStepMs } = shieldRates(world, outpost);
  const elapsed = now - outpost.shieldChargedSince;
  if (elapsed <= 0) return Math.min(max, outpost.shieldCharge);
  const gained =
    rechargeStepMs === Number.POSITIVE_INFINITY ? 0 : Math.floor(elapsed / rechargeStepMs);
  const drained =
    drainStepMs === Number.POSITIVE_INFINITY ? 0 : Math.floor(elapsed / drainStepMs);
  const raw = outpost.shieldCharge + gained - drained;
  if (raw < 0) return 0;
  if (raw > max) return max;
  return raw;
}

/**
 * Legacy formula — base shield max only, no Tinkerer drain. Retained
 * for paths that compute against a pre-specialist world (combat
 * preview projection, etc.). Prefer `currentShieldCharge(o, now,
 * world)` for the modern behaviour.
 */
export function currentShieldChargeStatic(outpost: Outpost, now: number): number {
  const max = SHIELD_MAX[outpost.shieldKind];
  if (outpost.shieldCharge >= max) return max;
  const stepMs = Math.floor(SHIELD_RECHARGE_TIME_MS / max);
  const elapsed = now - outpost.shieldChargedSince;
  if (elapsed <= 0) return outpost.shieldCharge;
  const gained = Math.floor(elapsed / stepMs);
  return Math.min(max, outpost.shieldCharge + gained);
}

/**
 * Update an outpost's shield checkpoint to its current live value.
 * Pass `world` to include specialist modifiers (Tinkerer drain, etc.).
 */
export function commitShield(outpost: Outpost, now: number, world?: World): void {
  outpost.shieldCharge = currentShieldCharge(outpost, now, world);
  outpost.shieldChargedSince = now;
}

/**
 * If `spec` is currently located at an outpost, commit that outpost's
 * shield to "now" using the *current* specialist roster (before any
 * mutation). Call this immediately before changing a specialist's
 * location/ownerId/kind/state so that a Tinkerer departing or
 * arriving doesn't retroactively rewrite the drain history.
 *
 * No-op if the spec is on a sub or already on a freshly-committed
 * outpost (commit is idempotent in any case).
 */
export function commitShieldAtSpecialistOutpost(
  world: World,
  spec: { location: { kind: string; id: number } } | { location: { kind: string; id: unknown } },
  now: number,
): void {
  const loc = (spec as { location: { kind: string; id: unknown } }).location;
  if (loc.kind !== 'outpost') return;
  const outpost = world.outposts.find(
    (o) => (o.id as unknown as number) === (loc.id as unknown as number),
  );
  if (outpost === undefined) return;
  commitShield(outpost, now, world);
}
