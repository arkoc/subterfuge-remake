import type { Coord, PlayerId, SimEvent, SimEventKind, World } from './types.js';
import { MAX_EVENTS } from './types.js';

/**
 * Emit a structured sim event. Events accumulate in `world.events`
 * and are bounded to the last `MAX_EVENTS` entries (oldest dropped
 * on overflow). Used by combat, sentry attrition, captive resolution
 * etc. to surface things in the UI.
 *
 * The optional `pos` is the world coordinate the event happened at,
 * used by the client to pulse the affected entity (outpost, encounter
 * point). Pass it when known; combat events should always have one.
 */
export function emitEvent(
  world: World,
  kind: SimEventKind,
  visibleTo: PlayerId[],
  summary: string,
  pos?: Coord,
  pos2?: Coord,
): void {
  const evt: SimEvent = {
    id: world.nextEventId,
    at: world.time,
    kind,
    visibleTo,
    summary,
    ...(pos !== undefined ? { pos } : {}),
    ...(pos2 !== undefined ? { pos2 } : {}),
  };
  world.nextEventId += 1;
  world.events.push(evt);
  // Bound the ring buffer.
  if (world.events.length > MAX_EVENTS) {
    world.events.splice(0, world.events.length - MAX_EVENTS);
  }
}

/**
 * Filter the world's event log to events visible to one viewer. Used
 * by `viewForPlayer` to give each client only the events relevant to
 * them (their own combats, their own sentries firing, etc.).
 */
export function eventsForPlayer(world: World, viewerId: PlayerId): SimEvent[] {
  return world.events.filter((e) => e.visibleTo.includes(viewerId));
}
