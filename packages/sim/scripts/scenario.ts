/**
 * sim:scenario — run a scripted demonstration of a sim phase.
 *
 *   pnpm sim:scenario phase3
 *
 * Each scenario constructs a world, issues some orders, advances time,
 * and prints the state at interesting moments. The point is to give a
 * human-readable demonstration that a phase works end-to-end.
 */

import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  type Outpost,
  type Player,
  type PlayerId,
  type World,
  dist,
  generateWorld,
  hasQueenAt,
  issueDrillOrder,
  issueLaunchOrder,
  liveNeptuniumThousandths,
  renderWorldAscii,
  summarizeWorld,
  tick,
} from '../src/index.js';

function main(): void {
  const scenarioName = process.argv[2];
  if (!scenarioName) {
    console.error('Usage: sim:scenario <name>');
    console.error('Available scenarios: phase3, phase4');
    process.exit(2);
  }
  switch (scenarioName) {
    case 'phase3':
      runPhase3();
      break;
    case 'phase4':
      runPhase4();
      break;
    default:
      console.error(`Unknown scenario: ${scenarioName}`);
      process.exit(2);
  }
}

function runPhase3(): void {
  const world = generateWorld({ seed: 42, playerCount: 4 });
  const playerA = world.players[0]!;

  const aOutposts = world.outposts.filter((o) => o.ownerId === playerA.id);
  // Pick the largest-driller (non-Queen) outpost as the launch source.
  const source = aOutposts
    .filter((o) => !hasQueenAt(world, o.id))
    .sort((a, b) => b.drillers - a.drillers)[0]!;

  // Nearest dormant outpost to `source`.
  const target = nearestDormant(world, source);
  if (target === undefined) {
    throw new Error('No dormant outposts found near player A');
  }

  banner(`Phase 3 — sub launch and dormant capture`);
  console.log(
    `Player A will launch a sub from ${source.name} (id ${source.id}, drillers ${source.drillers})`,
  );
  console.log(
    `  to nearby dormant ${target.name} (id ${target.id}) — distance ${Math.round(dist(source.pos, target.pos))} units.`,
  );
  console.log();

  banner(`t=0 (before launch)`);
  printState(world);

  const subId = issueLaunchOrder(world, {
    ownerId: playerA.id,
    sourceId: source.id,
    destinationId: target.id,
    drillers: 30,
  });
  console.log();
  console.log(`Launch order issued: sub #${subId} (30 drillers)`);
  console.log();

  // Sample times: just queued, just launched, mid-flight, after arrival.
  advanceAndShow(world, 5 * MINUTE_MS, 'still in 10-min launch queue');
  advanceAndShow(world, 10 * MINUTE_MS, 'just launched');
  const sub = world.subs[0];
  if (sub !== undefined) {
    const midFlightDelta = Math.round((sub.arrivalAt - world.time) / 2);
    advanceAndShow(world, midFlightDelta, 'mid-flight');
  }
  // Advance to just past arrival.
  if (world.subs.length > 0) {
    const arriveDelta = world.subs[0]!.arrivalAt - world.time + 1;
    advanceAndShow(world, arriveDelta, 'just arrived');
  } else {
    advanceAndShow(world, DAY_MS, 'after arrival');
  }

  // Show the captured outpost details.
  const captured = world.outposts[target.id as unknown as number]!;
  banner(`Result`);
  console.log(
    `  ${captured.name} is now owned by ${playerLetter(captured.ownerId, world.players)} with ${captured.drillers} drillers.`,
  );
  console.log(`  Active subs remaining: ${world.subs.length}`);
}

function advanceAndShow(world: World, dtMs: number, label: string): void {
  tick(world, dtMs);
  banner(`t=${formatNow(world)} — ${label}`);
  printState(world);
}

function printState(world: World): void {
  console.log(summarizeWorld(world));
  console.log();
  console.log(renderWorldAscii(world, 80, 24));
  console.log();
}

function nearestDormant(world: World, from: Outpost): Outpost | undefined {
  let best: Outpost | undefined;
  let bestD = Number.POSITIVE_INFINITY;
  for (const o of world.outposts) {
    if (o.ownerId !== null) continue;
    const d = dist(o.pos, from.pos);
    if (d < bestD) {
      bestD = d;
      best = o;
    }
  }
  return best;
}

function banner(s: string): void {
  console.log(`\n=== ${s} ===`);
}

function formatNow(world: World): string {
  const t = world.time;
  const hours = Math.floor(t / HOUR_MS);
  const mins = Math.floor((t % HOUR_MS) / MINUTE_MS);
  if (hours === 0) return `${mins}m`;
  return mins === 0 ? `${hours}h` : `${hours}h${mins}m`;
}

/**
 * Phase 4 scenario: drill some mines, race the clock, win by 200 kg.
 *
 * We tilt the scales so a player can plausibly win in scenario length
 * (a few "days" of sim time): pre-load drillers and pre-drill mines for
 * Player A, then watch Neptunium climb.
 */
function runPhase4(): void {
  const world = generateWorld({ seed: 42, playerCount: 4 });
  const playerA = world.players[0]!;

  banner('Phase 4 — drill mines, accrue Neptunium, win by 200 kg');
  console.log('Player A pre-loads drillers and drills 3 mines.');
  console.log();

  // Pre-load A's non-Queen Factories/Generators with drillers so we can
  // drill quickly without waiting for production.
  const aOwned = world.outposts.filter(
    (o) => o.ownerId === playerA.id && !hasQueenAt(world, o.id),
  );
  for (const o of aOwned) {
    o.drillers = 500;
  }

  banner('t=0 — pre-drill');
  printState(world);

  // Drill the 3 best Factory/Generator outposts.
  const drillTargets = aOwned.slice(0, 3);
  for (const o of drillTargets) {
    issueDrillOrder(world, { ownerId: playerA.id, outpostId: o.id });
    console.log(
      `  drilled ${o.name} → mine (player now has ${playerA.minesDrilled} mines drilled)`,
    );
  }
  console.log();

  banner(`t=0 — after drilling 3 mines`);
  printState(world);

  // Now race the clock. With 3 mines × (5 starting outposts) = 15 kg/day,
  // it takes ~14 days to hit 200 kg. Fast-forward in chunks of 2 days.
  let day = 0;
  while (world.winnerId === null && day < 30) {
    tick(world, 2 * DAY_MS);
    day += 2;
    const live = liveNeptuniumThousandths(world, world.players[0]!, world.time) / 1000;
    console.log(`  day ${day}: A=${live.toFixed(2)} kg`);
  }

  banner(`Result at t=${formatNow(world)}`);
  if (world.winnerId !== null) {
    const winner = world.players[world.winnerId as unknown as number]!;
    console.log(`  *** ${winner.name} wins! ***`);
  } else {
    console.log('  No winner yet — game still running.');
  }
  console.log();
  printState(world);
}

function playerLetter(playerId: PlayerId | null, players: readonly Player[]): string {
  if (playerId === null) return 'dormant';
  const p = players.find((pp) => pp.id === playerId);
  if (!p) return `player(${playerId})`;
  return String.fromCharCode('A'.charCodeAt(0) + playerId);
}

main();
