import type { Outpost, OutpostId, Player, PlayerId, World } from './types.js';

/**
 * Lookup helpers that don't pull in any other sim module. Putting them
 * here breaks the dependency cycle that would otherwise form between
 * subs ↔ combat ↔ mining (all of which need to look up by id).
 */

export function outpostById(world: World, id: OutpostId): Outpost {
  // Fast path: outposts are appended in id order at world-gen and never
  // re-ordered, so direct indexing usually works.
  const o = world.outposts[id as unknown as number];
  if (o !== undefined && o.id === id) return o;
  const found = world.outposts.find((x) => x.id === id);
  if (found === undefined) throw new Error(`Outpost ${id} not found`);
  return found;
}

export function playerById(world: World, id: PlayerId): Player {
  const p = world.players[id as unknown as number];
  if (p !== undefined && p.id === id) return p;
  const found = world.players.find((x) => x.id === id);
  if (found === undefined) throw new Error(`Player ${id} not found`);
  return found;
}
