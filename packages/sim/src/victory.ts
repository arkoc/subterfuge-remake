import type { World } from './types.js';
import { NEPTUNIUM_VICTORY_THOUSANDTHS } from './types.js';
import { liveNeptuniumThousandths, neptuniumCrossingTime } from './mining.js';

/**
 * Detect a Neptunium victory at the given moment. If any player's live
 * Neptunium total has crossed `200 kg`, set `world.winnerId`. Once set,
 * the field is sticky — calling again does not change the winner.
 *
 * The function inspects all players each call; with player counts capped
 * at 10 this is cheap enough to run after every event.
 */
export function checkVictory(world: World, now: number): void {
  if (world.winnerId !== null) return;
  for (const p of world.players) {
    const live = liveNeptuniumThousandths(world, p, now);
    if (live >= NEPTUNIUM_VICTORY_THOUSANDTHS) {
      world.winnerId = p.id;
      return;
    }
  }
  // Last player standing (docs/10 §Victory Conditions). Eliminations
  // only happen inside event processing and checkVictory runs after
  // every event, so the survivor is crowned at the exact elimination
  // moment regardless of tick cadence (split-invariant).
  const alive = world.players.filter((p) => !p.eliminated);
  if (alive.length === 1 && world.players.length > 1) {
    world.winnerId = alive[0]!.id;
  }
}

/**
 * Earliest sim time ≤ `deadline` at which any player's live Neptunium
 * crosses the victory threshold at current production rates, clamped
 * to be ≥ `world.time`. Returns `null` if no crossing is due.
 *
 * The tick scheduler treats this as a candidate event so the winner
 * is crowned at the *exact* crossing moment regardless of how the
 * tick is split — production rates only change at events, so between
 * events the crossing time is a pure function of world state and the
 * result is identical for the live server's 500ms cadence and a
 * replay's event-gap-sized leaps.
 */
export function earliestVictoryCrossing(
  world: World,
  deadline: number,
): number | null {
  if (world.winnerId !== null) return null;
  let best: number | null = null;
  for (const p of world.players) {
    const t = neptuniumCrossingTime(world, p, NEPTUNIUM_VICTORY_THOUSANDTHS);
    if (t === null) continue;
    const clamped = Math.max(t, world.time);
    if (clamped > deadline) continue;
    if (best === null || clamped < best) best = clamped;
  }
  return best;
}
