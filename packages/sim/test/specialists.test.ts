import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import {
  ALL_SPECIALIST_KINDS,
  HIREABLE_BY_CATEGORY,
  HIREABLE_KINDS,
  activeCountOf,
  activeQueenOf,
  activeSpecialistsOf,
  createSpecialist,
  hasQueenAt,
  isAtOutpost,
  isAtSub,
  isCapReached,
  queenOutpostOf,
  specialistMeta,
  specialistPhaseOrder,
  specialistsAtOutpost,
  specialistsOnSub,
} from '../src/specialists.js';
import type { OutpostId, SpecialistKind, SubId } from '../src/types.js';

describe('SPECIALIST_META — schema consistency', () => {
  it('covers exactly 29 kinds', () => {
    expect(ALL_SPECIALIST_KINDS).toHaveLength(29);
  });

  it('every kind has metadata', () => {
    for (const k of ALL_SPECIALIST_KINDS) {
      const m = specialistMeta(k);
      expect(m.kind).toBe(k);
    }
  });

  it('promotion edges are bidirectional and unique', () => {
    for (const k of ALL_SPECIALIST_KINDS) {
      const m = specialistMeta(k);
      if (m.promotesTo !== null) {
        // Princess→Queen is the special automatic case; the base does
        // not appear as `promotedFrom` of Queen (Queen can also come
        // from hire / world-gen, not a promotion path).
        if (k === 'princess') {
          expect(m.promotesTo).toBe('queen');
          continue;
        }
        const target = specialistMeta(m.promotesTo);
        expect(target.promotedFrom).toBe(k);
      }
      if (m.promotedFrom !== null) {
        const source = specialistMeta(m.promotedFrom);
        expect(source.promotesTo).toBe(k);
      }
    }
  });

  it('promoted forms are never hireable', () => {
    for (const k of ALL_SPECIALIST_KINDS) {
      const m = specialistMeta(k);
      if (m.promotedFrom !== null) expect(m.hireable).toBe(false);
    }
  });

  it('Royalty is never hireable', () => {
    expect(specialistMeta('queen').hireable).toBe(false);
    expect(specialistMeta('princess').hireable).toBe(false);
  });

  it('every hireable specialist falls into one of three categories', () => {
    for (const k of HIREABLE_KINDS) {
      const m = specialistMeta(k);
      expect(['offensive', 'defensive', 'other']).toContain(m.category);
    }
  });

  it('hireable counts per category match the docs (7 / 6 / 6 = 19)', () => {
    expect(HIREABLE_BY_CATEGORY.offensive).toHaveLength(7);
    expect(HIREABLE_BY_CATEGORY.defensive).toHaveLength(6);
    expect(HIREABLE_BY_CATEGORY.other).toHaveLength(6);
    expect(HIREABLE_KINDS).toHaveLength(19);
  });

  it('Assassin and Saboteur have hard cap 2; others uncapped', () => {
    expect(specialistMeta('assassin').cap).toBe(2);
    expect(specialistMeta('saboteur').cap).toBe(2);
    expect(specialistMeta('queen').cap).toBe(1);
    for (const k of HIREABLE_KINDS) {
      if (k === 'assassin' || k === 'saboteur') continue;
      expect(specialistMeta(k).cap).toBeNull();
    }
  });

  it('combat priorities match the canonical phase table (docs/05_specialists.md §4)', () => {
    const expected: Partial<Record<SpecialistKind, number>> = {
      martyr: 1,
      revered_elder: 2,
      saboteur: 3,
      thief: 4,
      infiltrator: 4,
      double_agent: 5,
      assassin: 6,
      lieutenant: 7,
      war_hero: 7,
      sentry: 7,
    };
    for (const [k, cp] of Object.entries(expected)) {
      expect(specialistMeta(k as SpecialistKind).combatPriority).toBe(cp);
    }
    // General and King have no CP slot — they fire in the post-spec
    // phase, not the CP queue.
    expect(specialistMeta('general').combatPriority).toBeNull();
    expect(specialistMeta('king').combatPriority).toBeNull();
    expect(specialistMeta('general').combatTiming).toBe('post-spec');
    expect(specialistMeta('king').combatTiming).toBe('post-spec');
    // Saboteur, Engineer fire post-driller.
    expect(specialistMeta('saboteur').combatTiming).toBe('post-driller');
    expect(specialistMeta('engineer').combatTiming).toBe('post-driller');
  });

  it('specialistPhaseOrder returns Infinity for post-phase specialists', () => {
    expect(specialistPhaseOrder('general')).toBe(Number.POSITIVE_INFINITY);
    expect(specialistPhaseOrder('engineer')).toBe(Number.POSITIVE_INFINITY);
    expect(specialistPhaseOrder('saboteur')).toBe(Number.POSITIVE_INFINITY);
    // CP-7 specialists are 7.
    expect(specialistPhaseOrder('lieutenant')).toBe(7);
    expect(specialistPhaseOrder('martyr')).toBe(1);
  });

  it('allowed locations match the spec', () => {
    expect(specialistMeta('sentry').abilityScope).toBe('outpost');
    expect(specialistMeta('inspector').abilityScope).toBe('outpost');
    expect(specialistMeta('hypnotist').abilityScope).toBe('outpost');
    expect(specialistMeta('foreman').abilityScope).toBe('outpost');
    expect(specialistMeta('diplomat').abilityScope).toBe('outpost');
    expect(specialistMeta('tinkerer').abilityScope).toBe('outpost');
    expect(specialistMeta('princess').abilityScope).toBe('outpost');

    expect(specialistMeta('helmsman').abilityScope).toBe('sub');
    expect(specialistMeta('navigator').abilityScope).toBe('sub');
    expect(specialistMeta('admiral').abilityScope).toBe('sub');
    expect(specialistMeta('smuggler').abilityScope).toBe('sub');
    expect(specialistMeta('saboteur').abilityScope).toBe('sub');
    expect(specialistMeta('thief').abilityScope).toBe('sub');
    expect(specialistMeta('infiltrator').abilityScope).toBe('sub');
    expect(specialistMeta('pirate').abilityScope).toBe('sub');
    expect(specialistMeta('double_agent').abilityScope).toBe('sub');

    expect(specialistMeta('queen').abilityScope).toBe('both');
    expect(specialistMeta('martyr').abilityScope).toBe('both');
    expect(specialistMeta('assassin').abilityScope).toBe('both');
  });
});

