import type {
  Outpost,
  OutpostId,
  Player,
  PlayerId,
  Specialist,
  Sub,
  World,
} from './types.js';
import { NEVER_PRODUCE, SONAR_RANGE } from './types.js';
import { distSquared } from './geometry.js';
import { subPosition } from './subs.js';
import { activeCountOf, specialistsAtOutpost } from './specialists.js';
import { eventsForPlayer } from './events.js';

/**
 * Fog of war (per docs/07_shields_sonar_visibility.md).
 *
 * The authoritative `World` on the server contains everything. Each
 * connected player should only ever see a *filtered* view of it —
 * the union of:
 *
 *   - every outpost they own (full info)
 *   - every other outpost within sonar of one of their outposts
 *   - every Mine on the map (global visibility — only id, pos, owner,
 *     kind; garrison/shield/queen redacted)
 *   - every sub they own
 *   - every other sub currently within their sonar
 *
 * `viewForPlayer` returns a new `World`-shaped object containing only
 * these. The server sends this to each WebSocket client; the client
 * renders it directly.
 *
 * NB: the "discovered location" persistence from the docs ("first sight
 * locks the position on the map forever") is intentionally deferred —
 * we just do current-sonar visibility for now. Adding discovery later
 * is a matter of tracking a per-player Set<OutpostId>.
 */

export const SONAR_RANGE_SQ = SONAR_RANGE * SONAR_RANGE;

/**
 * Effective sonar radius for one outpost (map units), accounting for
 * specialist modifiers:
 *
 *   - Intelligence Officer (global, additive): +25% per IO owned.
 *   - Princess (local): +50% if at least one Princess is at the
 *     outpost (multiple don't stack).
 *
 * Per docs/05_specialists.md §6 (Princess) and §9.1 (IO).
 */
export function sonarRange(world: World, outpost: Outpost): number {
  if (outpost.ownerId === null) return SONAR_RANGE;
  const ownerId = outpost.ownerId;
  let mult = 1.0;
  // IO global, additive per IO owned by this player.
  mult += 0.25 * activeCountOf(world, ownerId, 'intelligence_officer');
  // Princess local: +50% if any Princess is at this outpost (no stacking).
  const here = specialistsAtOutpost(world, outpost.id);
  if (
    here.some(
      (s) =>
        s.kind === 'princess' && s.state === 'active' && s.ownerId === ownerId,
    )
  ) {
    mult += 0.5;
  }
  return SONAR_RANGE * mult;
}

export function outpostsInSonarOf(world: World, viewerId: PlayerId): Set<OutpostId> {
  const owned = world.outposts.filter((o) => o.ownerId === viewerId);
  // Precompute squared sonar radius per owned outpost once; sonarRange
  // is otherwise O(specialists) per call and was firing N × |owned|
  // times.
  const r2: number[] = owned.map((o) => {
    const r = sonarRange(world, o);
    return r * r;
  });
  const visible = new Set<OutpostId>();
  for (const candidate of world.outposts) {
    if (candidate.ownerId === viewerId) {
      visible.add(candidate.id);
      continue;
    }
    for (let i = 0; i < owned.length; i++) {
      if (distSquared(owned[i]!.pos, candidate.pos) <= r2[i]!) {
        visible.add(candidate.id);
        break;
      }
    }
  }
  return visible;
}

export function subsInSonarOf(world: World, viewerId: PlayerId, now: number): Set<number> {
  const owned = world.outposts.filter((o) => o.ownerId === viewerId);
  const r2: number[] = owned.map((o) => {
    const r = sonarRange(world, o);
    return r * r;
  });
  const visible = new Set<number>();
  for (const sub of world.subs) {
    if (sub.ownerId === viewerId) {
      visible.add(sub.id as unknown as number);
      continue;
    }
    const pos = subPosition(world, sub, now);
    for (let i = 0; i < owned.length; i++) {
      if (distSquared(owned[i]!.pos, pos) <= r2[i]!) {
        visible.add(sub.id as unknown as number);
        break;
      }
    }
  }
  return visible;
}

/**
 * Build the per-player view of the world. Returns a World-shaped
 * object suitable for sending over the wire to that player.
 *
 * Outpost visibility model (simplified from the docs for clarity):
 *   - Inside any of the player's sonar bubbles → full info (kind,
 *     garrison, shield, queen status, specialists later).
 *   - Outside sonar → location + owner colour only. Everything else
 *     redacted; rendered client-side as a dim colour-coded dot.
 *
 * Sub visibility is still strict per-sonar: you only see hostile subs
 * that are currently within one of your sonar bubbles.
 */
