import type { Coord, Outpost, OutpostId, Player, PlayerId, World } from './types.js';
import {
  FACTORY_CYCLE_MS,
  HIRE_INITIAL_MS,
  MAP_SIZE,
  NEVER_PRODUCE,
  STARTING_DRILLERS,
  STARTING_OUTPOSTS_PER_PLAYER,
  TOTAL_OUTPOSTS_PER_PLAYER_SLOT,
} from './types.js';
import { type Rng, createRng } from './rng.js';
import { distSquared } from './geometry.js';
import { OUTPOST_NAMES } from './outpost-names.js';
import { createSpecialist } from './specialists.js';
import { playerHireSeed } from './hiring.js';

export interface GenerateWorldOptions {
  readonly seed: number;
  readonly playerCount: number;
}

/**
 * Generate a fresh world deterministically from `seed` and `playerCount`.
 *
 * Layout:
 *   1. Place `playerCount` starting points on a centered circle.
 *   2. Place `playerCount * 10` outposts with a simple repulsion pass
 *      so they spread out.
 *   3. Each player claims the 5 nearest outposts. The nearest of those
 *      becomes the Queen's home; the other 4 get 40 drillers each.
 *
 * The 500-iteration balanced placement from the docs is deferred to
 * Phase 15 polish — this simpler generator is enough for everything up
 * to and including a full playable game.
 */
export function generateWorld(opts: GenerateWorldOptions): World {
  if (opts.playerCount < 2) {
    throw new Error(`playerCount must be >= 2, got ${opts.playerCount}`);
  }
  if (opts.playerCount > 10) {
    throw new Error(`playerCount must be <= 10, got ${opts.playerCount}`);
  }
  if (!Number.isInteger(opts.seed)) {
    throw new Error(`seed must be an integer, got ${opts.seed}`);
  }

  const rng = createRng(opts.seed);
  const players = makePlayers(opts.playerCount, opts.seed);
  const playerStarts = makePlayerStarts(opts.playerCount);

  const totalOutposts = opts.playerCount * TOTAL_OUTPOSTS_PER_PLAYER_SLOT;
  const positions = scatterOutpostPositions(totalOutposts, rng);
  const outposts = makeOutposts(positions, rng);
  const queenHomes = assignStartingOutposts(outposts, playerStarts, players);

  const world: World = {
    seed: opts.seed,
    players,
    outposts,
    subs: [],
    nextSubId: 0,
    specialists: [],
    nextSpecialistId: 0,
    queuedOrders: [],
    nextQueuedOrderId: 0,
    pendingCommands: [],
    nextPendingCommandId: 0,
    messages: [],
    nextMessageId: 0,
    events: [],
    nextEventId: 0,
    time: 0,
    winnerId: null,
  };

  // Spawn each player's starting Queen at their Queen-home outpost.
  // From here on the Queen is "just another specialist" — she can
  // ride subs, captured, promoted from a Princess, etc.
  for (let i = 0; i < players.length; i++) {
    const home = queenHomes[i]!;
    createSpecialist(world, players[i]!.id, 'queen', { kind: 'outpost', id: home });
  }

  // Initialise each player's discovered-outposts set with their own
  // starting outposts. They'll discover more as their sonar bubbles
  // sweep the map; persistent visibility means once seen, an outpost
  // is locked on their map permanently.
  for (const p of world.players) {
    for (const o of world.outposts) {
      if (o.ownerId === p.id) {
        p.knownOutposts.push(o.id as unknown as number);
      }
    }
  }

  return world;
}

function makePlayers(count: number, worldSeed: number): Player[] {
  const players: Player[] = [];
  for (let i = 0; i < count; i++) {
    players.push({
      id: i as PlayerId,
      name: `Player ${i + 1}`,
      neptuniumMg: 0,
      neptuniumLastAt: 0,
      minesDrilled: 0,
      nextHireAt: HIRE_INITIAL_MS,
      hireSeed: playerHireSeed(worldSeed, i as PlayerId),
      hireIndex: 0,
      lastOfferedKinds: [],
      eliminated: false,
      knownOutposts: [],
    });
  }
  return players;
}

/**
 * Place players on an evenly-spaced circle so every game starts roughly
 * symmetric. Phase 15 will use the proper 500-candidate balanced layout.
 */
