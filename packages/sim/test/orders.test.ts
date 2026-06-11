import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { cancelSub, editPreLaunchSub, issueLaunchOrder } from '../src/orders.js';
import { hasQueenAt } from '../src/specialists.js';
import { tick } from '../src/tick.js';
import type { OutpostId, PlayerId, SubId } from '../src/types.js';
import { LAUNCH_DELAY_MS } from '../src/types.js';

function firstOwned(
  world: ReturnType<typeof generateWorld>,
  playerId: PlayerId,
  withDrillers = true,
) {
  return world.outposts.find(
    (o) =>
      o.ownerId === playerId &&
      !hasQueenAt(world, o.id) &&
      (!withDrillers || o.drillers > 0),
  )!;
}

function firstDormant(world: ReturnType<typeof generateWorld>) {
  return world.outposts.find((o) => o.ownerId === null)!;
}

describe('issueLaunchOrder — validation', () => {
  it('rejects 0 or negative drillers', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const source = firstOwned(w, w.players[0]!.id);
    const dest = firstDormant(w);
    expect(() =>
      issueLaunchOrder(w, {
        ownerId: w.players[0]!.id,
        sourceId: source.id,
        destinationId: dest.id,
        drillers: 0,
      }),
    ).toThrow();
    expect(() =>
      issueLaunchOrder(w, {
        ownerId: w.players[0]!.id,
        sourceId: source.id,
        destinationId: dest.id,
        drillers: -1,
      }),
    ).toThrow();
  });

  it('rejects same source and destination', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const source = firstOwned(w, w.players[0]!.id);
    expect(() =>
      issueLaunchOrder(w, {
        ownerId: w.players[0]!.id,
        sourceId: source.id,
        destinationId: source.id,
        drillers: 5,
      }),
    ).toThrow();
  });

  it('rejects when source is not owned by the player', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const otherPlayer = w.players[1]!.id;
    const source = firstOwned(w, w.players[0]!.id);
    const dest = firstDormant(w);
    expect(() =>
      issueLaunchOrder(w, {
        ownerId: otherPlayer,
        sourceId: source.id,
        destinationId: dest.id,
        drillers: 5,
      }),
    ).toThrow();
  });

  it('rejects when source has insufficient drillers', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const source = firstOwned(w, w.players[0]!.id);
    const dest = firstDormant(w);
    expect(() =>
      issueLaunchOrder(w, {
        ownerId: w.players[0]!.id,
        sourceId: source.id,
        destinationId: dest.id,
        drillers: source.drillers + 1,
      }),
    ).toThrow();
  });

  it('allows targeting an enemy-owned outpost (Phase 4+ combat)', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const source = firstOwned(w, w.players[0]!.id);
    const enemy = w.outposts.find((o) => o.ownerId === w.players[1]!.id)!;
    expect(() =>
      issueLaunchOrder(w, {
        ownerId: w.players[0]!.id,
        sourceId: source.id,
        destinationId: enemy.id,
        drillers: 5,
      }),
    ).not.toThrow();
  });

  it('rejects unknown outpost ids', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const source = firstOwned(w, w.players[0]!.id);
    expect(() =>
      issueLaunchOrder(w, {
        ownerId: w.players[0]!.id,
        sourceId: source.id,
        destinationId: 9999 as OutpostId,
        drillers: 5,
      }),
    ).toThrow();
  });
});

describe('issueLaunchOrder — happy path', () => {
  it('creates a sub, deducts drillers from source, returns its id', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const source = firstOwned(w, w.players[0]!.id);
    const dest = firstDormant(w);
    const sourceDrillersBefore = source.drillers;

    const id = issueLaunchOrder(w, {
      ownerId: w.players[0]!.id,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 10,
    });

    expect(w.subs).toHaveLength(1);
    expect(source.drillers).toBe(sourceDrillersBefore - 10);
    const sub = w.subs[0]!;
    expect(sub.id).toBe(id);
    expect(sub.drillers).toBe(10);
    expect(sub.ownerId).toBe(w.players[0]!.id);
  });

  it('schedules launchAt at now + 10 min and arrivalAt strictly after', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const source = firstOwned(w, w.players[0]!.id);
    const dest = firstDormant(w);
    const start = w.time;
    issueLaunchOrder(w, {
      ownerId: w.players[0]!.id,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 5,
    });
    const sub = w.subs[0]!;
    expect(sub.launchAt).toBe(start + LAUNCH_DELAY_MS);
    expect(sub.arrivalAt).toBeGreaterThan(sub.launchAt);
  });

  it('multiple launches assign monotonic sub ids', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const source = firstOwned(w, w.players[0]!.id);
    const a = w.outposts.find((o) => o.ownerId === null)!;
    const b = w.outposts.find((o) => o.ownerId === null && o.id !== a.id)!;
    const id1 = issueLaunchOrder(w, {
      ownerId: w.players[0]!.id,
      sourceId: source.id,
      destinationId: a.id,
      drillers: 3,
    });
    const id2 = issueLaunchOrder(w, {
      ownerId: w.players[0]!.id,
      sourceId: source.id,
      destinationId: b.id,
      drillers: 4,
    });
    expect(id2).toBe(((id1 as number) + 1) as typeof id2);
  });

  it('allows reinforcement to a friendly outpost', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const owned = w.outposts.filter((o) => o.ownerId === w.players[0]!.id);
    const source = owned.find((o) => o.drillers > 0)!;
    const friendly = owned.find((o) => o.id !== source.id)!;
    expect(() =>
      issueLaunchOrder(w, {
        ownerId: w.players[0]!.id,
        sourceId: source.id,
        destinationId: friendly.id,
        drillers: 5,
      }),
    ).not.toThrow();
  });
});

