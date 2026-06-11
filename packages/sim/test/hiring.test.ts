import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import {
  executeHire,
  executePromote,
  hireRoster,
  promotionCandidates,
  rosterKinds,
} from '../src/hiring.js';
import {
  HIREABLE_BY_CATEGORY,
  activeCountOf,
  createSpecialist,
  hasQueenAt,
  queenOutpostOf,
  specialistMeta,
} from '../src/specialists.js';
import {
  HIRE_CADENCE_MS,
  HIRE_INITIAL_MS,
  type SubId,
} from '../src/types.js';

describe('hireRoster — deterministic generation', () => {
  it('is reproducible from (worldSeed, playerId, hireIndex)', () => {
    const a = generateWorld({ seed: 13, playerCount: 4 });
    const b = generateWorld({ seed: 13, playerCount: 4 });
    const me = a.players[0]!.id;
    expect(hireRoster(a, me)).toEqual(hireRoster(b, me));
  });

  it('differs per player', () => {
    const w = generateWorld({ seed: 13, playerCount: 4 });
    const ra = hireRoster(w, w.players[0]!.id);
    const rb = hireRoster(w, w.players[1]!.id);
    // Could collide by chance, but with 7×6×6 combinations per player
    // and a different seed mix, near-zero collision odds.
    expect(ra).not.toEqual(rb);
  });

  it('each slot belongs to its category (or is null)', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    for (const p of w.players) {
      const r = hireRoster(w, p.id);
      if (r.offensive !== null) {
        expect(HIREABLE_BY_CATEGORY.offensive).toContain(r.offensive);
      }
      if (r.defensive !== null) {
        expect(HIREABLE_BY_CATEGORY.defensive).toContain(r.defensive);
      }
      if (r.other !== null) {
        expect(HIREABLE_BY_CATEGORY.other).toContain(r.other);
      }
    }
  });

  it('excludes kinds offered in the previous hire', () => {
    const w = generateWorld({ seed: 19, playerCount: 4 });
    const me = w.players[0]!.id;
    const offered = hireRoster(w, me);
    const offeredKinds = rosterKinds(offered);
    // Mark these as the previous offer; the next roster should not
    // contain any of them.
    const player = w.players[me as unknown as number]!;
    player.lastOfferedKinds = offeredKinds;
    player.hireIndex = 1; // pretend we already consumed hire #0
    const next = hireRoster(w, me);
    for (const k of rosterKinds(next)) {
      expect(offeredKinds).not.toContain(k);
    }
  });

  it('excludes hard-capped kinds', () => {
    const w = generateWorld({ seed: 19, playerCount: 4 });
    const me = w.players[0]!.id;
    const queenAt = queenOutpostOf(w, me)!;
    // Saturate the Assassin cap.
    createSpecialist(w, me, 'assassin', { kind: 'outpost', id: queenAt });
    createSpecialist(w, me, 'assassin', { kind: 'outpost', id: queenAt });
    for (let i = 0; i < 10; i++) {
      w.players[me as unknown as number]!.hireIndex = i;
      const r = hireRoster(w, me);
      expect(r.offensive).not.toBe('assassin');
    }
  });
});

