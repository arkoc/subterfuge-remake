import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import {
  cancelPending,
  defer,
  earliestDuePending,
  finalizePending,
} from '../src/pending-commands.js';
import { hireRoster } from '../src/hiring.js';
import { tick } from '../src/tick.js';
import { applyEvent, replayFrom } from '../src/replay.js';
import { hasQueenAt } from '../src/specialists.js';
import {
  HIRE_INITIAL_MS,
  PENDING_DELAY_MS,
  type PendingCommandId,
  type PlayerId,
} from '../src/types.js';

function makeReady() {
  const w = generateWorld({ seed: 41, playerCount: 4 });
  const me = w.players[0]!.id;
  w.time = HIRE_INITIAL_MS;
  return { w, me };
}

describe('defer + cancelPending — owner-scoped lifecycle', () => {
  it('queues a pending hire with executeAt 10 minutes in the future', () => {
    const { w, me } = makeReady();
    const roster = hireRoster(w, me);
    const issuedAt = w.time;
    const id = defer(w, {
      issuedAt,
      command: { kind: 'hire', ownerId: me, specialistKind: roster.offensive! },
    });
    expect(w.pendingCommands).toHaveLength(1);
    const pc = w.pendingCommands[0]!;
    expect(pc.id).toBe(id);
    expect(pc.executeAt).toBe(issuedAt + PENDING_DELAY_MS);
    expect(pc.ownerId).toBe(me);
  });

  it('cancelPending removes the entry when caller owns it', () => {
    const { w, me } = makeReady();
    const roster = hireRoster(w, me);
    const id = defer(w, {
      issuedAt: w.time,
      command: { kind: 'hire', ownerId: me, specialistKind: roster.offensive! },
    });
    const ok = cancelPending(w, id, me);
    expect(ok).toBe(true);
    expect(w.pendingCommands).toHaveLength(0);
  });

  it('cancelPending refuses cancellation by a non-owner', () => {
    const { w, me } = makeReady();
    const other = w.players[1]!.id;
    const roster = hireRoster(w, me);
    const id = defer(w, {
      issuedAt: w.time,
      command: { kind: 'hire', ownerId: me, specialistKind: roster.offensive! },
    });
    expect(cancelPending(w, id, other)).toBe(false);
    expect(w.pendingCommands).toHaveLength(1);
  });

  it('cancelPending returns false for an unknown id', () => {
    const { w, me } = makeReady();
    expect(cancelPending(w, 9999 as unknown as PendingCommandId, me)).toBe(
      false,
    );
  });
});

describe('tick dispatches pending commands at executeAt', () => {
  it('hires the specialist after PENDING_DELAY_MS', () => {
    const { w, me } = makeReady();
    const roster = hireRoster(w, me);
    const before = w.specialists.length;
    defer(w, {
      issuedAt: w.time,
      command: { kind: 'hire', ownerId: me, specialistKind: roster.offensive! },
    });
    // Halfway: not yet dispatched, no roster change.
    tick(w, PENDING_DELAY_MS / 2);
    expect(w.specialists).toHaveLength(before);
    expect(w.pendingCommands).toHaveLength(1);
    // Past the fuse: dispatched and removed.
    tick(w, PENDING_DELAY_MS);
    expect(w.specialists).toHaveLength(before + 1);
    expect(w.pendingCommands).toHaveLength(0);
  });

  it('cancellation before executeAt prevents the hire from happening', () => {
    const { w, me } = makeReady();
    const roster = hireRoster(w, me);
    const before = w.specialists.length;
    const id = defer(w, {
      issuedAt: w.time,
      command: { kind: 'hire', ownerId: me, specialistKind: roster.offensive! },
    });
    tick(w, PENDING_DELAY_MS / 2);
    cancelPending(w, id, me);
    tick(w, PENDING_DELAY_MS);
    expect(w.specialists).toHaveLength(before);
    expect(w.pendingCommands).toHaveLength(0);
  });

  it('drill defer eventually converts the outpost when fired', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    // First drill costs 50 drillers; starting factories have 40. Bump
    // the chosen factory so the dispatched drill order has enough.
    const factory = w.outposts.find(
      (o) =>
        o.ownerId === me &&
        o.kind === 'factory' &&
        !hasQueenAt(w, o.id),
    )!;
    factory.drillers = 100;
    defer(w, {
      issuedAt: w.time,
      command: { kind: 'drill', ownerId: me, outpostId: factory.id },
    });
    tick(w, PENDING_DELAY_MS + 1);
    const after = w.outposts.find((o) => o.id === factory.id)!;
    expect(after.kind).toBe('mine');
  });
});

