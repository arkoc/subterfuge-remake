/**
 * Multi-game hosting (Phase A, doc 22).
 *
 * One `GameHost` per running world: owns the canonical World, its
 * event-log watermark, the connected WS clients, and the persistence
 * cadence that main.ts used to keep in module-level singletons for the
 * single hardcoded game. The registry loads every ACTIVE game at boot
 * (async games must tick with nobody connected) and lazily on demand.
 *
 * All the event-sourcing invariants are unchanged — they just moved:
 * append-before-ACK, fail-stop on append failure, snapshot saves as
 * cache on a short cadence, boot recovery replaying the log tail, and
 * epoch promotion on sim-version change.
 */

import type { WebSocket as WsWebSocket } from 'ws';
import type pino from 'pino';
import {
  applyEvent,
  tick,
  viewForPlayer,
  SIM_VERSION,
  type GameEvent,
  type PlayerId,
  type World,
} from '@subterfuge/sim';
import type { GameStore, GameConfig } from './db.js';

const PERSIST_EVERY_TICKS = 4; // ~2s at the 500ms tick
const CHECKPOINT_INTERVAL_MS = 60 * 60 * 1000; // 1 sim hour
const MAX_CHECKPOINTS_PER_GAME = 30;

export interface ClientMeta {
  ws: WsWebSocket;
  /** Seat the connection is authenticated as; null = spectator (DEV). */
  playerId: PlayerId | null;
}

type GameEventInput = GameEvent extends infer E
  ? E extends { simAt: number }
    ? Omit<E, 'simAt'>
    : never
  : never;

export class GameHost {
  readonly id: number;
  readonly world: World;
  readonly simSpeed: number;
  lastEventId: number;
  readonly clients = new Set<ClientMeta>();
  private ticksSinceSave = 0;
  private lastCheckpointSimAt: number;
  /** Set once when the world's winner is first observed; main.ts uses
   *  it to flip the games row to 'finished' exactly once. */
  finishedRecorded = false;

  constructor(
    private readonly store: GameStore,
    private readonly log: pino.Logger,
    id: number,
    world: World,
    lastEventId: number,
    config: GameConfig,
  ) {
    this.id = id;
    this.world = world;
    this.lastEventId = lastEventId;
    this.simSpeed = config.simSpeed;
    this.lastCheckpointSimAt = world.time;
    // Seed a checkpoint at load so the first scrub-back doesn't replay
    // from the epoch baseline.
    store.insertCheckpoint(id, world, lastEventId);
  }

  /**
   * Append a GameEvent to the audit log. FAIL-STOP on append failure:
   * the in-memory world would contain a mutation the authoritative log
   * cannot reproduce — crash now, recover from the log at boot.
   */
  recordEvent(input: GameEventInput): void {
    const full = { ...input, simAt: this.world.time } as GameEvent;
    try {
      this.lastEventId = this.store.appendEvent(this.id, full);
    } catch (e) {
      this.log.fatal(
        { err: e instanceof Error ? e.stack : String(e), kind: full.kind, gameId: this.id },
        'event-log append failed — fail-stopping to preserve log/world consistency',
      );
      process.exit(1);
    }
  }

  stateMessageFor(playerId: PlayerId | null): string {
    const view =
      playerId === null
        ? { ...this.world, seed: 0 }
        : viewForPlayer(this.world, playerId);
    return JSON.stringify({ type: 'state', world: view });
  }

  /** Per-player filtered broadcast; view+serialisation shared per seat. */
  broadcast(): void {
    const cache = new Map<PlayerId | null, string>();
    for (const meta of this.clients) {
      if (meta.ws.readyState !== meta.ws.OPEN) continue;
      let msg = cache.get(meta.playerId);
      if (msg === undefined) {
        msg = this.stateMessageFor(meta.playerId);
        cache.set(meta.playerId, msg);
      }
      meta.ws.send(msg);
    }
  }

  persist(force = false): void {
    this.ticksSinceSave += 1;
    if (force || this.ticksSinceSave >= PERSIST_EVERY_TICKS) {
      this.store.saveGame(this.id, this.world, this.lastEventId);
      this.ticksSinceSave = 0;
    }
  }