describe('executeHire — happy path & validation', () => {
  function arrange() {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    // Skip past the 4h initial wait.
    w.time = HIRE_INITIAL_MS;
    return { w, me };
  }

  it('spawns the chosen kind at the Queen outpost and advances state', () => {
    const { w, me } = arrange();
    const roster = hireRoster(w, me);
    const choice = roster.offensive!;
    const before = w.specialists.length;
    const spec = executeHire(w, { ownerId: me, kind: choice });
    expect(w.specialists).toHaveLength(before + 1);
    expect(spec.kind).toBe(choice);
    expect(spec.ownerId).toBe(me);
    expect(spec.location.kind).toBe('outpost');
    if (spec.location.kind === 'outpost') {
      expect(hasQueenAt(w, spec.location.id)).toBe(true);
    }
    const player = w.players[me as unknown as number]!;
    expect(player.hireIndex).toBe(1);
    expect(player.nextHireAt).toBe(w.time + HIRE_CADENCE_MS);
    expect(player.lastOfferedKinds).toEqual(rosterKinds(roster));
  });

  it('rejects hires before nextHireAt', () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    const roster = hireRoster(w, me);
    expect(() =>
      executeHire(w, { ownerId: me, kind: roster.offensive! }),
    ).toThrow(/not yet available/);
  });

  it('rejects hires when the Queen is mid-flight', () => {
    const { w, me } = arrange();
    const roster = hireRoster(w, me);
    // Move Queen to a sub — she's now not at any outpost.
    const queen = w.specialists.find((s) => s.kind === 'queen' && s.ownerId === me)!;
    queen.location = { kind: 'sub', id: 99 as unknown as SubId };
    expect(() =>
      executeHire(w, { ownerId: me, kind: roster.offensive! }),
    ).toThrow(/not at one of player/);
  });

  it('rejects a kind not in the current roster', () => {
    const { w, me } = arrange();
    const roster = hireRoster(w, me);
    // Pick a hireable kind that we know is not in the roster.
    const allHireable = HIREABLE_BY_CATEGORY.offensive
      .concat(HIREABLE_BY_CATEGORY.defensive, HIREABLE_BY_CATEGORY.other);
    const notOffered = allHireable.find((k) => !rosterKinds(roster).includes(k))!;
    expect(() =>
      executeHire(w, { ownerId: me, kind: notOffered }),
    ).toThrow(/not in this player/);
  });

  it("excludes the previous hire's offer from the next roster", () => {
    const { w, me } = arrange();
    const roster1 = hireRoster(w, me);
    const offered1 = rosterKinds(roster1);
    executeHire(w, { ownerId: me, kind: roster1.offensive! });
    // Advance world time past the cooldown.
    w.time = w.players[me as unknown as number]!.nextHireAt;
    const roster2 = hireRoster(w, me);
    for (const k of rosterKinds(roster2)) {
      expect(offered1).not.toContain(k);
    }
  });
});

describe('hire deferral when Queen mid-flight', () => {
  it('hire stays available across many ticks until the Queen returns', () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    w.time = HIRE_INITIAL_MS;
    const queen = w.specialists.find(
      (s) => s.kind === 'queen' && s.ownerId === me,
    )!;
    const originalLocation = queen.location;
    // Queen boards a sub — hire becomes "available but pending".
    queen.location = { kind: 'sub', id: 999 as unknown as SubId };
    const roster = hireRoster(w, me);
    expect(() =>
      executeHire(w, { ownerId: me, kind: roster.offensive! }),
    ).toThrow(/not at one of player/);
    // Advance the world a long time — hire is still pending.
    w.time = HIRE_INITIAL_MS + 24 * 60 * 60 * 1000;
    expect(() =>
      executeHire(w, { ownerId: me, kind: roster.offensive! }),
    ).toThrow(/not at one of player/);
    // Queen returns. Hire fires.
    queen.location = originalLocation;
    const spec = executeHire(w, { ownerId: me, kind: roster.offensive! });
    expect(spec.kind).toBe(roster.offensive);
  });

  it('only one hire is available even if the Queen has been away for multiple cadences', () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    w.time = HIRE_INITIAL_MS;
    const queen = w.specialists.find(
      (s) => s.kind === 'queen' && s.ownerId === me,
    )!;
    const home = queen.location;
    queen.location = { kind: 'sub', id: 999 as unknown as SubId };
    // 3 × HIRE_CADENCE_MS later, queen returns.
    w.time = HIRE_INITIAL_MS + 3 * HIRE_CADENCE_MS;
    queen.location = home;
    const r1 = hireRoster(w, me);
    executeHire(w, { ownerId: me, kind: r1.offensive! });
    // Trying to immediately take a second one fails — next hire is
    // scheduled 18h after the first fired (not stacked).
    const player = w.players[me as unknown as number]!;
    expect(player.hireIndex).toBe(1);
    expect(player.nextHireAt).toBe(w.time + HIRE_CADENCE_MS);
    const r2 = hireRoster(w, me);
    expect(() =>
      executeHire(w, { ownerId: me, kind: r2.offensive! }),
    ).toThrow(/not yet available/);
  });
});