describe('cancelSub — pre-launch only', () => {
  it('refunds drillers to source and removes the sub', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const ownerId = w.players[0]!.id;
    const source = firstOwned(w, ownerId);
    const dest = firstDormant(w);
    const startDrillers = source.drillers;
    const subId = issueLaunchOrder(w, {
      ownerId,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 7,
    });
    expect(source.drillers).toBe(startDrillers - 7);
    expect(w.subs.some((s) => s.id === subId)).toBe(true);

    cancelSub(w, { ownerId, subId });

    expect(source.drillers).toBe(startDrillers);
    expect(w.subs.some((s) => s.id === subId)).toBe(false);
  });

  it('rejects cancel after the 10-minute launch window', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const ownerId = w.players[0]!.id;
    const source = firstOwned(w, ownerId);
    const dest = firstDormant(w);
    const subId = issueLaunchOrder(w, {
      ownerId,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 3,
    });
    // Tick past the launch window.
    tick(w, LAUNCH_DELAY_MS + 1000);
    expect(() => cancelSub(w, { ownerId, subId })).toThrow(/already launched/);
  });

  it('rejects cancel from a non-owner', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const ownerId = w.players[0]!.id;
    const otherId = w.players[1]!.id;
    const source = firstOwned(w, ownerId);
    const dest = firstDormant(w);
    const subId = issueLaunchOrder(w, {
      ownerId,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 2,
    });
    expect(() => cancelSub(w, { ownerId: otherId, subId })).toThrow(
      /not owned/,
    );
  });

  it('rejects on unknown sub id', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    expect(() =>
      cancelSub(w, {
        ownerId: w.players[0]!.id,
        subId: 99999 as unknown as SubId,
      }),
    ).toThrow(/not found/);
  });
});

describe('editPreLaunchSub — adjust drillers in window', () => {
  it('increases drillers by drawing from source', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const ownerId = w.players[0]!.id;
    const source = firstOwned(w, ownerId);
    const dest = firstDormant(w);
    const startDrillers = source.drillers;
    const subId = issueLaunchOrder(w, {
      ownerId,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 3,
    });
    editPreLaunchSub(w, { ownerId, subId, drillers: 5 });
    const sub = w.subs.find((s) => s.id === subId)!;
    expect(sub.drillers).toBe(5);
    expect(source.drillers).toBe(startDrillers - 5);
  });

  it('decreases drillers and returns the diff to source', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const ownerId = w.players[0]!.id;
    const source = firstOwned(w, ownerId);
    const dest = firstDormant(w);
    const startDrillers = source.drillers;
    const subId = issueLaunchOrder(w, {
      ownerId,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 5,
    });
    editPreLaunchSub(w, { ownerId, subId, drillers: 2 });
    const sub = w.subs.find((s) => s.id === subId)!;
    expect(sub.drillers).toBe(2);
    expect(source.drillers).toBe(startDrillers - 2);
  });

  it('rejects edit after launch window closes', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const ownerId = w.players[0]!.id;
    const source = firstOwned(w, ownerId);
    const dest = firstDormant(w);
    const subId = issueLaunchOrder(w, {
      ownerId,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 3,
    });
    tick(w, LAUNCH_DELAY_MS + 1000);
    expect(() =>
      editPreLaunchSub(w, { ownerId, subId, drillers: 4 }),
    ).toThrow(/already launched/);
  });

  it('rejects when new count exceeds available drillers', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const ownerId = w.players[0]!.id;
    const source = firstOwned(w, ownerId);
    const dest = firstDormant(w);
    const startDrillers = source.drillers;
    const subId = issueLaunchOrder(w, {
      ownerId,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 2,
    });
    expect(() =>
      editPreLaunchSub(w, { ownerId, subId, drillers: startDrillers + 1 }),
    ).toThrow(/available/);
  });

  it('rejects non-positive drillers', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const ownerId = w.players[0]!.id;
    const source = firstOwned(w, ownerId);
    const dest = firstDormant(w);
    const subId = issueLaunchOrder(w, {
      ownerId,
      sourceId: source.id,
      destinationId: dest.id,
      drillers: 2,
    });
    expect(() => editPreLaunchSub(w, { ownerId, subId, drillers: 0 })).toThrow();
    expect(() => editPreLaunchSub(w, { ownerId, subId, drillers: -1 })).toThrow();
  });
});