export function viewForPlayer(world: World, viewerId: PlayerId): World {
  const visible = outpostsInSonarOf(world, viewerId);
  const visibleSubs = subsInSonarOf(world, viewerId, world.time);

  // Outposts are *common knowledge*: every player sees every
  // outpost's position, kind, name, and current owner. Fog of war
  // applies only to the outpost's *internal* state (garrison,
  // shield charge, specialists at the outpost) and to in-flight
  // subs.
  //
  // NB: this function is a pure read — it must never mutate the
  // canonical world it filters. (It used to rewrite the viewer's
  // `knownOutposts` here; that field no longer drives visibility
  // and writing it from a view builder made persisted snapshot
  // bytes depend on which views happened to be requested.)

  // Outposts in current sonar pass through with full info; the rest
  // pass through `foggedOutpost` which preserves the always-visible
  // fields and redacts the rest.
  const outposts: Outpost[] = [];
  for (const o of world.outposts) {
    if (visible.has(o.id)) {
      outposts.push(o);
    } else {
      outposts.push(foggedOutpost(o));
    }
  }

  const subs: Sub[] = world.subs.filter((s) =>
    visibleSubs.has(s.id as unknown as number),
  );

  // Specialists are visible when their container is visible to the viewer.
  // Captives held by the viewer are always visible (the viewer is the
  // holder). Specialists on subs the viewer can't see are hidden.
  const specialists: Specialist[] = world.specialists.filter((s) => {
    if (s.ownerId === viewerId) return true; // always see your own
    if (s.state === 'captive' && s.captiveOf === viewerId) return true;
    if (s.location.kind === 'outpost') {
      return visible.has(s.location.id);
    }
    return visibleSubs.has(s.location.id as unknown as number);
  });

  // Filter chat: global + viewer's DMs
  const messages = world.messages.filter(
    (m) => m.to === null || m.to === viewerId || m.from === viewerId,
  );

  // Pending commands are private to their issuer — no one else needs
  // to know that an enemy is mid-promotion or about to redirect a sub.
  const pendingCommands = world.pendingCommands.filter(
    (p) => p.ownerId === viewerId,
  );

  // Queued Time-Machine orders are equally private (docs/08: "Other
  // players' Time Machines are private. Their queued orders are
  // invisible to you.").
  const queuedOrders = world.queuedOrders.filter(
    (q) => q.ownerId === viewerId,
  );

  // Player records carry private fields. The viewer keeps their own
  // record intact (the client computes its own hire roster locally
  // from `hireSeed`/`hireIndex`/`lastOfferedKinds`); everyone else's
  // hire-RNG state and discovery memory are zeroed. Public fields
  // (name, neptunium, minesDrilled, eliminated, nextHireAt)
  // pass through — the Neptunium race is deliberately legible
  // (docs/07).
  const players: Player[] = world.players.map((p) =>
    p.id === viewerId
      ? p
      : {
          ...p,
          hireSeed: 0,
          hireIndex: 0,
          lastOfferedKinds: [],
          knownOutposts: [],
        },
  );

  return {
    ...world,
    // The world seed must never reach a client: combined with a
    // player id it derives that player's entire hire-offer stream
    // (and regenerates the map's hidden initial state).
    seed: 0,
    players,
    outposts,
    subs,
    specialists,
    messages,
    pendingCommands,
    queuedOrders,
    events: eventsForPlayer(world, viewerId),
  };
}

/**
 * Server-side redaction for outposts not currently in the viewer's
 * sonar. Preserves the "common knowledge" fields (position, kind,
 * name, owner — every player sees these for every outpost on the
 * map) and redacts the sonar-gated internal state (garrison, shield
 * charge, specialists, factory cycle phase).
 */
function foggedOutpost(o: Outpost): Outpost {
  return {
    id: o.id,
    pos: o.pos,
    name: o.name,
    kind: o.kind,
    shieldKind: 'weak',
    ownerId: o.ownerId,
    drillers: 0,
    shieldCharge: 0,
    shieldChargedSince: 0,
    nextProductionAt: NEVER_PRODUCE,
    fogged: true,
  };
}
