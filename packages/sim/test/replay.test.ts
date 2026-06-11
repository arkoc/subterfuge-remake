import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { tick } from '../src/tick.js';
import { issueLaunchOrder } from '../src/orders.js';
import { queueLaunch, cancelQueuedOrder } from '../src/queued-orders.js';
import { executeHire } from '../src/hiring.js';
import { hireRoster, rosterKinds } from '../src/hiring.js';
import { appendMessage } from '../src/diplomacy.js';
import { hasQueenAt } from '../src/specialists.js';
import { replayFrom, type GameEvent } from '../src/replay.js';
import {
  DAY_MS,
  HIRE_INITIAL_MS,
  HOUR_MS,
  type OutpostId,
} from '../src/types.js';

describe('replay — round-trips an event log into the same world', () => {
  it('seed + empty log + tick reproduces the world', () => {
    const live = generateWorld({ seed: 42, playerCount: 4 });
    tick(live, 6 * HOUR_MS);
    const replayed = replayFrom({
      seed: 42,
      playerCount: 4,
      events: [],
      targetTime: live.time,
    });
    expect(replayed).toEqual(live);
  });

  it('a single launch event reproduces post-launch world', () => {
    const seed = 99;
    const live = generateWorld({ seed, playerCount: 4 });
    tick(live, 30 * 60_000);
    const me = live.players[0]!.id;
    const src = live.outposts.find((o) => o.ownerId === me && !hasQueenAt(live, o.id))!;
    const dst = live.outposts.find((o) => o.ownerId === null)!;
    issueLaunchOrder(live, {
      ownerId: me, sourceId: src.id, destinationId: dst.id, drillers: 10,
    });
    tick(live, 12 * HOUR_MS);

    const events: GameEvent[] = [
      {
        simAt: 30 * 60_000,
        kind: 'launch',
        ownerId: me,
        sourceId: src.id,
        destinationId: dst.id,
        drillers: 10,
      },
    ];
    const replayed = replayFrom({
      seed,
      playerCount: 4,
      events,
      targetTime: live.time,
    });
    expect(replayed).toEqual(live);
  });

  it('mixed orders + queued + cancelled + hire all reproduce', () => {
    const seed = 13;
    const live = generateWorld({ seed, playerCount: 4 });
    const me = live.players[0]!.id;

    // t = 30m: launch
    tick(live, 30 * 60_000);
    const src = live.outposts.find((o) => o.ownerId === me && !hasQueenAt(live, o.id))!;
    const dst = live.outposts.find((o) => o.ownerId === null)!;
    issueLaunchOrder(live, {
      ownerId: me, sourceId: src.id, destinationId: dst.id, drillers: 5,
    });
    const t1 = live.time;

    // t = 1h: queue a launch for t+2h
    tick(live, HOUR_MS - 30 * 60_000);
    const queuedId = queueLaunch(live, {
      ownerId: me, sourceId: src.id, destinationId: dst.id, drillers: 3,
      executeAt: live.time + 2 * HOUR_MS,
    });
    const t2 = live.time;

    // t = 1h 10m: cancel the queued
    tick(live, 10 * 60_000);
    cancelQueuedOrder(live, queuedId, me);
    const t3 = live.time;

    // t = 4h: hire
    tick(live, HIRE_INITIAL_MS - live.time);
    const roster = hireRoster(live, me);
    const chosen = rosterKinds(roster)[0]!;
    executeHire(live, { ownerId: me, kind: chosen });
    const t4 = live.time;

    // t = 6h: chat
    tick(live, 6 * HOUR_MS - live.time);
    appendMessage(live, { from: me, to: null, text: 'hello world' });
    const t5 = live.time;

    tick(live, 30 * 60_000);

    const events: GameEvent[] = [
      { simAt: t1, kind: 'launch', ownerId: me, sourceId: src.id, destinationId: dst.id, drillers: 5 },
      {
        simAt: t2, kind: 'queue-launch', ownerId: me,
        sourceId: src.id, destinationId: dst.id, drillers: 3,
        executeAt: t2 + 2 * HOUR_MS,
      },
      { simAt: t3, kind: 'cancel-queued', ownerId: me, orderId: queuedId },
      { simAt: t4, kind: 'hire', ownerId: me, specialistKind: chosen },
      { simAt: t5, kind: 'chat', from: me, to: null, text: 'hello world' },
    ];

    const replayed = replayFrom({
      seed,
      playerCount: 4,
      events,
      targetTime: live.time,
    });
    expect(replayed).toEqual(live);
  });
});

describe('replay — base snapshot acceleration', () => {
  it('replaying from a snapshot equals replaying from scratch to the same target', () => {
    const seed = 77;
    const playerCount = 4;
    const live = generateWorld({ seed, playerCount });
    const me = live.players[0]!.id;

    // Build a small event log.
    tick(live, 30 * 60_000);
    const src = live.outposts.find((o) => o.ownerId === me && !hasQueenAt(live, o.id))!;
    const dst = live.outposts.find((o) => o.ownerId === null)!;
    const events: GameEvent[] = [];

    issueLaunchOrder(live, {
      ownerId: me, sourceId: src.id, destinationId: dst.id, drillers: 5,
    });
    events.push({
      simAt: live.time, kind: 'launch', ownerId: me,
      sourceId: src.id, destinationId: dst.id, drillers: 5,
    });

    tick(live, 3 * HOUR_MS);
    const snapshot = JSON.parse(JSON.stringify(live)) as typeof live;
    tick(live, 9 * HOUR_MS);

    const targetTime = live.time;
    const fromScratch = replayFrom({ seed, playerCount, events, targetTime });
    const fromSnapshot = replayFrom({
      seed, playerCount, events, targetTime, baseSnapshot: snapshot,
    });
    expect(fromSnapshot).toEqual(fromScratch);
    expect(fromSnapshot).toEqual(live);
  });
});

describe('replay — invalid events drop without throwing', () => {
  it('a launch from an outpost the player no longer owns is dropped silently', () => {
    const seed = 31;
    const live = generateWorld({ seed, playerCount: 4 });
    // Force an invalid launch event after a long delay so the world
    // state has changed.
    const me = live.players[0]!.id;
    const bogusOutpostId = 999 as unknown as OutpostId;
    const events: GameEvent[] = [
      {
        simAt: HOUR_MS, kind: 'launch', ownerId: me,
        sourceId: bogusOutpostId, destinationId: bogusOutpostId,
        drillers: 1,
      },
    ];
    // Should not throw.
    const replayed = replayFrom({
      seed, playerCount: 4, events, targetTime: 2 * HOUR_MS,
    });
    // No sub created.
    expect(replayed.subs).toHaveLength(0);
  });
});

describe('replay — target time can be before any event', () => {
  it('targetTime earlier than the first event still works', () => {
    const seed = 13;
    const live = generateWorld({ seed, playerCount: 4 });
    tick(live, 30 * 60_000);
    const events: GameEvent[] = [
      {
        simAt: 5 * DAY_MS, kind: 'chat', from: live.players[0]!.id,
        to: null, text: 'far future',
      },
    ];
    const replayed = replayFrom({
      seed, playerCount: 4, events, targetTime: 30 * 60_000,
    });
    expect(replayed).toEqual(live);
  });
});