describe('earliestDuePending — chronological ordering', () => {
  it('returns the lowest executeAt within the deadline', () => {
    const { w, me } = makeReady();
    const roster = hireRoster(w, me);
    // Two defers at different times.
    const aIssued = w.time;
    defer(w, {
      issuedAt: aIssued,
      command: { kind: 'hire', ownerId: me, specialistKind: roster.offensive! },
    });
    w.time += 5 * 60 * 1000; // +5 min
    defer(w, {
      issuedAt: w.time,
      command: { kind: 'hire', ownerId: me, specialistKind: roster.defensive! },
    });
    const earliest = earliestDuePending(w, Number.POSITIVE_INFINITY)!;
    expect(earliest.executeAt).toBe(aIssued + PENDING_DELAY_MS);
  });

  it('ignores commands whose executeAt is past the deadline', () => {
    const { w, me } = makeReady();
    const roster = hireRoster(w, me);
    defer(w, {
      issuedAt: w.time,
      command: { kind: 'hire', ownerId: me, specialistKind: roster.offensive! },
    });
    // Deadline 1ms before executeAt.
    const earliest = earliestDuePending(w, w.time + PENDING_DELAY_MS - 1);
    expect(earliest).toBe(null);
  });
});

describe('finalizePending — bypass the 10-minute fuse', () => {
  it('finalises a hire immediately, removing the pending entry', () => {
    const { w, me } = makeReady();
    const roster = hireRoster(w, me);
    const before = w.specialists.length;
    const id = defer(w, {
      issuedAt: w.time,
      command: { kind: 'hire', ownerId: me, specialistKind: roster.offensive! },
    });
    expect(w.pendingCommands).toHaveLength(1);
    const r = finalizePending(w, id, me);
    expect(r.ok).toBe(true);
    expect(w.pendingCommands).toHaveLength(0);
    expect(w.specialists.length).toBe(before + 1);
  });

  it('refuses finalisation from a non-owner', () => {
    const { w, me } = makeReady();
    const other = w.players[1]!.id;
    const roster = hireRoster(w, me);
    const id = defer(w, {
      issuedAt: w.time,
      command: { kind: 'hire', ownerId: me, specialistKind: roster.offensive! },
    });
    const r = finalizePending(w, id, other);
    expect(r.ok).toBe(false);
    expect(w.pendingCommands).toHaveLength(1);
  });

  it('preserves the pending entry when dispatch fails (e.g. Queen absent)', () => {
    const { w, me } = makeReady();
    const roster = hireRoster(w, me);
    const id = defer(w, {
      issuedAt: w.time,
      command: { kind: 'hire', ownerId: me, specialistKind: roster.offensive! },
    });
    // Move the Queen off all owned outposts so executeHire fails.
    const queen = w.specialists.find(
      (s) => s.ownerId === me && s.kind === 'queen',
    )!;
    queen.location = { kind: 'sub', id: -1 as never };
    const r = finalizePending(w, id, me);
    expect(r.ok).toBe(false);
    expect(w.pendingCommands).toHaveLength(1);
  });
});

describe('replay log: defer + cancel-pending round-trip', () => {
  it('applyEvent(defer) → tick → matches a direct defer + tick', () => {
    const w1 = generateWorld({ seed: 41, playerCount: 4 });
    const w2 = generateWorld({ seed: 41, playerCount: 4 });
    const me = w1.players[0]!.id;
    w1.time = HIRE_INITIAL_MS;
    w2.time = HIRE_INITIAL_MS;
    const roster = hireRoster(w1, me);
    const cmd = {
      kind: 'hire' as const,
      ownerId: me,
      specialistKind: roster.offensive!,
    };
    // Direct.
    defer(w1, { issuedAt: w1.time, command: cmd });
    // Replay event.
    applyEvent(w2, { simAt: w2.time, kind: 'defer', command: cmd });
    expect(w2.pendingCommands).toHaveLength(1);
    expect(w2.pendingCommands[0]!.executeAt).toBe(
      w1.pendingCommands[0]!.executeAt,
    );
    tick(w1, PENDING_DELAY_MS + 1);
    tick(w2, PENDING_DELAY_MS + 1);
    expect(w1.specialists.length).toBe(w2.specialists.length);
  });

  it('replayFrom reproduces a defer + cancel sequence', () => {
    const seed = 7;
    const playerCount = 4;
    // Bootstrap a fresh world to derive ids.
    const probe = generateWorld({ seed, playerCount });
    const me = probe.players[0]!.id as PlayerId;
    const roster = hireRoster(probe, me);
    const issuedAt = HIRE_INITIAL_MS;
    const events = [
      {
        simAt: issuedAt,
        kind: 'defer' as const,
        command: {
          kind: 'hire' as const,
          ownerId: me,
          specialistKind: roster.offensive!,
        },
      },
      // Cancel halfway through the 10-minute window.
      {
        simAt: issuedAt + PENDING_DELAY_MS / 2,
        kind: 'cancel-pending' as const,
        ownerId: me,
        pendingId: 0 as unknown as PendingCommandId,
      },
    ];
    const targetTime = issuedAt + PENDING_DELAY_MS + 1;
    const replayed = replayFrom({ seed, playerCount, events, targetTime });
    // After cancel, no pending commands and no extra specialist hired.
    expect(replayed.pendingCommands).toHaveLength(0);
    // Baseline (no events) should have the same specialist count.
    const baseline = replayFrom({
      seed,
      playerCount,
      events: [],
      targetTime,
    });
    expect(replayed.specialists.length).toBe(baseline.specialists.length);
  });
});
