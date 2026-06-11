/**
 * Subterfuge server — Phase A: identity, lobbies, multi-game hosting.
 *
 * Identity is guest-first (see auth.ts): the first request mints an
 * anonymous user + httpOnly session cookie. Every order route derives
 * the acting player from the session's SEAT in that game — `ownerId`
 * in request bodies is only honoured when DEV_MODE=1 (the local dev
 * player-switcher and curl testing).
 *
 *   PORT        HTTP port (default 3030)
 *   DB_PATH     SQLite location (default ./data/subterfuge.db)
 *   DEV_MODE    '1' allows ownerId/playerId overrides + spectator views
 *   SIM_SPEED   default sim speed for NEW games created without one
 *               (per-game config; existing games keep their own)
 */

import { randomInt } from 'node:crypto';
import { Hono } from 'hono';
import type { Context } from 'hono';
import { serve } from '@hono/node-server';
import { WebSocketServer } from 'ws';
import pino from 'pino';
import {
  appendMessage,
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
  viewForPlayer,
  type DeferableCommand,
  type OutpostId,
  type PendingCommandId,
  type PlayerId,
  type QueuedOrderId,
  type SpecialistId,
  type SpecialistKind,
  type SubId,
} from '@subterfuge/sim';
import { GameStore, type GameConfig } from './db.js';
import { requireUser, userFromCookieHeader } from './auth.js';
import { GameRegistry, type ClientMeta, type GameHost } from './registry.js';

const log = pino({ transport: { target: 'pino-pretty' } });

const PORT = Number(process.env.PORT ?? 3030);
const DB_PATH = process.env.DB_PATH ?? './data/subterfuge.db';
const DEV_MODE = process.env.DEV_MODE === '1';
const DEFAULT_SIM_SPEED = Number(process.env.SIM_SPEED ?? 1);
const TICK_INTERVAL_MS = 500;

const store = new GameStore(DB_PATH);
const registry = new GameRegistry(store, log);
registry.loadActive();

function shutdown(signal: string): void {
  log.info({ signal }, 'shutting down — final persist');
  registry.persistAll();
  store.close();
  process.exit(0);
}
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

const app = new Hono();

app.use('*', async (c, next) => {
  // Same-origin is the canonical path (Vite proxy in dev, server-served
  // client in prod). The permissive CORS remains for tooling, but
  // cookie-authenticated calls only work same-origin.
  c.res.headers.set('Access-Control-Allow-Origin', '*');
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type');
  await next();
});

app.options('*', (c) => c.body(null, 204));

app.onError((err, c) => {
  if (err instanceof SyntaxError) {
    return c.json({ ok: false, error: 'malformed JSON body' }, 400);
  }
  log.error({ err: err.stack ?? String(err) }, 'unhandled route error');
  return c.json({ ok: false, error: 'internal error' }, 500);
});

app.get('/api/health', (c) => c.json({ ok: true }));

// ---------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------

app.post('/api/auth/guest', async (c) => {
  const user = requireUser(c, store);
  const body = (await c.req.json().catch(() => ({}))) as { name?: string };
  if (typeof body.name === 'string') {
    const name = body.name.trim().slice(0, 24);
    if (name.length >= 2) {
      store.renameUser(user.id, name);
      user.name = name;
    }
  }
  return c.json({ ok: true, user });
});

app.get('/api/me', (c) => {
  const user = requireUser(c, store);
  const games = store.gamesForUser(user.id).map((g) => ({
    id: g.id,
    code: g.inviteCode,
    status: g.status,
    playerCount: g.config.playerCount,
    seatsTaken: store.seatsForGame(g.id).length,
    yourSeat: store.seatForUser(g.id, user.id),
    updatedAt: g.updatedAt,
  }));
  return c.json({ user, games });
});

// ---------------------------------------------------------------------
// Lobby: create / inspect / join / leave
// ---------------------------------------------------------------------

/** Short, unambiguous invite code (no 0/O/1/l). */
function newInviteCode(): string {
  const alphabet = 'abcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  for (let i = 0; i < 6; i++) code += alphabet[randomInt(alphabet.length)]!;
  return code;
}

