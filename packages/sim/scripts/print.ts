/**
 * sim:print — generate a world and print it.
 *
 * Lives outside `src/` so it can use Node APIs (process, console). The
 * sim library itself stays pure; this CLI is just a dev/demo entrypoint.
 *
 *   pnpm sim:print
 *   pnpm sim:print --seed 1 --players 6
 *   pnpm sim:print --seed 42 --players 4 --summary
 *   pnpm sim:print --seed 42 --players 4 --json
 */

import {
  DAY_MS,
  HOUR_MS,
  MINUTE_MS,
  SECOND_MS,
  generateWorld,
  renderWorldAscii,
  summarizeWorld,
  tick,
} from '../src/index.js';

interface Args {
  seed: number;
  players: number;
  mode: 'ascii' | 'json' | 'summary';
  width: number;
  height: number;
  /** Milliseconds to advance the sim before rendering. Default 0. */
  advanceMs: number;
}

/** Parse a duration string like "8h", "2d", "30min", "5s", or plain ms. */
function parseDuration(s: string): number {
  const m = /^(\d+(?:\.\d+)?)(ms|s|min|h|d)?$/.exec(s);
  if (!m) {
    throw new Error(`Invalid duration: ${s} (expected e.g. 8h, 2d, 30min, 5s, 500ms)`);
  }
  const n = Number.parseFloat(m[1]!);
  const unit = m[2] ?? 'ms';
  switch (unit) {
    case 'ms':
      return Math.round(n);
    case 's':
      return Math.round(n * SECOND_MS);
    case 'min':
      return Math.round(n * MINUTE_MS);
    case 'h':
      return Math.round(n * HOUR_MS);
    case 'd':
      return Math.round(n * DAY_MS);
    default:
      throw new Error(`Unknown duration unit: ${unit}`);
  }
}

function parseArgs(argv: string[]): Args {
  const out: Args = {
    seed: 42,
    players: 4,
    mode: 'ascii',
    width: 80,
    height: 30,
    advanceMs: 0,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) {
        throw new Error(`Missing value for ${a}`);
      }
      return v;
    };
    switch (a) {
      case '--seed':
        out.seed = Number.parseInt(next(), 10);
        break;
      case '--players':
        out.players = Number.parseInt(next(), 10);
        break;
      case '--width':
        out.width = Number.parseInt(next(), 10);
        break;
      case '--height':
        out.height = Number.parseInt(next(), 10);
        break;
      case '--advance':
        out.advanceMs = parseDuration(next());
        break;
      case '--json':
        out.mode = 'json';
        break;
      case '--summary':
        out.mode = 'summary';
        break;
      case '--ascii':
        out.mode = 'ascii';
        break;
      case '-h':
      case '--help':
        console.log(USAGE);
        process.exit(0);
        break;
      default:
        console.error(`Unknown option: ${a}`);
        console.error(USAGE);
        process.exit(2);
    }
  }
  return out;
}

const USAGE = `Usage: sim:print [options]

Generates a Subterfuge world and prints it.

Options:
  --seed <n>        RNG seed (default: 42)
  --players <n>     Number of players, 2..10 (default: 4)
  --advance <dur>   Advance the sim by a duration before printing.
                    Accepts ms, s, min, h, d. Examples: 8h, 24h, 7d, 30min.
  --width <n>       ASCII width (default: 80)
  --height <n>      ASCII height (default: 30)
  --ascii           Render as ASCII map + summary (default)
  --summary         Print only the summary
  --json            Print the world as JSON
  -h, --help        Show this help`;

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const world = generateWorld({ seed: args.seed, playerCount: args.players });

  if (args.advanceMs > 0) {
    tick(world, args.advanceMs);
  }

  switch (args.mode) {
    case 'json':
      console.log(JSON.stringify(world, null, 2));
      break;
    case 'summary':
      console.log(summarizeWorld(world));
      break;
    case 'ascii':
      console.log(summarizeWorld(world));
      console.log();
      console.log(renderWorldAscii(world, args.width, args.height));
      break;
  }
}

main();
