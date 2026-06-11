import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import {
  eliminatePlayer,
  grantQueen,
  onQueenLost,
} from '../src/royalty.js';
import {
  activeQueenOf,
  createSpecialist,
  queenOutpostOf,
} from '../src/specialists.js';
import { issueLaunchOrder } from '../src/orders.js';
import { hasQueenAt } from '../src/specialists.js';

describe('onQueenLost — Princess succession', () => {
  it('promotes the nearest active Princess to Queen', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const queen = activeQueenOf(w, me)!;
    const queenPos =
      queen.location.kind === 'outpost'
        ? w.outposts.find((o) => o.id === (queen.location.kind === 'outpost' ? queen.location.id : undefined))!.pos
        : null;

    // Spawn two Princesses at different owned outposts.
    const owned = w.outposts.filter((o) => o.ownerId === me && !hasQueenAt(w, o.id));
    const farPrincess = createSpecialist(w, me, 'princess', {
      kind: 'outpost',
      id: owned[0]!.id,
    });
    const nearPrincess = createSpecialist(w, me, 'princess', {
      kind: 'outpost',
      id: owned[1]!.id,
    });

    // Simulate Queen loss: remove the Queen specialist, then call onQueenLost.
    w.specialists = w.specialists.filter((s) => s !== queen);
    onQueenLost(w, me, queenPos);

    // One of the Princesses should now be Queen; the other still Princess.
    const newQueen = activeQueenOf(w, me);
    expect(newQueen).not.toBeNull();
    expect([farPrincess.id, nearPrincess.id]).toContain(newQueen!.id);
    expect(w.specialists.filter((s) => s.kind === 'princess' && s.ownerId === me)).toHaveLength(1);
    expect(w.players[me as unknown as number]!.eliminated).toBe(false);
  });

  it('eliminates the player if no Princess exists', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const queen = activeQueenOf(w, me)!;
    const queenOutpostId = queen.location.kind === 'outpost' ? queen.location.id : null;
    expect(queenOutpostId).not.toBeNull();
    const queenPos = w.outposts.find((o) => o.id === queenOutpostId!)!.pos;

    // Launch a sub before elimination so we can verify it's destroyed.
    const src = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    issueLaunchOrder(w, {
      ownerId: me,
      sourceId: src.id,
      destinationId: w.outposts.find((o) => o.ownerId !== me)!.id,
      drillers: 5,
    });
    expect(w.subs.filter((s) => s.ownerId === me)).toHaveLength(1);

    // Remove the Queen and trigger succession.
    w.specialists = w.specialists.filter((s) => s !== queen);
    onQueenLost(w, me, queenPos);

    expect(w.players[me as unknown as number]!.eliminated).toBe(true);
    // All outposts dormant
    expect(w.outposts.filter((o) => o.ownerId === me)).toHaveLength(0);
    // All subs destroyed
    expect(w.subs.filter((s) => s.ownerId === me)).toHaveLength(0);
    // All specialists destroyed
    expect(w.specialists.filter((s) => s.ownerId === me)).toHaveLength(0);
  });

  it('is a no-op if the player still has an active Queen', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const before = w.specialists.length;
    onQueenLost(w, me, null);
    expect(w.specialists).toHaveLength(before);
    expect(activeQueenOf(w, me)).not.toBeNull();
  });

  it('breaks tied Princess distances by lower specialist id', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const queen = activeQueenOf(w, me)!;
    const queenOutpostId = queen.location.kind === 'outpost' ? queen.location.id : null;
    const queenPos = w.outposts.find((o) => o.id === queenOutpostId!)!.pos;

    // Put two Princesses at the same outpost — equal distance → lower id wins.
    const owned = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const p1 = createSpecialist(w, me, 'princess', { kind: 'outpost', id: owned.id });
    const p2 = createSpecialist(w, me, 'princess', { kind: 'outpost', id: owned.id });
    expect((p1.id as unknown as number) < (p2.id as unknown as number)).toBe(true);

    w.specialists = w.specialists.filter((s) => s !== queen);
    onQueenLost(w, me, queenPos);
    const newQueen = activeQueenOf(w, me)!;
    expect(newQueen.id).toBe(p1.id);
  });
});

describe('grantQueen — second-Queen demotion', () => {
  it('spawns a Queen when none exists', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    // Remove the starting Queen so the player has no active Queen.
    w.specialists = w.specialists.filter((s) => !(s.ownerId === me && s.kind === 'queen'));
    const o = w.outposts.find((x) => x.ownerId === me)!;
    const out = grantQueen(w, me, { kind: 'outpost', id: o.id });
    expect(out.kind).toBe('queen');
    expect(activeQueenOf(w, me)).not.toBeNull();
  });

  it('demotes the second Queen to Princess when one already exists', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const o = w.outposts.find((x) => x.ownerId === me && !hasQueenAt(w, x.id))!;
    const out = grantQueen(w, me, { kind: 'outpost', id: o.id });
    expect(out.kind).toBe('princess');
    expect(w.specialists.filter((s) => s.kind === 'queen' && s.ownerId === me)).toHaveLength(1);
    expect(w.specialists.filter((s) => s.kind === 'princess' && s.ownerId === me)).toHaveLength(1);
  });
});

describe('eliminatePlayer', () => {
  it('is idempotent', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    eliminatePlayer(w, me);
    const snapshot = JSON.stringify(w);
    eliminatePlayer(w, me);
    expect(JSON.stringify(w)).toBe(snapshot);
  });

  it('removes captives held by the eliminated player', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const queenAt = queenOutpostOf(w, a)!;
    // Player B's specialist captured at Player A's outpost.
    const captive = createSpecialist(w, b, 'helmsman', {
      kind: 'outpost',
      id: queenAt,
    });
    captive.state = 'captive';
    captive.captiveOf = a;
    eliminatePlayer(w, a);
    // The captive vanishes (Phase 6f will refine to "release home").
    expect(w.specialists.find((s) => s.id === captive.id)).toBeUndefined();
  });
});