app.post('/api/games', async (c) => {
  const user = requireUser(c, store);
  const body = (await c.req.json().catch(() => ({}))) as {
    playerCount?: number;
    simSpeed?: number;
  };
  const playerCount = Math.floor(Number(body.playerCount ?? 4));
  if (!Number.isFinite(playerCount) || playerCount < 2 || playerCount > 10) {
    return c.json({ ok: false, error: 'playerCount must be 2–10' }, 400);
  }
  const simSpeed = Number(body.simSpeed ?? DEFAULT_SIM_SPEED);
  if (!Number.isFinite(simSpeed) || simSpeed < 1 || simSpeed > 100_000) {
    return c.json({ ok: false, error: 'invalid simSpeed' }, 400);
  }
  const config: GameConfig = { playerCount, simSpeed };
  const code = newInviteCode();
  const id = store.createLobbyGame(config, code);
  store.claimSeat(id, 0, user.id); // creator takes seat 0
  log.info({ gameId: id, code, config, creator: user.id }, 'lobby created');
  return c.json({ ok: true, id, code });
});

function lobbyStateJson(c: Context, code: string) {
  const meta = store.gameMetaByCode(code);
  if (meta === null) return c.json({ ok: false, error: 'no such game' }, 404);
  const user = requireUser(c, store);
  const seats = store.seatsForGame(meta.id);
  return c.json({
    ok: true,
    id: meta.id,
    code,
    status: meta.status,
    playerCount: meta.config.playerCount,
    simSpeed: meta.config.simSpeed,
    seats: seats.map((s) => ({ seat: s.seat, name: s.name })),
    yourSeat: store.seatForUser(meta.id, user.id),
  });
}

app.get('/api/games/:code', (c) => lobbyStateJson(c, c.req.param('code')));

app.post('/api/games/:code/join', (c) => {
  const code = c.req.param('code');
  const meta = store.gameMetaByCode(code);
  if (meta === null) return c.json({ ok: false, error: 'no such game' }, 404);
  if (meta.status !== 'lobby') {
    return c.json({ ok: false, error: 'game already started' }, 409);
  }
  const user = requireUser(c, store);
  if (store.seatForUser(meta.id, user.id) === null) {
    const seats = store.seatsForGame(meta.id);
    if (seats.length >= meta.config.playerCount) {
      return c.json({ ok: false, error: 'game is full' }, 409);
    }
    const taken = new Set(seats.map((s) => s.seat));
    let seat = 0;
    while (taken.has(seat)) seat += 1;
    store.claimSeat(meta.id, seat, user.id);
    log.info({ gameId: meta.id, seat, user: user.id }, 'seat claimed');
  }
  // Start when full.
  const seated = store.seatsForGame(meta.id);
  if (seated.length === meta.config.playerCount) {
    const world = generateWorld({
      seed: randomInt(2 ** 31),
      playerCount: meta.config.playerCount,
    });
    // Seat names become in-world player names.
    for (const s of seated) {
      const p = world.players[s.seat];
      if (p !== undefined) (p as { name: string }).name = s.name;
    }
    store.activateGame(meta.id, world);
    store.insertBaseline(meta.id, world, 0); // genesis epoch anchor
    registry.adopt(meta.id, world, meta.config);
    log.info({ gameId: meta.id, seed: world.seed }, 'lobby full — game started');
  }
  return lobbyStateJson(c, code);
});