describe('world-gen — Queen spawning', () => {
  it('spawns exactly one active Queen per player at one of their outposts', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    expect(w.specialists).toHaveLength(4);
    expect(w.nextSpecialistId).toBe(4);
    for (const p of w.players) {
      const queen = activeQueenOf(w, p.id);
      expect(queen).not.toBeNull();
      expect(queen!.kind).toBe('queen');
      expect(queen!.state).toBe('active');
      expect(queen!.location.kind).toBe('outpost');
      // The Queen sits on an outpost owned by her player.
      const loc = queen!.location;
      if (loc.kind === 'outpost') {
        const o = w.outposts.find((x) => x.id === loc.id);
        expect(o?.ownerId).toBe(p.id);
      }
    }
  });

  it('hasQueenAt agrees with queenOutpostOf', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    for (const p of w.players) {
      const home = queenOutpostOf(w, p.id);
      expect(home).not.toBeNull();
      expect(hasQueenAt(w, home!)).toBe(true);
    }
  });
});

describe('queries — count, location, cap', () => {
  function makeWorldWithExtras() {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    // Use the Queen's actual outpost so all the queen-co-located
    // assertions below line up.
    const myOutpostId = queenOutpostOf(w, me)!;
    const myOutpost = w.outposts.find((o) => o.id === myOutpostId)!;
    // Spawn 2 Assassins at my Queen outpost — hits the cap exactly.
    createSpecialist(w, me, 'assassin', { kind: 'outpost', id: myOutpost.id });
    createSpecialist(w, me, 'assassin', { kind: 'outpost', id: myOutpost.id });
    // A Helmsman on a hypothetical sub id.
    createSpecialist(w, me, 'helmsman', {
      kind: 'sub',
      id: 99 as unknown as SubId,
    });
    return { w, me, myOutpost };
  }

  it('specialistsAtOutpost / specialistsOnSub filter correctly', () => {
    const { w, myOutpost } = makeWorldWithExtras();
    const here = specialistsAtOutpost(w, myOutpost.id);
    // 1 Queen + 2 Assassins
    expect(here).toHaveLength(3);
    expect(here.map((s) => s.kind).sort()).toEqual(['assassin', 'assassin', 'queen']);

    const aboard = specialistsOnSub(w, 99 as unknown as SubId);
    expect(aboard).toHaveLength(1);
    expect(aboard[0]!.kind).toBe('helmsman');
  });

  it('activeCountOf only counts active specialists of the requested kind', () => {
    const { w, me } = makeWorldWithExtras();
    expect(activeCountOf(w, me, 'assassin')).toBe(2);
    expect(activeCountOf(w, me, 'queen')).toBe(1);
    expect(activeCountOf(w, me, 'helmsman')).toBe(1);
    expect(activeCountOf(w, me, 'martyr')).toBe(0);

    // Mark one Assassin captive — it should drop out of the active count.
    const a = w.specialists.find((s) => s.kind === 'assassin')!;
    a.state = 'captive';
    a.captiveOf = w.players[1]!.id;
    expect(activeCountOf(w, me, 'assassin')).toBe(1);
  });

  it('isCapReached respects the hard cap', () => {
    const { w, me } = makeWorldWithExtras();
    expect(isCapReached(w, me, 'assassin')).toBe(true); // 2 == cap
    expect(isCapReached(w, me, 'saboteur')).toBe(false); // 0 < 2
    expect(isCapReached(w, me, 'helmsman')).toBe(false); // uncapped
  });

  it('activeSpecialistsOf returns only the requested player active roster', () => {
    const { w, me } = makeWorldWithExtras();
    const mine = activeSpecialistsOf(w, me);
    // 1 Queen + 2 Assassins + 1 Helmsman = 4
    expect(mine).toHaveLength(4);
    for (const s of mine) {
      expect(s.ownerId).toBe(me);
      expect(s.state).toBe('active');
    }
  });

  it('isAtSub / isAtOutpost type guards', () => {
    const { w, myOutpost } = makeWorldWithExtras();
    const queen = w.specialists.find((s) => s.kind === 'queen')!;
    expect(isAtOutpost(queen, myOutpost.id)).toBe(true);
    expect(isAtSub(queen, 99 as unknown as SubId)).toBe(false);
    const hm = w.specialists.find((s) => s.kind === 'helmsman')!;
    expect(isAtSub(hm, 99 as unknown as SubId)).toBe(true);
    expect(isAtOutpost(hm, myOutpost.id)).toBe(false);
  });
});

