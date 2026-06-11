/**
 * Persistence layer — event-sourced.
 *
 * SOURCE-OF-TRUTH POLICY (the one sentence that governs this file):
 * the event log, anchored by the world seed or the latest *epoch
 * baseline*, is the ONLY authority; the `games` row and all
 * checkpoints are caches that may be deleted at any time; an order is
 * not acknowledged until its event row is durably appended; and
 * replaying the log through the deterministic sim must reproduce the
 * live world bit-for-bit (enforced by the sim's tick-split-invariance
 * property test).
 *
 * Tables:
 *
 *   - `game_events(id, game_id, sim_at, kind, payload, sim_version, created_at)`
 *     — the authoritative append-only log of external inputs (player
 *     orders, chat). Everything else in the world is
 *     derivable from `seed/baseline + events`.
 *   - `game_baselines(id, game_id, sim_at, last_event_id, sim_version, world, created_at)`
 *     — authoritative epoch anchors, NOT cache. Written at game
 *     creation (t=0) and whenever the server boots with a different
 *     SIM_VERSION than the stored game: replaying old events through
 *     new rules is semantically wrong even when the shapes parse, so
 *     the live world is promoted to the new epoch's genesis and
 *     replay never crosses below it.
 *   - `games(...)` — cache: the latest materialised world per game id,
 *     for fast boot + broadcast. Carries `last_event_id`, the id of
 *     the last event applied to the stored world.
 *   - `game_checkpoints(...)` — cache: periodic snapshots so backward
 *     time scrubbing doesn't replay from the baseline every request.
 *     Also watermarked with `last_event_id`.
 *
 * Watermarks: snapshots are cut off by event row id, never by sim
 * time — several events can share one sim timestamp (orders arriving
 * between two ticks are all stamped with the same world.time), so a
 * time-based cutoff silently drops the events stamped exactly at the
 * snapshot's time.
 *
 * Failure model: order endpoints append to the event log synchronously
 * before acknowledging; the world snapshot is persisted on a short
 * cadence (every few ticks). A crash can leave the snapshot a couple
 * of seconds behind the log; on boot the server replays the logged
 * events newer than the snapshot watermark through the deterministic
 * sim (`applyEvent`/`tick`) so no acknowledged order is ever lost. If
 * an append itself fails the server fail-stops (see `recordEvent` in
 * main.ts) rather than continue with a world the log cannot reproduce.
 */

import { existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import type { GameEvent, World } from '@subterfuge/sim';
import { playerHireSeed, SIM_VERSION } from '@subterfuge/sim';

export interface GameRow {
  id: number;
  seed: number;
  playerCount: number;
  simVersion: string;
  createdAt: number;
  updatedAt: number;
  world: World;
}

export interface PersistedGame {
  id: number;
  seed: number;
  playerCount: number;
  /** SIM_VERSION that wrote the stored snapshot. A mismatch with the
   *  running sim triggers epoch promotion at boot (see main.ts). */
  simVersion: string;
  world: World;
  /**
   * Id of the last `game_events` row that was already applied to this
   * snapshot when it was saved. Boot recovery replays every event with
   * a greater id through the sim. Using the monotonic row id (not
   * `sim_at`) makes recovery exact: multiple events can share one sim
   * timestamp, so a time-based cutoff is ambiguous at the boundary.
   */
  lastEventId: number;
}

export interface StoredEvent {
  id: number;
  simAt: number;
  event: GameEvent;
  simVersion: string;
}

export interface StoredCheckpoint {
  id: number;
  simAt: number;
  world: World;
  simVersion: string;
  /** Id of the last `game_events` row applied to this snapshot. Replay
   *  resumes from events with a strictly greater id. */
  lastEventId: number;
}

/** Authoritative epoch anchor — see the module header. Same shape as a
 *  checkpoint, but never trimmed and never rebuilt. */
export interface StoredBaseline {
  id: number;
  simAt: number;
  world: World;
  simVersion: string;
  lastEventId: number;
}

export class GameStore {
  private readonly db: Database.Database;
  private readonly insertGameStmt: Database.Statement;
  private readonly updateGameStmt: Database.Statement;
  private readonly latestGameStmt: Database.Statement;
  private readonly insertEventStmt: Database.Statement;
  private readonly listEventsAfterIdUpToStmt: Database.Statement;
  private readonly listEventsAfterIdStmt: Database.Statement;
  private readonly insertCheckpointStmt: Database.Statement;
  private readonly latestCheckpointBeforeStmt: Database.Statement;
  private readonly trimCheckpointsStmt: Database.Statement;
  private readonly deleteCheckpointsStmt: Database.Statement;
  private readonly insertBaselineStmt: Database.Statement;
  private readonly latestBaselineStmt: Database.Statement;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        seed INTEGER NOT NULL,
        player_count INTEGER NOT NULL,
        sim_version TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        world TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS games_updated_at ON games(updated_at DESC);

      CREATE TABLE IF NOT EXISTS game_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        sim_at INTEGER NOT NULL,
        kind TEXT NOT NULL,
        payload TEXT NOT NULL,
        sim_version TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS game_events_game_sim
        ON game_events(game_id, sim_at, id);

      CREATE TABLE IF NOT EXISTS game_checkpoints (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        sim_at INTEGER NOT NULL,
        last_event_id INTEGER NOT NULL DEFAULT 0,
        sim_version TEXT NOT NULL,
        world TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS game_checkpoints_game_sim
        ON game_checkpoints(game_id, sim_at);

      CREATE TABLE IF NOT EXISTS game_baselines (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        sim_at INTEGER NOT NULL,
        last_event_id INTEGER NOT NULL,
        sim_version TEXT NOT NULL,
        world TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS game_baselines_game_sim
        ON game_baselines(game_id, sim_at);

      -- Identity (Phase A): guest-first accounts + cookie sessions.
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_seen_at INTEGER NOT NULL,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);

      -- Seat assignments: which user plays which PlayerId in a game.
      CREATE TABLE IF NOT EXISTS game_seats (
        game_id INTEGER NOT NULL,
        seat INTEGER NOT NULL,
        user_id INTEGER NOT NULL,
        joined_at INTEGER NOT NULL,
        PRIMARY KEY (game_id, seat),
        FOREIGN KEY (game_id) REFERENCES games(id) ON DELETE CASCADE,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS game_seats_user ON game_seats(user_id);
    `);
    // Schema migration: backfill columns on older rows.
    const cols = this.db.prepare(`PRAGMA table_info(games)`).all() as {
      name: string;
    }[];
    if (!cols.some((c) => c.name === 'sim_version')) {
      this.db.exec(`ALTER TABLE games ADD COLUMN sim_version TEXT NOT NULL DEFAULT ''`);
    }
    if (!cols.some((c) => c.name === 'last_event_id')) {
      this.db.exec(
        `ALTER TABLE games ADD COLUMN last_event_id INTEGER NOT NULL DEFAULT 0`,
      );
      // Older rows didn't track the applied-event watermark. Best
      // effort: assume the snapshot includes everything logged so far
      // (matches the old recovery behavior of trusting the snapshot).
      this.db.exec(`
        UPDATE games SET last_event_id = COALESCE(
          (SELECT MAX(id) FROM game_events WHERE game_events.game_id = games.id), 0
        )
      `);
    }
    // Phase A migration: lobby/lifecycle columns on `games`. Legacy
    // rows (created before lobbies existed) are running worlds —
    // default them to 'active' with an empty config.
    if (!cols.some((c) => c.name === 'status')) {
      this.db.exec(
        `ALTER TABLE games ADD COLUMN status TEXT NOT NULL DEFAULT 'active'`,
      );
    }
    if (!cols.some((c) => c.name === 'config')) {
      this.db.exec(`ALTER TABLE games ADD COLUMN config TEXT NOT NULL DEFAULT '{}'`);
    }
    if (!cols.some((c) => c.name === 'invite_code')) {
      this.db.exec(`ALTER TABLE games ADD COLUMN invite_code TEXT`);
      this.db.exec(
        `CREATE UNIQUE INDEX IF NOT EXISTS games_invite_code ON games(invite_code)`,
      );
    }
    // Checkpoints written before the watermark column have an
    // ambiguous event boundary. They are pure cache — drop them
    // rather than guess; they regenerate on the normal cadence.
    const ckCols = this.db
      .prepare(`PRAGMA table_info(game_checkpoints)`)
      .all() as { name: string }[];
    if (ckCols.length > 0 && !ckCols.some((c) => c.name === 'last_event_id')) {
      this.db.exec(`
        DELETE FROM game_checkpoints;
        ALTER TABLE game_checkpoints ADD COLUMN last_event_id INTEGER NOT NULL DEFAULT 0;
      `);
    }
    this.insertGameStmt = this.db.prepare(`
      INSERT INTO games (seed, player_count, sim_version, last_event_id, created_at, updated_at, world)
      VALUES (@seed, @playerCount, @simVersion, 0, @ts, @ts, @world)
    `);
    this.updateGameStmt = this.db.prepare(`
      UPDATE games
      SET world = @world, sim_version = @simVersion, last_event_id = @lastEventId, updated_at = @ts
      WHERE id = @id
    `);
    this.latestGameStmt = this.db.prepare(`
      SELECT id, seed, player_count, sim_version, last_event_id, created_at, updated_at, world
      FROM games ORDER BY updated_at DESC LIMIT 1
    `);
    this.listEventsAfterIdStmt = this.db.prepare(`
      SELECT id, sim_at, kind, payload, sim_version
      FROM game_events
      WHERE game_id = @gameId AND id > @afterId
      ORDER BY id ASC
    `);
    this.insertEventStmt = this.db.prepare(`
      INSERT INTO game_events (game_id, sim_at, kind, payload, sim_version, created_at)
      VALUES (@gameId, @simAt, @kind, @payload, @simVersion, @ts)
    `);
    this.listEventsAfterIdUpToStmt = this.db.prepare(`
      SELECT id, sim_at, kind, payload, sim_version
      FROM game_events
      WHERE game_id = @gameId AND id > @afterId AND sim_at <= @toSimAt
      ORDER BY id ASC
    `);
    this.insertCheckpointStmt = this.db.prepare(`
      INSERT INTO game_checkpoints (game_id, sim_at, last_event_id, sim_version, world, created_at)
      VALUES (@gameId, @simAt, @lastEventId, @simVersion, @world, @ts)
    `);
    this.latestCheckpointBeforeStmt = this.db.prepare(`
      SELECT id, sim_at, last_event_id, sim_version, world
      FROM game_checkpoints
      WHERE game_id = @gameId AND sim_at <= @atOrBefore
      ORDER BY sim_at DESC LIMIT 1
    `);
    this.trimCheckpointsStmt = this.db.prepare(`
      DELETE FROM game_checkpoints
      WHERE game_id = @gameId
      AND id NOT IN (
        SELECT id FROM game_checkpoints
        WHERE game_id = @gameId
        ORDER BY sim_at DESC
        LIMIT @keepN
      )
    `);
    this.deleteCheckpointsStmt = this.db.prepare(`
      DELETE FROM game_checkpoints WHERE game_id = @gameId
    `);
    this.insertBaselineStmt = this.db.prepare(`
      INSERT INTO game_baselines (game_id, sim_at, last_event_id, sim_version, world, created_at)
      VALUES (@gameId, @simAt, @lastEventId, @simVersion, @world, @ts)
    `);
    this.latestBaselineStmt = this.db.prepare(`
      SELECT id, sim_at, last_event_id, sim_version, world
      FROM game_baselines
      WHERE game_id = @gameId
      ORDER BY sim_at DESC, id DESC LIMIT 1
    `);
  }

  // ---------- games ----------

  insertGame(world: World, playerCount: number): number {
    const ts = Date.now();
    const info = this.insertGameStmt.run({
      seed: world.seed,
      playerCount,
      simVersion: SIM_VERSION,
      ts,
      world: JSON.stringify(world),
    });
    return Number(info.lastInsertRowid);
  }

  saveGame(id: number, world: World, lastEventId: number): void {
    const ts = Date.now();
    this.updateGameStmt.run({
      id,
      ts,
      simVersion: SIM_VERSION,
      lastEventId,
      world: JSON.stringify(world),
    });
  }

  latestGame(): PersistedGame | null {
    const row = this.latestGameStmt.get() as
      | {
          id: number;
          seed: number;
          player_count: number;
          sim_version: string;
          last_event_id: number;
          created_at: number;
          updated_at: number;
          world: string;
        }
      | undefined;
    if (!row) return null;
    const world = migrate(JSON.parse(row.world) as World);
    return {
      id: row.id,
      seed: row.seed,
      playerCount: row.player_count,
      simVersion: row.sim_version,
      world,
      lastEventId: row.last_event_id,
    };
  }

  // ---------- events ----------

  appendEvent(gameId: number, event: GameEvent): number {
    const ts = Date.now();
    const info = this.insertEventStmt.run({
      gameId,
      simAt: event.simAt,
      kind: event.kind,
      payload: JSON.stringify(event),
      simVersion: SIM_VERSION,
      ts,
    });
    return Number(info.lastInsertRowid);
  }

  /**
   * Events strictly after the given watermark row id, up to and
   * including `toSimAt`, in id order. The id-based lower bound (not a
   * sim-time bound) is what makes snapshot-based replay exact —
   * several events can share the snapshot's own sim timestamp without
   * being contained in it.
   */
  listEventsAfterIdUpTo(
    gameId: number,
    afterId: number,
    toSimAt: number,
  ): StoredEvent[] {
    const rows = this.listEventsAfterIdUpToStmt.all({
      gameId,
      afterId,
      toSimAt,
    }) as {
      id: number;
      sim_at: number;
      kind: string;
      payload: string;
      sim_version: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      simAt: r.sim_at,
      event: JSON.parse(r.payload) as GameEvent,
      simVersion: r.sim_version,
    }));
  }

  /**
   * Events strictly after the given row id, in id order. Used by boot
   * recovery to replay orders that were acknowledged after the last
   * world snapshot was saved.
   */
  listEventsAfterId(gameId: number, afterId: number): StoredEvent[] {
    const rows = this.listEventsAfterIdStmt.all({ gameId, afterId }) as {
      id: number;
      sim_at: number;
      kind: string;
      payload: string;
      sim_version: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      simAt: r.sim_at,
      event: JSON.parse(r.payload) as GameEvent,
      simVersion: r.sim_version,
    }));
  }

  // ---------- checkpoints (cache) ----------

  insertCheckpoint(gameId: number, world: World, lastEventId: number): number {
    const ts = Date.now();
    const info = this.insertCheckpointStmt.run({
      gameId,
      simAt: world.time,
      lastEventId,
      simVersion: SIM_VERSION,
      world: JSON.stringify(world),
      ts,
    });
    return Number(info.lastInsertRowid);
  }

  latestCheckpointBefore(
    gameId: number,
    atOrBefore: number,
  ): StoredCheckpoint | null {
    const row = this.latestCheckpointBeforeStmt.get({
      gameId,
      atOrBefore,
    }) as
      | {
          id: number;
          sim_at: number;
          last_event_id: number;
          sim_version: string;
          world: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      simAt: row.sim_at,
      world: migrate(JSON.parse(row.world) as World),
      simVersion: row.sim_version,
      lastEventId: row.last_event_id,
    };
  }

  /** Trim checkpoints for one game, keeping the N most recent. */
  trimCheckpoints(gameId: number, keepN: number): void {
    this.trimCheckpointsStmt.run({ gameId, keepN });
  }

  /** Drop all checkpoints for one game. Safe by design (pure cache);
   *  used at epoch promotion when old-version snapshots become
   *  unusable for replay. */
  deleteCheckpoints(gameId: number): void {
    this.deleteCheckpointsStmt.run({ gameId });
  }

  // ---------- baselines (authoritative epoch anchors) ----------

  insertBaseline(gameId: number, world: World, lastEventId: number): number {
    const ts = Date.now();
    const info = this.insertBaselineStmt.run({
      gameId,
      simAt: world.time,
      lastEventId,
      simVersion: SIM_VERSION,
      world: JSON.stringify(world),
      ts,
    });
    return Number(info.lastInsertRowid);
  }

  latestBaseline(gameId: number): StoredBaseline | null {
    const row = this.latestBaselineStmt.get({ gameId }) as
      | {
          id: number;
          sim_at: number;
          last_event_id: number;
          sim_version: string;
          world: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      simAt: row.sim_at,
      world: migrate(JSON.parse(row.world) as World),
      simVersion: row.sim_version,
      lastEventId: row.last_event_id,
    };
  }

  // ---------- identity (Phase A) ----------

  createUser(name: string): UserRow {
    const ts = Date.now();
    const info = this.db
      .prepare(`INSERT INTO users (name, created_at) VALUES (@name, @ts)`)
      .run({ name, ts });
    return { id: Number(info.lastInsertRowid), name };
  }

  getUser(id: number): UserRow | null {
    const row = this.db
      .prepare(`SELECT id, name FROM users WHERE id = @id`)
      .get({ id }) as { id: number; name: string } | undefined;
    return row ?? null;
  }

  renameUser(id: number, name: string): void {
    this.db.prepare(`UPDATE users SET name = @name WHERE id = @id`).run({ id, name });
  }

  createSession(userId: number, token: string): void {
    const ts = Date.now();
    this.db
      .prepare(
        `INSERT INTO sessions (token, user_id, created_at, last_seen_at)
         VALUES (@token, @userId, @ts, @ts)`,
      )
      .run({ token, userId, ts });
  }

  userForSession(token: string): UserRow | null {
    const row = this.db
      .prepare(
        `SELECT u.id, u.name FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.token = @token`,
      )
      .get({ token }) as { id: number; name: string } | undefined;
    if (!row) return null;
    this.db
      .prepare(`UPDATE sessions SET last_seen_at = @ts WHERE token = @token`)
      .run({ ts: Date.now(), token });
    return row;
  }

  // ---------- lobby / lifecycle (Phase A) ----------

  createLobbyGame(config: GameConfig, inviteCode: string): number {
    const ts = Date.now();
    const info = this.db
      .prepare(
        `INSERT INTO games (seed, player_count, sim_version, last_event_id,
           created_at, updated_at, world, status, config, invite_code)
         VALUES (0, @playerCount, @simVersion, 0, @ts, @ts, '', 'lobby', @config, @code)`,
      )
      .run({
        playerCount: config.playerCount,
        simVersion: SIM_VERSION,
        ts,
        config: JSON.stringify(config),
        code: inviteCode,
      });
    return Number(info.lastInsertRowid);
  }

  /** Promote a lobby to an active game with its generated world. */
  activateGame(id: number, world: World): void {
    const ts = Date.now();
    this.db
      .prepare(
        `UPDATE games SET seed = @seed, world = @world, status = 'active',
           sim_version = @simVersion, updated_at = @ts WHERE id = @id`,
      )
      .run({ id, seed: world.seed, world: JSON.stringify(world), simVersion: SIM_VERSION, ts });
  }

  setGameStatus(id: number, status: GameStatus): void {
    this.db
      .prepare(`UPDATE games SET status = @status, updated_at = @ts WHERE id = @id`)
      .run({ id, status, ts: Date.now() });
  }

  gameMetaById(id: number): GameMetaRow | null {
    const row = this.db
      .prepare(
        `SELECT id, status, config, invite_code, player_count, updated_at
         FROM games WHERE id = @id`,
      )
      .get({ id }) as RawGameMeta | undefined;
    return row ? toMeta(row) : null;
  }

  gameMetaByCode(code: string): GameMetaRow | null {
    const row = this.db
      .prepare(
        `SELECT id, status, config, invite_code, player_count, updated_at
         FROM games WHERE invite_code = @code`,
      )
      .get({ code }) as RawGameMeta | undefined;
    return row ? toMeta(row) : null;
  }

  /** Persisted snapshot for one specific game id (boot/load path). */
  gameById(id: number): PersistedGame | null {
    const row = this.db
      .prepare(
        `SELECT id, seed, player_count, sim_version, last_event_id, world
         FROM games WHERE id = @id AND status != 'lobby'`,
      )
      .get({ id }) as
      | {
          id: number;
          seed: number;
          player_count: number;
          sim_version: string;
          last_event_id: number;
          world: string;
        }
      | undefined;
    if (!row || row.world === '') return null;
    return {
      id: row.id,
      seed: row.seed,
      playerCount: row.player_count,
      simVersion: row.sim_version,
      world: migrate(JSON.parse(row.world) as World),
      lastEventId: row.last_event_id,
    };
  }

  listActiveGameIds(): number[] {
    const rows = this.db
      .prepare(`SELECT id FROM games WHERE status = 'active'`)
      .all() as { id: number }[];
    return rows.map((r) => r.id);
  }

  // ---------- seats ----------

  seatsForGame(gameId: number): SeatRow[] {
    const rows = this.db
      .prepare(
        `SELECT s.seat, s.user_id, u.name FROM game_seats s
         JOIN users u ON u.id = s.user_id
         WHERE s.game_id = @gameId ORDER BY s.seat ASC`,
      )
      .all({ gameId }) as { seat: number; user_id: number; name: string }[];
    return rows.map((r) => ({ seat: r.seat, userId: r.user_id, name: r.name }));
  }

  seatForUser(gameId: number, userId: number): number | null {
    const row = this.db
      .prepare(
        `SELECT seat FROM game_seats WHERE game_id = @gameId AND user_id = @userId`,
      )
      .get({ gameId, userId }) as { seat: number } | undefined;
    return row?.seat ?? null;
  }

  claimSeat(gameId: number, seat: number, userId: number): void {
    this.db
      .prepare(
        `INSERT INTO game_seats (game_id, seat, user_id, joined_at)
         VALUES (@gameId, @seat, @userId, @ts)`,
      )
      .run({ gameId, seat, userId, ts: Date.now() });
  }

  releaseSeat(gameId: number, userId: number): void {
    this.db
      .prepare(`DELETE FROM game_seats WHERE game_id = @gameId AND user_id = @userId`)
      .run({ gameId, userId });
  }

  /** All games a user holds a seat in, newest-activity first. */
  gamesForUser(userId: number): GameMetaRow[] {
    const rows = this.db
      .prepare(
        `SELECT g.id, g.status, g.config, g.invite_code, g.player_count, g.updated_at
         FROM games g JOIN game_seats s ON s.game_id = g.id
         WHERE s.user_id = @userId
         ORDER BY g.updated_at DESC`,
      )
      .all({ userId }) as RawGameMeta[];
    return rows.map(toMeta);
  }

  close(): void {
    this.db.close();
  }
}

// ---------- Phase A row shapes ----------

export interface UserRow {
  id: number;
  name: string;
}

export type GameStatus = 'lobby' | 'active' | 'finished';

export interface GameConfig {
  playerCount: number;
  /** Sim-ms per real-ms for this game (1 = real time, 1000 = dev-fast). */
  simSpeed: number;
}

export interface GameMetaRow {
  id: number;
  status: GameStatus;
  config: GameConfig;
  inviteCode: string | null;
  playerCount: number;
  updatedAt: number;
}

export interface SeatRow {
  seat: number;
  userId: number;
  name: string;
}

interface RawGameMeta {
  id: number;
  status: string;
  config: string;
  invite_code: string | null;
  player_count: number;
  updated_at: number;
}

function toMeta(row: RawGameMeta): GameMetaRow {
  let config: GameConfig;
  try {
    const parsed = JSON.parse(row.config) as Partial<GameConfig>;
    config = {
      playerCount: parsed.playerCount ?? row.player_count,
      simSpeed: parsed.simSpeed ?? 1,
    };
  } catch {
    config = { playerCount: row.player_count, simSpeed: 1 };
  }
  return {
    id: row.id,
    status: (row.status as GameStatus) ?? 'active',
    config,
    inviteCode: row.invite_code,
    playerCount: row.player_count,
    updatedAt: row.updated_at,
  };
}

/**
 * Forward-only migrations for World snapshots. As the sim grows new
 * fields, snapshots written by older versions need to gain those
 * fields with safe defaults before they're handed back to the sim.
 *
 * Keep this idempotent — running it on an already-migrated snapshot
 * must be a no-op.
 */
function migrate(world: World): World {
  if (!Array.isArray((world as { queuedOrders?: unknown }).queuedOrders)) {
    (world as { queuedOrders: unknown[] }).queuedOrders = [];
  }
  if (typeof (world as { nextQueuedOrderId?: unknown }).nextQueuedOrderId !== 'number') {
    (world as { nextQueuedOrderId: number }).nextQueuedOrderId = 0;
  }
  if (!Array.isArray((world as { pendingCommands?: unknown }).pendingCommands)) {
    (world as { pendingCommands: unknown[] }).pendingCommands = [];
  }
  if (typeof (world as { nextPendingCommandId?: unknown }).nextPendingCommandId !== 'number') {
    (world as { nextPendingCommandId: number }).nextPendingCommandId = 0;
  }
  if (!Array.isArray((world as { messages?: unknown }).messages)) {
    (world as { messages: unknown[] }).messages = [];
  }
  if (typeof (world as { nextMessageId?: unknown }).nextMessageId !== 'number') {
    (world as { nextMessageId: number }).nextMessageId = 0;
  }
  if (!Array.isArray((world as { events?: unknown }).events)) {
    (world as { events: unknown[] }).events = [];
  }
  if (typeof (world as { nextEventId?: unknown }).nextEventId !== 'number') {
    (world as { nextEventId: number }).nextEventId = 0;
  }
  if (!Array.isArray((world as { specialists?: unknown }).specialists)) {
    (world as { specialists: unknown[] }).specialists = [];
  }
  if (typeof (world as { nextSpecialistId?: unknown }).nextSpecialistId !== 'number') {
    (world as { nextSpecialistId: number }).nextSpecialistId = 0;
  }
  for (const raw of world.players) {
    // Legacy snapshots can miss any of these fields, so treat the
    // parsed JSON as a loose record — the static Player type would
    // narrow the `in`-check else-branches to `never`.
    const p = raw as unknown as Record<string, unknown>;
    // Funding was removed (docs/21) — strip the zombie field from
    // snapshots written by older sim versions so loaded worlds match
    // freshly generated ones byte-for-byte.
    if ('fundedBy' in p) delete p.fundedBy;
    if (!('nextHireAt' in p)) p.nextHireAt = 4 * 60 * 60 * 1000;
    if (!('hireSeed' in p)) p.hireSeed = playerHireSeed(world.seed, raw.id);
    if (!('hireIndex' in p)) p.hireIndex = 0;
    if (!('lastOfferedKinds' in p)) p.lastOfferedKinds = [];
    if (!('eliminated' in p)) p.eliminated = false;
    if (!('knownOutposts' in p)) p.knownOutposts = [];
  }
  return world;
}
