import { describe, expect, it } from 'vitest';
import { hasQueenAt } from '../src/specialists.js';
import { generateWorld } from '../src/world-gen.js';
import {
  cancelQueuedOrder,
  queueDrill,
  queueHire,
  queueLaunch,
  queuePromote,
} from '../src/queued-orders.js';
import { hireRoster, previewHireRosters } from '../src/hiring.js';
import { tick } from '../src/tick.js';
import {
  DAY_MS,
  HIRE_INITIAL_MS,
  HOUR_MS,
  LAUNCH_DELAY_MS,
} from '../src/types.js';

describe('queued orders', () => {
  it('rejects executeAt in the past or present', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    expect(() =>
      queueLaunch(w, {
        executeAt: 0,
        ownerId: w.players[0]!.id,
        sourceId: w.outposts[0]!.id,
        destinationId: w.outposts[1]!.id,
        drillers: 5,
      }),
    ).toThrow();
    tick(w, 100);
    expect(() =>
      queueLaunch(w, {
        executeAt: 50,
        ownerId: w.players[0]!.id,
        sourceId: w.outposts[0]!.id,
        destinationId: w.outposts[1]!.id,
        drillers: 5,
      }),
    ).toThrow();
  });

  it('queues then dispatches a launch at executeAt', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const source = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const target = w.outposts.find((o) => o.ownerId === null)!;
    const executeAt = HOUR_MS;
    queueLaunch(w, {
      executeAt,
      ownerId: me,
      sourceId: source.id,
      destinationId: target.id,
      drillers: 5,
    });
    expect(w.queuedOrders).toHaveLength(1);

    // Tick to just before — order still queued
    tick(w, executeAt - 1);
    expect(w.queuedOrders).toHaveLength(1);
    expect(w.subs).toHaveLength(0);

    // Tick past — order dispatched as a real sub
    tick(w, 2);
    expect(w.queuedOrders).toHaveLength(0);
    expect(w.subs).toHaveLength(1);
    // The sub respects the normal 10-min launch delay from its execution.
    expect(w.subs[0]!.launchAt).toBe(executeAt + LAUNCH_DELAY_MS);
  });

  it('cancelQueuedOrder removes a pending order', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const source = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const target = w.outposts.find((o) => o.ownerId === null)!;
    const id = queueLaunch(w, {
      executeAt: HOUR_MS,
      ownerId: me,
      sourceId: source.id,
      destinationId: target.id,
      drillers: 5,
    });
    // Another player cannot cancel my order.
    expect(cancelQueuedOrder(w, id, w.players[1]!.id)).toBe(false);
    expect(w.queuedOrders).toHaveLength(1);
    expect(cancelQueuedOrder(w, id, me)).toBe(true);
    expect(w.queuedOrders).toHaveLength(0);
    tick(w, DAY_MS);
    expect(w.subs).toHaveLength(0);
  });

  it('drops invalid orders silently at dispatch time', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const source = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const target = w.outposts.find((o) => o.ownerId === null)!;
    // Queue a launch but then drain the source's drillers before
    // executeAt arrives — the dispatch will fail validation.
    queueLaunch(w, {
      executeAt: HOUR_MS,
      ownerId: me,
      sourceId: source.id,
      destinationId: target.id,
      drillers: source.drillers + 100, // intentionally too many
    });
    tick(w, 2 * HOUR_MS);
    expect(w.subs).toHaveLength(0);
    expect(w.queuedOrders).toHaveLength(0); // removed from queue regardless
  });

  it('queueDrill dispatches a drill order at executeAt', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const source = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.kind === 'factory',
    )!;
    source.drillers = 100;
    queueDrill(w, {
      executeAt: HOUR_MS,
      ownerId: me,
      outpostId: source.id,
    });
    tick(w, 2 * HOUR_MS);
    expect(source.kind).toBe('mine');
    expect(source.drillers).toBe(50); // 100 - 50 first-mine cost
  });

  it('queueHire dispatches a hire at executeAt — no extra 10-min delay', () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    // Schedule a hire well past the initial-wait threshold.
    const scheduleAt = HIRE_INITIAL_MS + HOUR_MS;
    const before = w.specialists.length;
    const roster = previewHireRosters(w, me, 1)[0]!;
    queueHire(w, {
      executeAt: scheduleAt,
      ownerId: me,
      specialistKind: roster.offensive!,
    });
    // Tick just past executeAt: hire fires immediately (no 10-min padding).
    tick(w, scheduleAt + 1000);
    expect(w.specialists.length).toBe(before + 1);
    expect(w.queuedOrders).toHaveLength(0);
  });

  it('queuePromote dispatches a promotion at executeAt', () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    // First, set up: hire a Foreman directly (promotion target) by
    // bypassing the queue.
    w.time = HIRE_INITIAL_MS;
    const roster = hireRoster(w, me);
    const offered = roster.other ?? roster.defensive ?? roster.offensive!;
    // Skip the queue and just spawn a specialist for the promotion test.
    // We're testing the queue-promote dispatch logic, not hire validity.
    const queen = w.specialists.find(
      (s) => s.kind === 'queen' && s.ownerId === me,
    )!;
    const home =
      queen.location.kind === 'outpost'
        ? queen.location.id
        : (w.outposts.find((o) => o.ownerId === me)!.id);
    // Force-add a foreman next to the queen so promotion is valid.
    w.specialists.push({
      id: w.nextSpecialistId as never,
      ownerId: me,
      kind: 'foreman',
      location: { kind: 'outpost', id: home },
      state: 'active',
    });
    const foremanId = w.nextSpecialistId as never;
    w.nextSpecialistId += 1;
    // Mark hire as not yet done so promote is allowed.
    void offered;
    const scheduleAt = w.time + HOUR_MS;
    queuePromote(w, {
      executeAt: scheduleAt,
      ownerId: me,
      specialistId: foremanId,
    });
    tick(w, HOUR_MS + 1000);
    const after = w.specialists.find(
      (s) => (s.id as unknown as number) === (foremanId as unknown as number),
    );
    expect(after?.kind).toBe('engineer');
    expect(w.queuedOrders).toHaveLength(0);
  });
});

describe('previewHireRosters', () => {
  it('returns the current roster as element 0', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    w.time = HIRE_INITIAL_MS;
    const live = hireRoster(w, me);
    const previews = previewHireRosters(w, me, 1);
    expect(previews).toHaveLength(1);
    expect(previews[0]).toEqual(live);
  });

  it('is deterministic across calls', () => {
    const w = generateWorld({ seed: 99, playerCount: 4 });
    const me = w.players[0]!.id;
    w.time = HIRE_INITIAL_MS;
    const a = previewHireRosters(w, me, 5);
    const b = previewHireRosters(w, me, 5);
    expect(a).toEqual(b);
  });

  it('threads exclusion: roster N+1 never re-offers a kind from roster N', () => {
    const w = generateWorld({ seed: 99, playerCount: 4 });
    const me = w.players[0]!.id;
    w.time = HIRE_INITIAL_MS;
    const previews = previewHireRosters(w, me, 4);
    for (let i = 0; i < previews.length - 1; i++) {
      const prev = previews[i]!;
      const next = previews[i + 1]!;
      const prevKinds = new Set(
        [prev.offensive, prev.defensive, prev.other].filter(
          (x): x is NonNullable<typeof x> => x !== null,
        ),
      );
      for (const k of [next.offensive, next.defensive, next.other]) {
        if (k !== null) expect(prevKinds.has(k)).toBe(false);
      }
    }
  });
});