describe('executePromote', () => {
  function arrange() {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    const queenAt = queenOutpostOf(w, me)!;
    // Spawn a Foreman at the Queen's outpost so we have a promote target.
    const foreman = createSpecialist(w, me, 'foreman', {
      kind: 'outpost',
      id: queenAt,
    });
    w.time = HIRE_INITIAL_MS;
    return { w, me, queenAt, foreman };
  }

  it('replaces base kind with promoted form and consumes the hire slot', () => {
    const { w, me, foreman } = arrange();
    executePromote(w, {
      ownerId: me,
      specialistId: foreman.id as unknown as number,
    });
    expect(foreman.kind).toBe('engineer');
    expect(activeCountOf(w, me, 'foreman')).toBe(0);
    expect(activeCountOf(w, me, 'engineer')).toBe(1);
    const player = w.players[me as unknown as number]!;
    expect(player.hireIndex).toBe(1);
    expect(player.nextHireAt).toBe(w.time + HIRE_CADENCE_MS);
    // Promotions do not set lastOfferedKinds (cooldown skipped).
    expect(player.lastOfferedKinds).toEqual([]);
  });

  it('rejects promotion of a specialist not at Queen outpost', () => {
    const { w, me } = arrange();
    const otherOutpost = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id),
    )!;
    const lt = createSpecialist(w, me, 'lieutenant', {
      kind: 'outpost',
      id: otherOutpost.id,
    });
    expect(() =>
      executePromote(w, {
        ownerId: me,
        specialistId: lt.id as unknown as number,
      }),
    ).toThrow(/Queen's outpost/);
  });

  it('rejects promotion of an enemy specialist', () => {
    const { w, me } = arrange();
    const other = w.players[1]!.id;
    const enemyHire = createSpecialist(w, other, 'foreman', {
      kind: 'outpost',
      id: queenOutpostOf(w, me)!,
    });
    expect(() =>
      executePromote(w, {
        ownerId: me,
        specialistId: enemyHire.id as unknown as number,
      }),
    ).toThrow(/not owned/);
  });

  it('rejects promotion of a Princess (succession only)', () => {
    const { w, me } = arrange();
    const queenAt = queenOutpostOf(w, me)!;
    const p = createSpecialist(w, me, 'princess', {
      kind: 'outpost',
      id: queenAt,
    });
    expect(() =>
      executePromote(w, {
        ownerId: me,
        specialistId: p.id as unknown as number,
      }),
    ).toThrow(/succession/);
  });

  it('rejects promotion of a terminal specialist (no promotesTo)', () => {
    const { w, me } = arrange();
    const queenAt = queenOutpostOf(w, me)!;
    const helms = createSpecialist(w, me, 'helmsman', {
      kind: 'outpost',
      id: queenAt,
    });
    expect(() =>
      executePromote(w, {
        ownerId: me,
        specialistId: helms.id as unknown as number,
      }),
    ).toThrow(/no promoted form/);
  });
});

describe('promotionCandidates', () => {
  it('lists hire-promotable specialists at the Queen outpost', () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    const queenAt = queenOutpostOf(w, me)!;
    // Foreman (promotable), Princess (succession-only), Helmsman (terminal).
    createSpecialist(w, me, 'foreman', { kind: 'outpost', id: queenAt });
    createSpecialist(w, me, 'princess', { kind: 'outpost', id: queenAt });
    createSpecialist(w, me, 'helmsman', { kind: 'outpost', id: queenAt });
    const cands = promotionCandidates(w, me);
    expect(cands.map((c) => c.kind)).toEqual(['foreman']);
    for (const c of cands) {
      expect(specialistMeta(c.kind).promotesTo).not.toBeNull();
    }
  });
});