app.post('/api/games/:code/leave', (c) => {
  const code = c.req.param('code');
  const meta = store.gameMetaByCode(code);
  if (meta === null) return c.json({ ok: false, error: 'no such game' }, 404);
  if (meta.status !== 'lobby') {
    return c.json({ ok: false, error: 'cannot leave a started game (resign arrives in Phase B)' }, 409);
  }
  const user = requireUser(c, store);
  store.releaseSeat(meta.id, user.id);
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------
// Game-scoped context: host + acting player from the session seat
// ---------------------------------------------------------------------

interface GameCtx {
  host: GameHost;
  actorId: PlayerId;
}

/**
 * Resolve the host + acting PlayerId for a game-scoped route. The
 * actor is the session user's seat. DEV_MODE only: an explicit
 * `ownerId` (body) overrides the seat so the local player-switcher
 * and scripted tests can act as any player.
 */
async function gameCtx(c: Context): Promise<GameCtx | Response> {
  const gameId = Number(c.req.param('gameId'));
  if (!Number.isFinite(gameId)) {
    return c.json({ ok: false, error: 'bad gameId' }, 400);
  }
  let host: GameHost;
  try {
    host = registry.get(gameId);
  } catch {
    return c.json({ ok: false, error: 'no such game (or not started)' }, 404);
  }
  const user = requireUser(c, store);
  const seat = store.seatForUser(gameId, user.id);
  if (DEV_MODE) {
    const body = (await c.req.json().catch(() => ({}))) as { ownerId?: number };
    const q = c.req.query('ownerId');
    const override = body.ownerId ?? (q !== undefined ? Number(q) : undefined);
    if (override !== undefined && Number.isFinite(Number(override))) {
      return { host, actorId: Number(override) as PlayerId };
    }
  }
  if (seat === null) {
    return c.json({ ok: false, error: 'you do not hold a seat in this game' }, 403);
  }
  return { host, actorId: seat as PlayerId };
}

function isResponse(x: GameCtx | Response): x is Response {
  return x instanceof Response;
}

// ---------------------------------------------------------------------
// State / meta / replay
// ---------------------------------------------------------------------

app.get('/api/g/:gameId/state', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) {
    // DEV_MODE spectator: an unseated viewer may still read the world.
    if (DEV_MODE) {
      const gameId = Number(c.req.param('gameId'));
      if (Number.isFinite(gameId) && registry.has(gameId)) {
        return c.json({ ...registry.get(gameId).world, seed: 0 });
      }
    }
    return ctx;
  }
  return c.json(viewForPlayer(ctx.host.world, ctx.actorId));
});

app.get('/api/g/:gameId/meta', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const baseline = store.latestBaseline(ctx.host.id);
  return c.json({
    gameId: ctx.host.id,
    simVersion: SIM_VERSION,
    epochFloor: baseline?.simAt ?? 0,
    yourSeat: ctx.actorId,
    simSpeed: ctx.host.simSpeed,
  });
});

app.get('/api/g/:gameId/replay', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const atParam = c.req.query('at');
  if (atParam === undefined) {
    return c.json({ error: 'missing required `at` query' }, 400);
  }
  const at = Number(atParam);
  if (!Number.isFinite(at) || at < 0) {
    return c.json({ error: 'invalid `at`' }, 400);
  }
  if (at >= host.world.time) {
    return c.json(viewForPlayer(host.world, actorId));
  }
  const baseline = store.latestBaseline(host.id);
  if (baseline !== null && at < baseline.simAt) {
    return c.json(
      {
        error:
          `time ${at} predates the current epoch baseline (sim ${baseline.simVersion} at ` +
          `${baseline.simAt}) — history below it cannot be replayed`,
      },
      409,
    );
  }
  const checkpoint = store.latestCheckpointBefore(host.id, at);
  const usableCheckpoint =
    checkpoint !== null &&
    checkpoint.simVersion === SIM_VERSION &&
    (baseline === null || checkpoint.simAt >= baseline.simAt)
      ? checkpoint
      : null;
  const base = usableCheckpoint ?? baseline;
  const events = store.listEventsAfterIdUpTo(host.id, base?.lastEventId ?? 0, at);
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
          seed: host.world.seed,
          playerCount: host.world.players.length,
          events: events.map((e) => e.event),
          targetTime: at,
        };
  const replayed = replayFrom(opts);
  return c.json(viewForPlayer(replayed, actorId));
});

// ---------------------------------------------------------------------
// Orders (all game-scoped; actor comes from the seat)
// ---------------------------------------------------------------------

