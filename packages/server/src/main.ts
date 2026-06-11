/**
 * Subterfuge dev server — Phase 5 MVP.
 *
 * Runs a single hardcoded 4-player game in memory. The lobby / multi-
 * game / persistence story arrives in later phases. For now this is
 * enough to open a browser and play.
 *
 *   SIM_SPEED   sim-ms per real-ms (default 1000 → 1 day = 86s)
 *   PORT        HTTP port (default 3030)
 */

import { Hono } from 'hono';
import type { Context } from 'hono';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import type { WebSocket as WsWebSocket } from 'ws';
import pino from 'pino';
import {
  appendMessage,
  applyEvent,
  cancelPending,
  cancelQueuedOrder,
  cancelSub,
  defer,
  editPreLaunchSub,
  executeHire,
  executePromote,
  executeReleaseCaptive,
  finalizePending,
  generateWorld,
  issueLaunchOrder,
  queueDrill,
  queueHire,
  queueLaunch,
  queuePirateTarget,
  queuePromote,
  queueRedirect,
  replayFrom,
  SIM_VERSION,
  tick,
  viewForPlayer,
  type DeferableCommand,
  type GameEvent,
  type OutpostId,
  type PendingCommandId,
  type PlayerId,
  type QueuedOrderId,
  type SpecialistId,
  type SpecialistKind,
  type SubId,
  type World,
} from '@subterfuge/sim';
import { GameStore } from './db.js';

const log = pino({ transport: { target: 'pino-pretty' } });

const PORT = Number(process.env.PORT ?? 3030);
const SIM_SPEED = Number(process.env.SIM_SPEED ?? 1000);
const TICK_INTERVAL_MS = 500;
const DB_PATH = process.env.DB_PATH ?? './data/subterfuge.db';
const PERSIST_EVERY_TICKS = 4; // ~2s at TICK_INTERVAL_MS=500

const store = new GameStore(DB_PATH);

interface GameState {
  id: number;
  world: World;
  /** Id of the last event-log row applied to `world` (persistence watermark). */
  lastEventId: number;
}

const game: GameState = (() => {
  const existing = store.latestGame();
  if (existing) {
    // Boot recovery: the world snapshot is saved on a multi-tick
    // cadence, so a crash can leave orders that were already ACKed
    // (and appended to the event log) missing from the snapshot.
    // Replay the log tail through the deterministic sim so no
    // acknowledged order is ever lost.
    const world = existing.world;
    let lastEventId = existing.lastEventId;
    let tailVersionMismatch = false;
    const tail = store.listEventsAfterId(existing.id, existing.lastEventId);
    if (tail.length > 0) {
      let applied = 0;
      for (const stored of tail) {
        lastEventId = stored.id;
        if (stored.simVersion !== SIM_VERSION) {
          // Best effort: the event was ACKed to a player, so apply it
          // through the current sim rather than drop it. The epoch
          // promotion below makes the resulting world the new
          // authoritative baseline, so this one-time approximation can
          // never poison future replays.
          tailVersionMismatch = true;
          log.warn(
            { eventId: stored.id, eventVersion: stored.simVersion, simVersion: SIM_VERSION },
            'boot recovery: applying event written by a different sim version (epoch will be promoted)',
          );
        }
        if (stored.simAt > world.time) tick(world, stored.simAt - world.time);
        const drop = applyEvent(world, stored.event);
        if (drop !== null) {
          log.warn({ eventId: stored.id, drop }, 'boot recovery: event dropped by sim');
        } else {
          applied += 1;
        }
      }
      store.saveGame(existing.id, world, lastEventId);
      log.info(
        { tail: tail.length, applied, time: world.time },
        'boot recovery: replayed event-log tail into snapshot',
      );
    }
    // Epoch promotion: when the sim version changed, events written by
    // the old version can no longer be replayed through current rules.
    // Promote the recovered live world to the new epoch's authoritative
    // baseline and drop the (now-unusable, pure-cache) checkpoints.
    // Replay never crosses below the latest baseline.
    if (existing.simVersion !== SIM_VERSION || tailVersionMismatch) {
      store.deleteCheckpoints(existing.id);
      store.insertBaseline(existing.id, world, lastEventId);
      store.saveGame(existing.id, world, lastEventId);
      log.warn(
        {
          id: existing.id,
          fromVersion: existing.simVersion,
          toVersion: SIM_VERSION,
          simAt: world.time,
        },
        'sim version changed — promoted live world to new epoch baseline',
      );
    }
    log.info(
      { id: existing.id, seed: existing.seed, time: world.time },
      'resuming game from db',
    );
    return { id: existing.id, world, lastEventId };
  }
  const world = generateWorld({ seed: 42, playerCount: 4 });
  const id = store.insertGame(world, world.players.length);
  // Genesis baseline at t=0: every game has an explicit epoch anchor,
  // so replay never needs the raw seed path for games created from
  // this version on.
  store.insertBaseline(id, world, 0);
  log.info({ id, seed: world.seed }, 'new game created');
  return { id, world, lastEventId: 0 };
})();