  private maybeCheckpoint(): void {
    if (this.world.time - this.lastCheckpointSimAt < CHECKPOINT_INTERVAL_MS) return;
    this.store.insertCheckpoint(this.id, this.world, this.lastEventId);
    this.store.trimCheckpoints(this.id, MAX_CHECKPOINTS_PER_GAME);
    this.lastCheckpointSimAt = this.world.time;
  }

  /** One wall-clock tick: advance the sim, push state, persist. */
  tickOnce(realMs: number): void {
    if (this.world.winnerId !== null) return;
    tick(this.world, realMs * this.simSpeed);
    this.broadcast();
    this.persist();
    this.maybeCheckpoint();
  }
}

export class GameRegistry {
  private readonly hosts = new Map<number, GameHost>();

  constructor(
    private readonly store: GameStore,
    private readonly log: pino.Logger,
  ) {}

  /** Load every ACTIVE game at boot so async games keep ticking with
   *  zero connections. */
  loadActive(): void {
    for (const id of this.store.listActiveGameIds()) {
      try {
        this.get(id);
      } catch (e) {
        this.log.error(
          { gameId: id, err: e instanceof Error ? e.stack : String(e) },
          'failed to load active game at boot — skipped',
        );
      }
    }
    this.log.info({ games: this.hosts.size }, 'active games loaded');
  }

  has(id: number): boolean {
    return this.hosts.has(id);
  }

  all(): Iterable<GameHost> {
    return this.hosts.values();
  }

  /** Get a host, loading (with boot recovery) from the store. Throws
   *  if the id has no started world (unknown game or still a lobby). */
  get(id: number): GameHost {
    const existing = this.hosts.get(id);
    if (existing !== undefined) return existing;

    const persisted = this.store.gameById(id);
    if (persisted === null) throw new Error(`game ${id} has no started world`);
    const meta = this.store.gameMetaById(id);
    if (meta === null) throw new Error(`game ${id} not found`);

    // Boot recovery — replay the event-log tail newer than the
    // snapshot watermark so no ACKed order is ever lost.
    const world = persisted.world;
    let lastEventId = persisted.lastEventId;
    let tailVersionMismatch = false;
    const tail = this.store.listEventsAfterId(id, lastEventId);
    for (const stored of tail) {
      lastEventId = stored.id;
      if (stored.simVersion !== SIM_VERSION) {
        tailVersionMismatch = true;
        this.log.warn(
          { gameId: id, eventId: stored.id, eventVersion: stored.simVersion },
          'recovery: applying event from a different sim version (epoch will be promoted)',
        );
      }
      if (stored.simAt > world.time) tick(world, stored.simAt - world.time);
      const drop = applyEvent(world, stored.event);
      if (drop !== null) {
        this.log.warn({ gameId: id, eventId: stored.id, drop }, 'recovery: event dropped by sim');
      }
    }
    if (tail.length > 0) {
      this.store.saveGame(id, world, lastEventId);
      this.log.info({ gameId: id, tail: tail.length, time: world.time }, 'recovery: log tail replayed');
    }
    // Epoch promotion on sim-version change.
    if (persisted.simVersion !== SIM_VERSION || tailVersionMismatch) {
      this.store.deleteCheckpoints(id);
      this.store.insertBaseline(id, world, lastEventId);
      this.store.saveGame(id, world, lastEventId);
      this.log.warn(
        { gameId: id, fromVersion: persisted.simVersion, toVersion: SIM_VERSION },
        'sim version changed — promoted live world to new epoch baseline',
      );
    }

    const host = new GameHost(this.store, this.log, id, world, lastEventId, meta.config);
    this.hosts.set(id, host);
    return host;
  }

  /** Register a freshly started (lobby→active) game's world. */
  adopt(id: number, world: World, config: GameConfig): GameHost {
    const host = new GameHost(this.store, this.log, id, world, 0, config);
    this.hosts.set(id, host);
    return host;
  }

  tickAll(realMs: number): void {
    for (const host of this.hosts.values()) {
      try {
        host.tickOnce(realMs);
      } catch (e) {
        this.log.error(
          { gameId: host.id, err: e instanceof Error ? e.stack : String(e) },
          'tick failed — game state unchanged for this tick',
        );
      }
    }
  }

  persistAll(): void {
    for (const host of this.hosts.values()) host.persist(true);
  }
}