async function deferAndRespond(
  c: Context,
  host: GameHost,
  command: DeferableCommand,
): Promise<Response> {
  try {
    const id = defer(host.world, { issuedAt: host.world.time, command });
    host.recordEvent({ kind: 'defer', command });
    host.broadcast();
    log.info({ gameId: host.id, kind: command.kind, owner: command.ownerId, id }, 'command deferred');
    return c.json({ ok: true, pendingId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
}

app.post('/api/g/:gameId/orders/launch', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as {
    sourceId: number;
    destinationId: number;
    drillers: number;
    giftTo?: number;
    specialistIds?: number[];
  };
  try {
    const order = {
      ownerId: actorId,
      sourceId: body.sourceId as OutpostId,
      destinationId: body.destinationId as OutpostId,
      drillers: body.drillers,
      ...(typeof body.giftTo === 'number' ? { giftTo: body.giftTo as PlayerId } : {}),
      ...(body.specialistIds && body.specialistIds.length > 0
        ? { specialistIds: body.specialistIds as unknown as SpecialistId[] }
        : {}),
    };
    const id = issueLaunchOrder(host.world, order);
    host.recordEvent({ kind: 'launch', ...order });
    host.broadcast();
    return c.json({ ok: true, subId: id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/g/:gameId/chat', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as { to: number | null; text: string };
  try {
    const m = appendMessage(host.world, {
      from: actorId,
      to: body.to === null ? null : (body.to as PlayerId),
      text: body.text,
    });
    host.recordEvent({
      kind: 'chat',
      from: actorId,
      to: body.to === null ? null : (body.to as PlayerId),
      text: body.text,
    });
    host.broadcast();
    return c.json({ ok: true, id: m.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/g/:gameId/orders/hire', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const body = (await c.req.json()) as { kind: string };
  return deferAndRespond(c, ctx.host, {
    kind: 'hire',
    ownerId: ctx.actorId,
    specialistKind: body.kind as SpecialistKind,
  });
});

app.post('/api/g/:gameId/orders/hire/now', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as { kind: string };
  try {
    const spec = executeHire(host.world, {
      ownerId: actorId,
      kind: body.kind as SpecialistKind,
    });
    host.recordEvent({
      kind: 'hire',
      ownerId: actorId,
      specialistKind: body.kind as SpecialistKind,
    });
    host.broadcast();
    return c.json({ ok: true, specialistId: spec.id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/g/:gameId/orders/promote', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const body = (await c.req.json()) as { specialistId: number };
  return deferAndRespond(c, ctx.host, {
    kind: 'promote',
    ownerId: ctx.actorId,
    specialistId: body.specialistId as unknown as SpecialistId,
  });
});

app.post('/api/g/:gameId/orders/promote/now', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as { specialistId: number };
  try {
    executePromote(host.world, { ownerId: actorId, specialistId: body.specialistId });
    host.recordEvent({
      kind: 'promote',
      ownerId: actorId,
      specialistId: body.specialistId as unknown as SpecialistId,
    });
    host.broadcast();
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/g/:gameId/orders/pirate-target', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const body = (await c.req.json()) as { subId: number; targetSubId: number };
  return deferAndRespond(c, ctx.host, {
    kind: 'pirate-target',
    ownerId: ctx.actorId,
    subId: body.subId as unknown as SubId,
    targetSubId: body.targetSubId as unknown as SubId,
  });
});

app.post('/api/g/:gameId/orders/release-captive', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const body = (await c.req.json()) as { specialistId: number };
  return deferAndRespond(c, ctx.host, {
    kind: 'release-captive',
    ownerId: ctx.actorId,
    specialistId: body.specialistId as unknown as SpecialistId,
  });
});

app.post('/api/g/:gameId/orders/release-captive/now', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as { specialistId: number };
  try {
    executeReleaseCaptive(host.world, {
      ownerId: actorId,
      specialistId: body.specialistId,
    });
    host.recordEvent({
      kind: 'release-captive',
      ownerId: actorId,
      specialistId: body.specialistId as unknown as SpecialistId,
    });
    host.broadcast();
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/g/:gameId/orders/redirect', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const body = (await c.req.json()) as { subId: number; newDestinationId: number };
  return deferAndRespond(c, ctx.host, {
    kind: 'redirect',
    ownerId: ctx.actorId,
    subId: body.subId as unknown as SubId,
    newDestinationId: body.newDestinationId as OutpostId,
  });
});

app.post('/api/g/:gameId/orders/cancel-sub', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as { subId: number };
  try {
    cancelSub(host.world, { ownerId: actorId, subId: body.subId as unknown as SubId });
    host.recordEvent({
      kind: 'cancel-sub',
      ownerId: actorId,
      subId: body.subId as unknown as SubId,
    });
    host.broadcast();
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/g/:gameId/orders/edit-prelaunch-sub', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as {
    subId: number;
    drillers: number;
    specialistIds?: number[];
  };
  try {
    const specialistIds =
      body.specialistIds !== undefined
        ? (body.specialistIds as unknown as SpecialistId[])
        : undefined;
    editPreLaunchSub(host.world, {
      ownerId: actorId,
      subId: body.subId as unknown as SubId,
      drillers: body.drillers,
      ...(specialistIds !== undefined ? { specialistIds } : {}),
    });
    host.recordEvent({
      kind: 'edit-prelaunch-sub',
      ownerId: actorId,
      subId: body.subId as unknown as SubId,
      drillers: body.drillers,
      ...(specialistIds !== undefined ? { specialistIds } : {}),
    });
    host.broadcast();
    return c.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/g/:gameId/orders/drill', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const body = (await c.req.json()) as { outpostId: number };
  return deferAndRespond(c, ctx.host, {
    kind: 'drill',
    ownerId: ctx.actorId,
    outpostId: body.outpostId as OutpostId,
  });
});

app.delete('/api/g/:gameId/pending/:id', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ ok: false, error: 'bad id' }, 400);
  const ok = cancelPending(host.world, id as unknown as PendingCommandId, actorId);
  if (!ok) return c.json({ ok: false, error: 'not found or not yours' }, 404);
  host.recordEvent({
    kind: 'cancel-pending',
    ownerId: actorId,
    pendingId: id as unknown as PendingCommandId,
  });
  host.broadcast();
  return c.json({ ok: true });
});

app.post('/api/g/:gameId/pending/:id/finalize', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ ok: false, error: 'bad id' }, 400);
  const r = finalizePending(host.world, id as unknown as PendingCommandId, actorId);
  if (!r.ok) return c.json({ ok: false, error: r.reason ?? 'finalize failed' }, 400);
  host.recordEvent({
    kind: 'finalize-pending',
    ownerId: actorId,
    pendingId: id as unknown as PendingCommandId,
  });
  host.broadcast();
  return c.json({ ok: true });
});

app.post('/api/g/:gameId/queue/launch', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as {
    executeAt: number;
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
    const id = queueLaunch(host.world, {
      executeAt: body.executeAt,
      ownerId: actorId,
      sourceId: body.sourceId as OutpostId,
      destinationId: body.destinationId as OutpostId,
      drillers: body.drillers,
      ...(giftTo !== undefined ? { giftTo } : {}),
      ...(specialistIds !== undefined ? { specialistIds } : {}),
      ...(pirateTargetSubId !== undefined ? { pirateTargetSubId } : {}),
    });
    host.recordEvent({
      kind: 'queue-launch',
      ownerId: actorId,
      sourceId: body.sourceId as OutpostId,
      destinationId: body.destinationId as OutpostId,
      drillers: body.drillers,
      executeAt: body.executeAt,
      ...(giftTo !== undefined ? { giftTo } : {}),
      ...(specialistIds !== undefined ? { specialistIds } : {}),
      ...(pirateTargetSubId !== undefined ? { pirateTargetSubId } : {}),
    });
    host.broadcast();
    return c.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/g/:gameId/queue/drill', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as { executeAt: number; outpostId: number };
  try {
    const id = queueDrill(host.world, {
      executeAt: body.executeAt,
      ownerId: actorId,
      outpostId: body.outpostId as OutpostId,
    });
    host.recordEvent({
      kind: 'queue-drill',
      ownerId: actorId,
      outpostId: body.outpostId as OutpostId,
      executeAt: body.executeAt,
    });
    host.broadcast();
    return c.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/g/:gameId/queue/hire', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as { executeAt: number; kind: string };
  try {
    const id = queueHire(host.world, {
      executeAt: body.executeAt,
      ownerId: actorId,
      specialistKind: body.kind as SpecialistKind,
    });
    host.recordEvent({
      kind: 'queue-hire',
      ownerId: actorId,
      specialistKind: body.kind as SpecialistKind,
      executeAt: body.executeAt,
    });
    host.broadcast();
    return c.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/g/:gameId/queue/promote', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as { executeAt: number; specialistId: number };
  try {
    const id = queuePromote(host.world, {
      executeAt: body.executeAt,
      ownerId: actorId,
      specialistId: body.specialistId as unknown as SpecialistId,
    });
    host.recordEvent({
      kind: 'queue-promote',
      ownerId: actorId,
      specialistId: body.specialistId as unknown as SpecialistId,
      executeAt: body.executeAt,
    });
    host.broadcast();
    return c.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/g/:gameId/queue/redirect', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as {
    executeAt: number;
    subId: number;
    newDestinationId: number;
  };
  try {
    const id = queueRedirect(host.world, {
      executeAt: body.executeAt,
      ownerId: actorId,
      subId: body.subId as unknown as SubId,
      newDestinationId: body.newDestinationId as OutpostId,
    });
    host.recordEvent({
      kind: 'queue-redirect',
      ownerId: actorId,
      subId: body.subId as unknown as SubId,
      newDestinationId: body.newDestinationId as OutpostId,
      executeAt: body.executeAt,
    });
    host.broadcast();
    return c.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.post('/api/g/:gameId/queue/pirate-target', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const body = (await c.req.json()) as {
    executeAt: number;
    subId: number;
    targetSubId: number;
  };
  try {
    const id = queuePirateTarget(host.world, {
      executeAt: body.executeAt,
      ownerId: actorId,
      subId: body.subId as unknown as SubId,
      targetSubId: body.targetSubId as unknown as SubId,
    });
    host.recordEvent({
      kind: 'queue-pirate-target',
      ownerId: actorId,
      subId: body.subId as unknown as SubId,
      targetSubId: body.targetSubId as unknown as SubId,
      executeAt: body.executeAt,
    });
    host.broadcast();
    return c.json({ ok: true, id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return c.json({ ok: false, error: msg }, 400);
  }
});

app.delete('/api/g/:gameId/queue/:id', async (c) => {
  const ctx = await gameCtx(c);
  if (isResponse(ctx)) return ctx;
  const { host, actorId } = ctx;
  const id = Number(c.req.param('id'));
  if (!Number.isFinite(id)) return c.json({ ok: false, error: 'bad id' }, 400);
  const removed = cancelQueuedOrder(host.world, id as QueuedOrderId, actorId);
  if (!removed) return c.json({ ok: false, error: 'not found or not yours' }, 404);
  host.recordEvent({
    kind: 'cancel-queued',
    ownerId: actorId,
    orderId: id as QueuedOrderId,
  });
  host.broadcast();
  return c.json({ ok: true });
});

// ---------------------------------------------------------------------
// HTTP + WS
// ---------------------------------------------------------------------

const httpServer = serve({ fetch: app.fetch, port: PORT }, (info) => {
  log.info(
    `HTTP listening on http://localhost:${info.port} (DEV_MODE=${DEV_MODE ? '1' : '0'})`,
  );
});

const wss = new WebSocketServer({
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  server: httpServer as any,
  path: '/ws',
});

wss.on('connection', (ws, req) => {
  const url = new URL(req.url ?? '/ws', 'http://localhost');
  const gameId = Number(url.searchParams.get('gameId'));
  if (!Number.isFinite(gameId)) {
    ws.close(4400, 'gameId required');
    return;
  }
  let host: GameHost;
  try {
    host = registry.get(gameId);
  } catch {
    ws.close(4404, 'no such game');
    return;
  }
  // Seat from the session cookie; DEV_MODE allows ?playerId override
  // (player-switcher / spectator).
  const user = userFromCookieHeader(req.headers.cookie, store);
  let playerId: PlayerId | null =
    user !== null ? (store.seatForUser(gameId, user.id) as PlayerId | null) : null;
  if (DEV_MODE) {
    const raw = url.searchParams.get('playerId');
    if (raw !== null) {
      const n = Number(raw);
      playerId =
        Number.isFinite(n) && n >= 0 && n < host.world.players.length
          ? (n as PlayerId)
          : null;
    }
  } else if (playerId === null) {
    ws.close(4403, 'no seat in this game');
    return;
  }
  const meta: ClientMeta = { ws, playerId };
  host.clients.add(meta);
  log.info({ gameId, clients: host.clients.size, playerId }, 'ws client connected');
  ws.send(host.stateMessageFor(playerId));
  ws.on('close', () => {
    host.clients.delete(meta);
  });
  ws.on('error', (err) => {
    log.warn({ err: err.message }, 'ws client error');
  });
});

wss.on('error', (err) => {
  log.error({ err: err.message }, 'ws server error');
});

// ---------------------------------------------------------------------
// Tick loop — all active games
// ---------------------------------------------------------------------

setInterval(() => {
  registry.tickAll(TICK_INTERVAL_MS);
  // Flip games whose winner just emerged to 'finished' (exactly once).
  for (const host of registry.all()) {
    if (host.world.winnerId !== null && !host.finishedRecorded) {
      host.finishedRecorded = true;
      host.persist(true);
      store.setGameStatus(host.id, 'finished');
      host.broadcast();
      log.info({ gameId: host.id, winner: host.world.winnerId }, 'game finished');
    }
  }
}, TICK_INTERVAL_MS);