let ticksSinceSave = 0;
function maybePersist(force = false): void {
  ticksSinceSave += 1;
  if (force || ticksSinceSave >= PERSIST_EVERY_TICKS) {
    store.saveGame(game.id, game.world, game.lastEventId);
    ticksSinceSave = 0;
  }
}

/**
 * Append a GameEvent to the audit log AND persist the post-event
 * world snapshot atomically. Use this from every order endpoint
 * after a successful sim mutation so the event log and live world
 * never drift after a crash.
 *
 * The distributed-conditional-type input preserves each GameEvent
 * branch's narrowing through the Omit.
 */
type GameEventInput = GameEvent extends infer E
  ? E extends { simAt: number }
    ? Omit<E, 'simAt'>
    : never
  : never;

function recordEvent(input: GameEventInput): void {
  const full = { ...input, simAt: game.world.time } as GameEvent;
  // Append to the event log only — the world snapshot is persisted on
  // the regular `maybePersist`/`maybeCheckpoint` cadence. Stringifying
  // the entire World on every order would block the event loop and
  // grows with game length; the event log alone is sufficient for
  // recovery — boot replays every logged event with id >
  // snapshot.lastEventId through the deterministic sim (see the
  // game initializer above).
  //
  // FAIL-STOP: if the append fails, the in-memory world contains a
  // mutation the authoritative log cannot reproduce. Persisting that
  // world later (maybePersist) would silently break the log-is-truth
  // contract, so crash now instead — the last saved snapshot is
  // consistent with the log, and boot recovery resumes from there.
  // The order's HTTP handler dies with us, so the client never gets
  // an ACK for an unlogged order. (Endpoints call this synchronously
  // right after the sim mutation, with no await in between, so no
  // snapshot save can interleave.)
  try {
    game.lastEventId = store.appendEvent(game.id, full);
  } catch (e) {
    log.fatal(
      { err: e instanceof Error ? e.stack : String(e), kind: full.kind },
      'event-log append failed — fail-stopping to preserve log/world consistency',
    );
    process.exit(1);
  }
}

/**
 * Single route entry point for the 6 deferable player commands.
 * Creates a PendingCommand with a 10-minute fuse, records a `defer`
 * event for replay, broadcasts the new state, and returns the
 * pending command's id to the caller so the UI can show / cancel it.
 */
async function deferAndRespond(
  c: Context,
  command: DeferableCommand,
): Promise<Response> {
  try {
    const id = defer(game.world, {
      issuedAt: game.world.time,
      command,
    });
    recordEvent({ kind: 'defer', command });
    broadcastState();
    log.info({ kind: command.kind, owner: command.ownerId, id }, 'command deferred');
    return c.json({ ok: true, pendingId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ err: msg, kind: command.kind }, 'defer rejected');
    return c.json({ ok: false, error: msg }, 400);
  }
}