describe('createSpecialist', () => {
  it('appends with monotonic id and returns the new specialist', () => {
    const w = generateWorld({ seed: 1, playerCount: 2 });
    const before = w.nextSpecialistId;
    const me = w.players[0]!.id;
    const out = w.outposts.find((o) => o.ownerId === me)!;
    const s = createSpecialist(w, me, 'martyr', { kind: 'outpost', id: out.id });
    expect(s.id as unknown as number).toBe(before);
    expect(w.nextSpecialistId).toBe(before + 1);
    expect(w.specialists[w.specialists.length - 1]).toBe(s);
    expect(s.state).toBe('active');
    expect(s.captiveOf).toBeUndefined();
  });
});

describe('Queen-as-specialist economic semantics', () => {
  it('the +150 electrical bonus follows the Queen across outposts', async () => {
    const { electricalOutput } = await import('../src/production.js');
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const me = w.players[0]!.id;
    const baseline = electricalOutput(w, me);
    const queen = activeQueenOf(w, me)!;
    expect(queen.location.kind).toBe('outpost');

    // Move the Queen to a different owned outpost — bonus should follow.
    const owned = w.outposts.filter((o) => o.ownerId === me);
    const newHomeId = owned.find(
      (o) => queen.location.kind === 'outpost' && o.id !== queen.location.id,
    )!.id as OutpostId;
    queen.location = { kind: 'outpost', id: newHomeId };
    expect(electricalOutput(w, me)).toBe(baseline);

    // Put her on a sub — the bonus disappears.
    queen.location = { kind: 'sub', id: 42 as unknown as SubId };
    expect(electricalOutput(w, me)).toBe(baseline - 150);

    // Make her a captive at the captor's outpost — bonus still absent
    // (captives apply no abilities).
    queen.state = 'captive';
    queen.captiveOf = w.players[1]!.id;
    queen.location = { kind: 'outpost', id: newHomeId };
    expect(electricalOutput(w, me)).toBe(baseline - 150);
  });
});
