import { tick, type World } from '@subterfuge/sim';

/**
 * Project a live world forward to a target sim time.
 *
 * The live world arrives via WebSocket — it is the player's filtered
 * view at the moment the server snapshotted. To show "the future", we
 * deep-clone and run the shared sim's `tick` against the clone.
 *
 * Caveats (intentional, per docs/08_time_machine.md):
 *   - This projection uses *only* the information visible to the
 *     player. Opponent moves they can't see (queued elsewhere, or
 *     subs outside their sonar) cannot be predicted.
 *   - Queued orders that ARE visible (player's own) get dispatched
 *     correctly because they're embedded in the world snapshot the
 *     server sent.
 *
 * Returns the projected world. If `targetTime <= live.time`, returns
 * a clone of the live world unchanged.
 */
export function project(live: World, targetTime: number): World {
  const cloned = structuredClone(live) as World;
  const dt = targetTime - cloned.time;
  if (dt > 0) {
    tick(cloned, dt);
  }
  return cloned;
}