function shutdown(signal: string): void {
  log.info({ signal }, 'shutting down — final persist');
  store.saveGame(game.id, game.world, game.lastEventId);
  store.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const app = new Hono();

app.use('*', async (c, next) => {
  c.res.headers.set('Access-Control-Allow-Origin', '*');
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  await next();
});

app.options('*', (c) => c.body(null, 204));

// Malformed request bodies (bad JSON, wrong content type) surface as
// SyntaxError from c.req.json() — answer 400 in the standard error
// shape instead of an unhandled 500. Anything else is a real bug:
// log it and keep the generic 500.
app.onError((err, c) => {
  if (err instanceof SyntaxError) {
    return c.json({ ok: false, error: 'malformed JSON body' }, 400);
  }
  log.error({ err: err.stack ?? String(err) }, 'unhandled route error');
  return c.json({ ok: false, error: 'internal error' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

/**
 * Game metadata the client needs outside the world snapshot.
 * `epochFloor` is the earliest sim time the event log can reproduce —
 * the latest epoch baseline's time (0 unless a sim-version change has
 * promoted one mid-game). The time scrubber clamps its past range to
 * this instead of discovering it via 409s.
 */
app.get('/api/meta', (c) => {
  const baseline = store.latestBaseline(game.id);
  return c.json({
    gameId: game.id,
    simVersion: SIM_VERSION,
    epochFloor: baseline?.simAt ?? 0,
  });
});

app.get('/api/state', (c) => {
  const playerIdParam = c.req.query('playerId');
  if (playerIdParam !== undefined) {
    const pid = Number(playerIdParam);
    if (!Number.isFinite(pid)) return c.json({ error: 'invalid playerId' }, 400);
    return c.json(viewForPlayer(game.world, pid as PlayerId));
  }
  // Spectator view is omniscient by design (dev tooling), but the
  // world-gen seed still must not leave the server — it derives
  // hidden future state (hire offers).
  return c.json({ ...game.world, seed: 0 });
});

/**
 * Time-travel replay: return the world state at any sim time within
 * the current epoch. Finds the best base snapshot ≤ `at` (checkpoint
 * if usable, else the epoch baseline, else world-gen for legacy
 * games), replays the event-log tail selected by *id watermark* up to
 * `at`, then filters through `viewForPlayer` if a `playerId` is given.
 *
 *   GET /api/replay?gameId=N&at=SIM_TIME_MS[&playerId=P]
 *
 * If `at` is at or past current sim time, returns the live world (no
 * replay needed). Times before the latest epoch baseline are not
 * replayable — the events below it were written by an older sim
 * version — and return 409.
 */
app.get('/api/replay', (c) => {
  const atParam = c.req.query('at');
  const gameIdParam = c.req.query('gameId');
  const playerIdParam = c.req.query('playerId');
  if (atParam === undefined) {
    return c.json({ error: 'missing required `at` query' }, 400);
  }
  const at = Number(atParam);
  if (!Number.isFinite(at) || at < 0) {
    return c.json({ error: 'invalid `at`' }, 400);
  }
  const gameId = gameIdParam !== undefined ? Number(gameIdParam) : game.id;
  if (gameId !== game.id) {
    return c.json({ error: `only game ${game.id} is hosted` }, 404);
  }
  if (playerIdParam !== undefined && !Number.isFinite(Number(playerIdParam))) {
    return c.json({ error: 'invalid playerId' }, 400);
  }
  if (at >= game.world.time) {
    // Caller is asking for "now" — just return live filtered view.
    const view =
      playerIdParam !== undefined
        ? viewForPlayer(game.world, Number(playerIdParam) as PlayerId)
        : { ...game.world, seed: 0 };
    return c.json(view);
  }
  const baseline = store.latestBaseline(gameId);
  if (baseline !== null && at < baseline.simAt) {
    return c.json(
      {
        error:
          `time ${at} predates the current epoch baseline (sim ${baseline.simVersion} at ` +
          `${baseline.simAt}) — history below it was recorded by an older sim version ` +
          `and cannot be replayed`,
      },
      409,
    );
  }
  // Prefer a checkpoint over the baseline when one is usable: same sim
  // version and not below the epoch floor. Checkpoints are cache, so a
  // bad one just means a longer replay, never wrong state.
  const checkpoint = store.latestCheckpointBefore(gameId, at);
  const usableCheckpoint =
    checkpoint !== null &&
    checkpoint.simVersion === SIM_VERSION &&
    (baseline === null || checkpoint.simAt >= baseline.simAt)
      ? checkpoint
      : null;
  const base = usableCheckpoint ?? baseline;
  // Select the tail by id watermark, never by sim time: events stamped
  // exactly at the snapshot's sim time are not contained in it.
  const events = store.listEventsAfterIdUpTo(gameId, base?.lastEventId ?? 0, at);
  // Version safety: an event from another sim version inside the
  // replay range would diverge. (Cannot happen above a baseline by
  // construction; guards legacy games without one.)
  const mismatch = events.find((e) => e.simVersion !== SIM_VERSION);
  if (mismatch !== undefined) {
    return c.json(
      {
        error: `event #${mismatch.id} was written by sim ${mismatch.simVersion}; current is ${SIM_VERSION}`,
      },
      409,
    );
  }
  const opts: Parameters<typeof replayFrom>[0] =
    base !== null
      ? { events: events.map((e) => e.event), targetTime: at, baseSnapshot: base.world }
      : {
          // Legacy game predating baselines: replay from world-gen.
          seed: game.world.seed,
          playerCount: game.world.players.length,
          events: events.map((e) => e.event),
          targetTime: at,
        };
  const replayed = replayFrom(opts);
  const view =
    playerIdParam !== undefined
      ? viewForPlayer(replayed, Number(playerIdParam) as PlayerId)
      : { ...replayed, seed: 0 };
  return c.json(view);
});

app.post('/api/orders/launch', async (c) => {
  const body = (await c.req.json()) as {
    ownerId: number;
    sourceId: number;
    destinationId: number;
    drillers: number;
    giftTo?: number;
    specialistIds?: number[];
  };
  try {
    const id = issueLaunchOrder(game.world, {
      ownerId: body.ownerId as PlayerId,
      sourceId: body.sourceId as OutpostId,
      destinationId: body.destinationId as OutpostId,
      drillers: body.drillers,
      ...(typeof body.giftTo === 'number'
        ? { giftTo: body.giftTo as PlayerId }
        : {}),
      ...(body.specialistIds && body.specialistIds.length > 0
        ? { specialistIds: body.specialistIds as unknown as SpecialistId[] }
        : {}),
    });
    recordEvent({
      kind: 'launch',
      ownerId: body.ownerId as PlayerId,
      sourceId: body.sourceId as OutpostId,
      destinationId: body.destinationId as OutpostId,
      drillers: body.drillers,
      ...(typeof body.giftTo === 'number'
        ? { giftTo: body.giftTo as PlayerId }
        : {}),
      ...(body.specialistIds && body.specialistIds.length > 0
        ? { specialistIds: body.specialistIds as unknown as SpecialistId[] }
        : {}),
    });
    broadcastState();
    log.info({ subId: id, body }, 'launch order issued');
    return c.json({ ok: true, subId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ err: msg, body }, 'launch order rejected');
    return c.json({ ok: false, error: msg }, 400);
  }
});

// ---------- Diplomacy: chat ----------

app.post('/api/chat', async (c) => {
  const body = (await c.req.json()) as {
    from: number;
    to: number | null;
    text: string;
  };
  try {
    const m = appendMessage(game.world, {
      from: body.from as PlayerId,
      to: body.to === null ? null : (body.to as PlayerId),
      text: body.text,
    });
    recordEvent({
      kind: 'chat',
      from: body.from as PlayerId,
      to: body.to === null ? null : (body.to as PlayerId),
      text: body.text,
    });
    broadcastState();
    return c.json({ ok: true, id: m.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/orders/hire', async (c) => {
  const body = (await c.req.json()) as { ownerId: number; kind: string };
  return deferAndRespond(c, {
    kind: 'hire',
    ownerId: body.ownerId as PlayerId,
    specialistKind: body.kind as SpecialistKind,
  });
});

app.post('/api/orders/hire/now', async (c) => {
  const body = (await c.req.json()) as { ownerId: number; kind: string };
  try {
    const spec = executeHire(game.world, {
      ownerId: body.ownerId as PlayerId,
      kind: body.kind as SpecialistKind,
    });
    recordEvent({
      kind: 'hire',
      ownerId: body.ownerId as PlayerId,
      specialistKind: body.kind as SpecialistKind,
    });
    broadcastState();
    log.info({ kind: body.kind, owner: body.ownerId }, 'hire fired instantly');
    return c.json({ ok: true, specialistId: spec.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ err: msg, body }, 'instant hire rejected');
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/orders/promote', async (c) => {
  const body = (await c.req.json()) as {
    ownerId: number;
    specialistId: number;
  };
  return deferAndRespond(c, {
    kind: 'promote',
    ownerId: body.ownerId as PlayerId,
    specialistId: body.specialistId as unknown as SpecialistId,
  });
});

app.post('/api/orders/promote/now', async (c) => {
  const body = (await c.req.json()) as {
    ownerId: number;
    specialistId: number;
  };
  try {
    executePromote(game.world, {
      ownerId: body.ownerId as PlayerId,
      specialistId: body.specialistId,
    });
    recordEvent({
      kind: 'promote',
      ownerId: body.ownerId as PlayerId,
      specialistId: body.specialistId as unknown as SpecialistId,
    });
    broadcastState();
    log.info({ specialistId: body.specialistId, owner: body.ownerId }, 'promote fired instantly');
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ err: msg, body }, 'instant promote rejected');
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/orders/pirate-target', async (c) => {
  const body = (await c.req.json()) as {
    ownerId: number;
    subId: number;
    targetSubId: number;
  };
  return deferAndRespond(c, {
    kind: 'pirate-target',
    ownerId: body.ownerId as PlayerId,
    subId: body.subId as unknown as SubId,
    targetSubId: body.targetSubId as unknown as SubId,
  });
});

app.post('/api/orders/release-captive', async (c) => {
  const body = (await c.req.json()) as {
    ownerId: number;
    specialistId: number;
  };
  return deferAndRespond(c, {
    kind: 'release-captive',
    ownerId: body.ownerId as PlayerId,
    specialistId: body.specialistId as unknown as SpecialistId,
  });
});

app.post('/api/orders/release-captive/now', async (c) => {
  const body = (await c.req.json()) as {
    ownerId: number;
    specialistId: number;
  };
  try {
    executeReleaseCaptive(game.world, {
      ownerId: body.ownerId as PlayerId,
      specialistId: body.specialistId,
    });
    recordEvent({
      kind: 'release-captive',
      ownerId: body.ownerId as PlayerId,
      specialistId: body.specialistId as unknown as SpecialistId,
    });
    broadcastState();
    log.info({ specialistId: body.specialistId, owner: body.ownerId }, 'release-captive fired instantly');
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ err: msg, body }, 'instant release-captive rejected');
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/orders/redirect', async (c) => {
  const body = (await c.req.json()) as {
    ownerId: number;
    subId: number;
    newDestinationId: number;
  };
  return deferAndRespond(c, {
    kind: 'redirect',
    ownerId: body.ownerId as PlayerId,
    subId: body.subId as unknown as SubId,
    newDestinationId: body.newDestinationId as OutpostId,
  });
});

app.post('/api/orders/cancel-sub', async (c) => {
  const body = (await c.req.json()) as { ownerId: number; subId: number };
  try {
    cancelSub(game.world, {
      ownerId: body.ownerId as PlayerId,
      subId: body.subId as unknown as SubId,
    });
    recordEvent({
      kind: 'cancel-sub',
      ownerId: body.ownerId as PlayerId,
      subId: body.subId as unknown as SubId,
    });
    broadcastState();
    log.info({ body }, 'sub cancelled');
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ err: msg, body }, 'cancel-sub rejected');
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/orders/edit-prelaunch-sub', async (c) => {
  const body = (await c.req.json()) as {
    ownerId: number;
    subId: number;
    drillers: number;
    specialistIds?: number[];
  };
  try {
    const specialistIds =
      body.specialistIds !== undefined
        ? (body.specialistIds as unknown as SpecialistId[])
        : undefined;
    editPreLaunchSub(game.world, {
      ownerId: body.ownerId as PlayerId,
      subId: body.subId as unknown as SubId,
      drillers: body.drillers,
      ...(specialistIds !== undefined ? { specialistIds } : {}),
    });
    recordEvent({
      kind: 'edit-prelaunch-sub',
      ownerId: body.ownerId as PlayerId,
      subId: body.subId as unknown as SubId,
      drillers: body.drillers,
      ...(specialistIds !== undefined ? { specialistIds } : {}),
    });
    broadcastState();
    log.info({ body }, 'sub edited');
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    log.warn({ err: msg, body }, 'edit-prelaunch-sub rejected');
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/orders/drill', async (c) => {
  const body = (await c.req.json()) as { ownerId: number; outpostId: number };
  return deferAndRespond(c, {
    kind: 'drill',
    ownerId: body.ownerId as PlayerId,
    outpostId: body.outpostId as OutpostId,
  });
});

app.delete('/api/pending/:id', (c) => {
  const id = Number(c.req.param('id'));
  const ownerId = Number(c.req.query('ownerId'));
  if (!Number.isFinite(id) || !Number.isFinite(ownerId)) {
    return c.json({ ok: false, error: 'bad id/ownerId' }, 400);
  }
  const ok = cancelPending(
    game.world,
    id as unknown as PendingCommandId,
    ownerId as PlayerId,
  );
  if (!ok) {
    return c.json({ ok: false, error: 'not found or not yours' }, 404);
  }
  recordEvent({
    kind: 'cancel-pending',
    ownerId: ownerId as PlayerId,
    pendingId: id as unknown as PendingCommandId,
  });
  broadcastState();
  return c.json({ ok: true });
});

app.post('/api/pending/:id/finalize', async (c) => {
  const id = Number(c.req.param('id'));
  const body = (await c.req.json().catch(() => ({}))) as { ownerId?: number };
  const ownerId = Number(body.ownerId);
  if (!Number.isFinite(id) || !Number.isFinite(ownerId)) {
    return c.json({ ok: false, error: 'bad id/ownerId' }, 400);
  }
  const r = finalizePending(
    game.world,
    id as unknown as PendingCommandId,
    ownerId as PlayerId,
  );
  if (!r.ok) {
    return c.json({ ok: false, error: r.reason ?? 'finalize failed' }, 400);
  }
  recordEvent({
    kind: 'finalize-pending',
    ownerId: ownerId as PlayerId,
    pendingId: id as unknown as PendingCommandId,
  });
  broadcastState();
  log.info({ pendingId: id, ownerId }, 'pending command finalised');
  return c.json({ ok: true });
});

app.post('/api/queue/launch', async (c) => {
  const body = (await c.req.json()) as {
    executeAt: number;
    ownerId: number;
    sourceId: number;
    destinationId: number;
    drillers: number;
    giftTo?: number;
    specialistIds?: number[];
    pirateTargetSubId?: number;
  };
  try {
    const giftTo =
      body.giftTo !== undefined && body.giftTo !== null
        ? (body.giftTo as PlayerId)
        : undefined;
    const specialistIds =
      body.specialistIds !== undefined && body.specialistIds.length > 0
        ? (body.specialistIds as unknown as SpecialistId[])
        : undefined;
    const pirateTargetSubId =
      body.pirateTargetSubId !== undefined && body.pirateTargetSubId !== null
        ? (body.pirateTargetSubId as unknown as SubId)
        : undefined;
    const id = queueLaunch(game.world, {
      executeAt: body.executeAt,
      ownerId: body.ownerId as PlayerId,
      sourceId: body.sourceId as OutpostId,
      destinationId: body.destinationId as OutpostId,
      drillers: body.drillers,
      ...(giftTo !== undefined ? { giftTo } : {}),
      ...(specialistIds !== undefined ? { specialistIds } : {}),
      ...(pirateTargetSubId !== undefined ? { pirateTargetSubId } : {}),
    });
    recordEvent({
      kind: 'queue-launch',
      ownerId: body.ownerId as PlayerId,
      sourceId: body.sourceId as OutpostId,
      destinationId: body.destinationId as OutpostId,
      drillers: body.drillers,
      executeAt: body.executeAt,
      ...(giftTo !== undefined ? { giftTo } : {}),
      ...(specialistIds !== undefined ? { specialistIds } : {}),
      ...(pirateTargetSubId !== undefined ? { pirateTargetSubId } : {}),
    });
    broadcastState();
    log.info({ id, body }, 'launch order queued');
    return c.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/queue/drill', async (c) => {
  const body = (await c.req.json()) as {
    executeAt: number;
    ownerId: number;
    outpostId: number;
  };
  try {
    const id = queueDrill(game.world, {
      executeAt: body.executeAt,
      ownerId: body.ownerId as PlayerId,
      outpostId: body.outpostId as OutpostId,
    });
    recordEvent({
      kind: 'queue-drill',
      ownerId: body.ownerId as PlayerId,
      outpostId: body.outpostId as OutpostId,
      executeAt: body.executeAt,
    });
    broadcastState();
    log.info({ id, body }, 'drill order queued');
    return c.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/queue/hire', async (c) => {
  const body = (await c.req.json()) as {
    executeAt: number;
    ownerId: number;
    kind: string;
  };
  try {
    const id = queueHire(game.world, {
      executeAt: body.executeAt,
      ownerId: body.ownerId as PlayerId,
      specialistKind: body.kind as SpecialistKind,
    });
    recordEvent({
      kind: 'queue-hire',
      ownerId: body.ownerId as PlayerId,
      specialistKind: body.kind as SpecialistKind,
      executeAt: body.executeAt,
    });
    broadcastState();
    log.info({ id, body }, 'hire order queued');
    return c.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/queue/promote', async (c) => {
  const body = (await c.req.json()) as {
    executeAt: number;
    ownerId: number;
    specialistId: number;
  };
  try {
    const id = queuePromote(game.world, {
      executeAt: body.executeAt,
      ownerId: body.ownerId as PlayerId,
      specialistId: body.specialistId as unknown as SpecialistId,
    });
    recordEvent({
      kind: 'queue-promote',
      ownerId: body.ownerId as PlayerId,
      specialistId: body.specialistId as unknown as SpecialistId,
      executeAt: body.executeAt,
    });
    broadcastState();
    log.info({ id, body }, 'promote order queued');
    return c.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/queue/redirect', async (c) => {
  const body = (await c.req.json()) as {
    executeAt: number;
    ownerId: number;
    subId: number;
    newDestinationId: number;
  };
  try {
    const id = queueRedirect(game.world, {
      executeAt: body.executeAt,
      ownerId: body.ownerId as PlayerId,
      subId: body.subId as unknown as SubId,
      newDestinationId: body.newDestinationId as OutpostId,
    });
    recordEvent({
      kind: 'queue-redirect',
      ownerId: body.ownerId as PlayerId,
      subId: body.subId as unknown as SubId,
      newDestinationId: body.newDestinationId as OutpostId,
      executeAt: body.executeAt,
    });
    broadcastState();
    log.info({ id, body }, 'redirect order queued');
    return c.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/queue/pirate-target', async (c) => {
  const body = (await c.req.json()) as {
    executeAt: number;
    ownerId: number;
    subId: number;
    targetSubId: number;
  };
  try {
    const id = queuePirateTarget(game.world, {
      executeAt: body.executeAt,
      ownerId: body.ownerId as PlayerId,
      subId: body.subId as unknown as SubId,
      targetSubId: body.targetSubId as unknown as SubId,
    });
    recordEvent({
      kind: 'queue-pirate-target',
      ownerId: body.ownerId as PlayerId,
      subId: body.subId as unknown as SubId,
      targetSubId: body.targetSubId as unknown as SubId,
      executeAt: body.executeAt,
    });
    broadcastState();
    log.info({ id, body }, 'pirate-target order queued');
    return c.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.delete('/api/queue/:id', (c) => {
  const id = Number(c.req.param('id'));
  const ownerId = Number(c.req.query('ownerId'));
  if (!Number.isFinite(id) || !Number.isFinite(ownerId)) {
    return c.json({ ok: false, error: 'bad id/ownerId' }, 400);
  }
  const removed = cancelQueuedOrder(
    game.world,
    id as QueuedOrderId,
    ownerId as PlayerId,
  );
  if (!removed) {
    return c.json({ ok: false, error: 'not found or not yours' }, 404);
  }
  recordEvent({
    kind: 'cancel-queued',
    ownerId: ownerId as PlayerId,
    orderId: id as QueuedOrderId,
  });
  broadcastState();
  return c.json({ ok: true });
});

const httpServer = serve(
  { fetch: app.fetch, port: PORT },
  (info) => {
    log.info(`HTTP listening on http://localhost:${info.port}`);
  },
);

// WebSocket for live state pushes
const wss = new WebSocketServer({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: httpServer as any,
  path: '/ws',
});

interface ClientMeta {
  ws: WsWebSocket;
  playerId: PlayerId | null;
}

const clients = new Set<ClientMeta>();

wss.on('connection', (ws, req) => {
  // Parse playerId from `?playerId=N` query in the upgrade request.
  // If absent or invalid, the client sees the unfiltered world (handy
  // for development / spectator views).
  const url = new URL(req.url ?? '/ws', 'http://localhost');
  const raw = url.searchParams.get('playerId');
  let playerId: PlayerId | null = null;
  if (raw !== null) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n < game.world.players.length) {
      playerId = n as PlayerId;
    }
  }
  const meta: ClientMeta = { ws, playerId };
  clients.add(meta);
  log.info({ clients: clients.size, playerId }, 'ws client connected');
  ws.send(stateMessageFor(meta));
  ws.on('close', () => {
    clients.delete(meta);
    log.info({ clients: clients.size }, 'ws client disconnected');
  });
  // Without an 'error' listener a single misbehaving socket
  // (ECONNRESET, protocol error) raises an unhandled 'error' event
  // and kills the process.
  ws.on('error', (err) => {
    log.warn({ err: err.message }, 'ws client error');
  });
});

wss.on('error', (err) => {
  log.error({ err: err.message }, 'ws server error');
});

function stateMessageFor(meta: ClientMeta): string {
  const view =
    meta.playerId === null ? game.world : viewForPlayer(game.world, meta.playerId);
  return JSON.stringify({ type: 'state', world: view });
}

/**
 * Send a per-player state message to every connected client. The
 * filtered world + stringification are cached by playerId for the
 * duration of one broadcast so two clients viewing the same player
 * share the work, and the unfiltered spectator view is computed at
 * most once even if many spectator clients are attached.
 */
function broadcastState(): void {
  const cache = new Map<PlayerId | null, string>();
  for (const meta of clients) {
    if (meta.ws.readyState !== meta.ws.OPEN) continue;
    let msg = cache.get(meta.playerId);
    if (msg === undefined) {
      msg = stateMessageFor(meta);
      cache.set(meta.playerId, msg);
    }
    meta.ws.send(msg);
  }
}

// Periodic checkpoints. We persist a full world snapshot every
// CHECKPOINT_INTERVAL_MS of sim time so backward time scrubbing
// doesn't have to replay from t=0. Snapshots are pure cache — pruned
// to MAX_CHECKPOINTS_PER_GAME per game.
const CHECKPOINT_INTERVAL_MS = 60 * 60 * 1000; // 1 sim hour
const MAX_CHECKPOINTS_PER_GAME = 30;
let lastCheckpointSimAt = game.world.time;
// Seed an initial checkpoint at boot so the first scrub-back doesn't
// have to replay from the epoch baseline.
store.insertCheckpoint(game.id, game.world, game.lastEventId);

function maybeCheckpoint(): void {
  if (game.world.time - lastCheckpointSimAt < CHECKPOINT_INTERVAL_MS) return;
  store.insertCheckpoint(game.id, game.world, game.lastEventId);
  store.trimCheckpoints(game.id, MAX_CHECKPOINTS_PER_GAME);
  lastCheckpointSimAt = game.world.time;
  log.info(
    { gameId: game.id, simAt: game.world.time },
    'periodic checkpoint written',
  );
}

// Tick loop. Guarded: an exception escaping a timer callback is an
// uncaught exception and kills the process — combined with the boot
// recovery above, a deterministic sim crash would otherwise become a
// crash loop.
setInterval(() => {
  if (game.world.winnerId !== null) return;
  try {
    tick(game.world, TICK_INTERVAL_MS * SIM_SPEED);
    broadcastState();
    maybePersist();
    maybeCheckpoint();
  } catch (e) {
    log.error(
      { err: e instanceof Error ? e.stack : String(e) },
      'tick loop failed — sim state unchanged for this tick',
    );
  }
}, TICK_INTERVAL_MS);

log.info(
  `Sim running at ${SIM_SPEED}× speed. 1 real sec = ${SIM_SPEED} sim sec. ` +
    `One 24h day in sim = ${Math.round(86_400 / SIM_SPEED)} real sec.`,
);
