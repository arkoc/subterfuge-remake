import type { Outpost, PlayerId, World } from './types.js';
import {
  FACTORY_CYCLE_MS,
  FACTORY_DRILLERS_PER_CYCLE,
  GENERATOR_ELECTRICAL_OUTPUT,
  QUEEN_ELECTRICAL_OUTPUT,
} from './types.js';
import { maxShieldCharge } from './shield.js';
import {
  activeCountOf,
  specialistsAtOutpost,
  specialistsByOutpostIndex,
} from './specialists.js';

/**
 * Total electrical output for a player — the cap on their driller
 * stockpile. Per docs/03_drillers_production.md and
 * docs/05_specialists.md:
 *
 *   - The Queen specialist's current outpost contributes +150 (if she
 *     is at an outpost owned by the player; nothing while she's
 *     mid-flight on a sub).
 *   - Each Generator contributes +50.
 *
 * The Queen's bonus and the outpost kind are independent: if the
 * Queen sits on a Generator the outpost contributes both +150 and +50.
 *
 * Other specialist modifiers (Tinkerer, Minister of Energy, Security
 * Chief, Princess sonar etc.) land in Phase 6d.
 */
export function electricalOutput(world: World, playerId: PlayerId): number {
  let total = 0;
  // Build the per-outpost specialist index once instead of paying
  // O(specialists) per outpost inside the loop.
  const index = specialistsByOutpostIndex(world);
  for (const o of world.outposts) {
    if (o.ownerId !== playerId) continue;
    if (o.kind === 'generator') total += GENERATOR_ELECTRICAL_OUTPUT;
    // Tinkerer local: +3 × max_shield electrical per Tinkerer at the
    // outpost. Max is the live value (after Queen/SC/King mods).
    let tinkererCount = 0;
    for (const s of index.get(o.id as unknown as number) ?? []) {
      if (s.ownerId !== playerId) continue;
      if (s.state !== 'active') continue;
      if (s.kind === 'tinkerer') tinkererCount += 1;
    }
    if (tinkererCount > 0) {
      total += 3 * maxShieldCharge(world, o) * tinkererCount;
    }
  }
  // Queen-at-outpost +150. Look up by specialist rather than an outpost
  // flag, so the bonus follows the Queen when she moves (and vanishes
  // while she rides a sub).
  for (const s of world.specialists) {
    if (s.ownerId !== playerId) continue;
    if (s.state !== 'active') continue;
    if (s.kind !== 'queen') continue;
    if (s.location.kind !== 'outpost') continue;
    const outpost = world.outposts[s.location.id as unknown as number];
    if (outpost && outpost.ownerId === playerId) {
      total += QUEEN_ELECTRICAL_OUTPUT;
    }
  }
  // Minister of Energy global: +300 per MoE owned.
  total += 300 * activeCountOf(world, playerId, 'minister_of_energy');
  return total;
}

/**
 * Drillers produced by `factory` on one production cycle, accounting
 * for specialist modifiers:
 *
 *   - Foreman local: +6 per Foreman at this factory.
 *   - Tycoon local: +3 per Tycoon at this factory.
 *   - Minister of Energy global: -1 per MoE owned (per cycle, per factory).
 *
 * The Tycoon GLOBAL bonus (+50% per Tycoon, additive) shortens the
 * cycle interval rather than scaling per-cycle output — see
 * `factoryCycleIntervalFor`. Long-run rate is unchanged but the
 * shorter cycle matches the rulebook UX ("cycles complete 50% faster").
 *
 * Per docs/05_specialists.md §9.3-§9.5 / §8.4 / §9.4 / §9.3.
 */
export function factoryProductionFor(world: World, factory: Outpost): number {
  if (factory.ownerId === null || factory.kind !== 'factory') return 0;
  const owner = factory.ownerId;
  const player = world.players.find((p) => p.id === owner);
  if (player === undefined) return 0;

  let drillers = FACTORY_DRILLERS_PER_CYCLE;

  // Locals at this factory.
  let foremen = 0;
  let tycoonsLocal = 0;
  for (const s of specialistsAtOutpost(world, factory.id)) {
    if (s.ownerId !== owner || s.state !== 'active') continue;
    if (s.kind === 'foreman') foremen += 1;
    else if (s.kind === 'tycoon') tycoonsLocal += 1;
  }
  drillers += 6 * foremen + 3 * tycoonsLocal;

  // Minister of Energy global penalty (still per-cycle).
  const moes = activeCountOf(world, owner, 'minister_of_energy');
  drillers -= moes;

  return Math.max(0, drillers);
}

/**
 * Effective factory-cycle interval for a player, in ms. Each Tycoon
 * the player owns speeds cycles by +50% (additive); 2 Tycoons → 100%
 * faster (interval × ½), 3 → 150% faster (interval × ⅖), etc.
 *
 * Returns an integer ms value so the scheduler stays exact.
 * Per docs/05_specialists.md §8.4 and docs/03_drillers_production.md.
 */
export function factoryCycleIntervalFor(world: World, ownerId: PlayerId): number {
  const tycoonsGlobal = activeCountOf(world, ownerId, 'tycoon');
  const mult = 1 + 0.5 * tycoonsGlobal;
  return Math.max(1, Math.round(FACTORY_CYCLE_MS / mult));
}

/**
 * Sum of drillers across every outpost the player owns. The "stockpile"
 * referenced by the production rule is this number; production for a
 * given factory tick is forfeited when stockpile >= cap.
 */
export function totalDrillers(world: World, playerId: PlayerId): number {
  let total = 0;
  for (const o of world.outposts) {
    if (o.ownerId === playerId) total += o.drillers;
  }
  return total;
}