function makePlayerStarts(count: number): Coord[] {
  const starts: Coord[] = [];
  const cx = MAP_SIZE / 2;
  const cy = MAP_SIZE / 2;
  const radius = MAP_SIZE * 0.35;
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    starts.push({
      x: Math.round(cx + radius * Math.cos(angle)),
      y: Math.round(cy + radius * Math.sin(angle)),
    });
  }
  return starts;
}

/**
 * Scatter `count` outpost positions and then push them apart so they
 * don't overlap. Pure function of `rng`'s sequence — different RNGs
 * produce different layouts.
 */
function scatterOutpostPositions(count: number, rng: Rng): Coord[] {
  const positions: { x: number; y: number }[] = [];
  for (let i = 0; i < count; i++) {
    positions.push({
      x: rng.nextInt(MAP_SIZE),
      y: rng.nextInt(MAP_SIZE),
    });
  }

  const minDist = (MAP_SIZE / Math.sqrt(count)) * 0.5;
  const minDistSq = minDist * minDist;
  const iterations = 30;

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < positions.length; i++) {
      for (let j = i + 1; j < positions.length; j++) {
        const a = positions[i]!;
        const b = positions[j]!;
        const dx = a.x - b.x;
        const dy = a.y - b.y;
        const dsq = dx * dx + dy * dy;
        if (dsq < minDistSq && dsq > 0) {
          const d = Math.sqrt(dsq);
          const push = (minDist - d) / 2;
          const px = (dx / d) * push;
          const py = (dy / d) * push;
          a.x = clamp(a.x + px);
          a.y = clamp(a.y + py);
          b.x = clamp(b.x - px);
          b.y = clamp(b.y - py);
        }
      }
    }
  }

  return positions.map((p) => ({ x: Math.round(p.x), y: Math.round(p.y) }));
}

function clamp(v: number): number {
  if (v < 0) return 0;
  if (v > MAP_SIZE - 1) return MAP_SIZE - 1;
  return v;
}

function makeOutposts(positions: Coord[], rng: Rng): Outpost[] {
  return positions.map((pos, i) => {
    const kind = rng.next() < 0.5 ? 'factory' : 'generator';
    // Stagger factory phases so production is smooth across the game
    // rather than every factory pulsing in lockstep. Generators do not
    // produce so their value is the sentinel.
    const phaseOffset = kind === 'factory' ? rng.nextInt(FACTORY_CYCLE_MS) : NEVER_PRODUCE;
    return {
      id: i as OutpostId,
      pos,
      name: OUTPOST_NAMES[i % OUTPOST_NAMES.length] ?? `Outpost ${i}`,
      kind,
      shieldKind: rng.next() < 0.7 ? 'weak' : 'strong',
      ownerId: null,
      drillers: 0,
      shieldCharge: 0,
      shieldChargedSince: 0,
      nextProductionAt: phaseOffset,
    };
  });
}

/**
 * Each player claims the 5 nearest outposts to their start point. The
 * nearest becomes the Queen's spawn outpost (returned at index `i` so
 * the caller can place the Queen specialist there); the other 4 get 40
 * starting drillers. Claims are resolved player-by-player so two
 * players can't double-claim the same outpost.
 */
function assignStartingOutposts(
  outposts: Outpost[],
  playerStarts: Coord[],
  players: Player[],
): OutpostId[] {
  const claimed = new Set<number>();
  const queenHomes: OutpostId[] = [];

  for (let p = 0; p < playerStarts.length; p++) {
    const start = playerStarts[p]!;
    const playerId = players[p]!.id;

    const candidates: { idx: number; dsq: number }[] = [];
    for (let i = 0; i < outposts.length; i++) {
      if (claimed.has(i)) continue;
      candidates.push({ idx: i, dsq: distSquared(outposts[i]!.pos, start) });
    }
    candidates.sort((a, b) => a.dsq - b.dsq);

    for (let i = 0; i < STARTING_OUTPOSTS_PER_PLAYER && i < candidates.length; i++) {
      const claim = candidates[i]!;
      claimed.add(claim.idx);
      const outpost = outposts[claim.idx]!;
      outpost.ownerId = playerId;
      if (i === 0) {
        queenHomes.push(outpost.id);
        outpost.drillers = 0;
      } else {
        outpost.drillers = STARTING_DRILLERS;
      }
    }
  }

  return queenHomes;
}
