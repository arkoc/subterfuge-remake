import type { World } from './types.js';
import { HOUR_MS, MAP_SIZE, MINUTE_MS, SECOND_MS } from './types.js';
import { subPosition, subStatus } from './subs.js';
import { outpostById } from './queries.js';
import { liveNeptuniumThousandths, mineCount } from './mining.js';
import { hasQueenAt, queenOutpostOf } from './specialists.js';

/**
 * Render the world as an ASCII map.
 *
 * Each owned outpost is drawn as a letter (A, B, C, ... per player).
 * The Queen's home is rendered in lowercase. Dormant outposts are `.`.
 * Output is a single string with newline-separated rows.
 */
export function renderWorldAscii(world: World, width = 80, height = 30): string {
  const grid: string[][] = [];
  for (let y = 0; y < height; y++) {
    grid.push(new Array<string>(width).fill(' '));
  }

  // Draw subs first so outposts always render on top of a sub that
  // happens to share a cell with one.
  for (const sub of world.subs) {
    if (subStatus(sub, world.time) === 'queued') continue; // still docked
    const pos = subPosition(world, sub, world.time);
    const gx = Math.floor((pos.x / MAP_SIZE) * width);
    const gy = Math.floor((pos.y / MAP_SIZE) * height);
    const cx = Math.max(0, Math.min(width - 1, gx));
    const cy = Math.max(0, Math.min(height - 1, gy));
    grid[cy]![cx] = '*';
  }

  const sortedOutposts = [...world.outposts].sort((a, b) => {
    // Dormant first so owned outposts overwrite them at the same cell.
    if (a.ownerId === null && b.ownerId !== null) return -1;
    if (a.ownerId !== null && b.ownerId === null) return 1;
    return 0;
  });

  for (const o of sortedOutposts) {
    const gx = Math.floor((o.pos.x / MAP_SIZE) * width);
    const gy = Math.floor((o.pos.y / MAP_SIZE) * height);
    const cx = Math.max(0, Math.min(width - 1, gx));
    const cy = Math.max(0, Math.min(height - 1, gy));
    let ch: string;
    if (o.ownerId === null) {
      ch = '.';
    } else {
      const letter = String.fromCharCode('A'.charCodeAt(0) + o.ownerId);
      ch = hasQueenAt(world, o.id) ? letter.toLowerCase() : letter;
    }
    grid[cy]![cx] = ch;
  }

  const top = '+' + '-'.repeat(width) + '+';
  const lines: string[] = [top];
  for (const row of grid) {
    lines.push('|' + row.join('') + '|');
  }
  lines.push(top);
  return lines.join('\n');
}

/**
 * One-paragraph human summary of the world: counts per player, dormant
 * count, total drillers.
 */
export function summarizeWorld(world: World): string {
  const lines: string[] = [];
  lines.push(
    `World seed=${world.seed} players=${world.players.length} outposts=${world.outposts.length} time=${world.time}ms`,
  );
  for (const p of world.players) {
    const owned = world.outposts.filter((o) => o.ownerId === p.id);
    const queenHere = queenOutpostOf(world, p.id) !== null ? 1 : 0;
    const totalDrillers = owned.reduce((s, o) => s + o.drillers, 0);
    const factories = owned.filter((o) => o.kind === 'factory').length;
    const generators = owned.filter((o) => o.kind === 'generator').length;
    const mines = mineCount(world, p.id);
    const liveKg = (liveNeptuniumThousandths(world, p, world.time) / 1000).toFixed(2);
    const letter = String.fromCharCode('A'.charCodeAt(0) + p.id);
    lines.push(
      `  [${letter}] ${p.name}: ${owned.length} outposts (${factories}F/${generators}G/${mines}M), queens=${queenHere}, drillers=${totalDrillers}, neptunium=${liveKg}kg`,
    );
  }
  const dormant = world.outposts.filter((o) => o.ownerId === null).length;
  lines.push(`  dormant: ${dormant}`);
  if (world.winnerId !== null) {
    const winner = world.players[world.winnerId as unknown as number];
    if (winner !== undefined) {
      lines.push(`  *** WINNER: ${winner.name} ***`);
    }
  }
  if (world.subs.length > 0) {
    lines.push(`  subs (${world.subs.length}):`);
    for (const sub of world.subs) {
      const src = outpostById(world, sub.sourceId);
      const dst = outpostById(world, sub.destinationId);
      const ownerLetter = String.fromCharCode('A'.charCodeAt(0) + sub.ownerId);
      const status = subStatus(sub, world.time);
      const etaMs = sub.arrivalAt - world.time;
      const eta = formatDuration(etaMs);
      const launchInMs = sub.launchAt - world.time;
      const launchIn = launchInMs > 0 ? ` (launches in ${formatDuration(launchInMs)})` : '';
      lines.push(
        `    #${sub.id} [${ownerLetter}] ${src.name}→${dst.name} drillers=${sub.drillers} ${status}${launchIn} arrives in ${eta}`,
      );
    }
  }
  return lines.join('\n');
}

function formatDuration(ms: number): string {
  const abs = Math.abs(ms);
  if (abs >= HOUR_MS) {
    const h = Math.floor(abs / HOUR_MS);
    const m = Math.floor((abs % HOUR_MS) / MINUTE_MS);
    return m === 0 ? `${h}h` : `${h}h${m}m`;
  }
  if (abs >= MINUTE_MS) {
    const m = Math.floor(abs / MINUTE_MS);
    const s = Math.floor((abs % MINUTE_MS) / SECOND_MS);
    return s === 0 ? `${m}m` : `${m}m${s}s`;
  }
  return `${Math.floor(abs / SECOND_MS)}s`;
}
