import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { outpostsInSonarOf, viewForPlayer } from '../src/visibility.js';
import {
  createSpecialist,
  hasQueenAt,
  queenOutpostOf,
} from '../src/specialists.js';
import type { SpecialistId } from '../src/types.js';

describe('viewForPlayer — specialist filtering', () => {
  it('viewer always sees their own active specialists', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const queenAt = queenOutpostOf(w, me)!;
    createSpecialist(w, me, 'helmsman', { kind: 'outpost', id: queenAt });
    const view = viewForPlayer(w, me);
    expect(view.specialists.filter((s) => s.ownerId === me)).toHaveLength(
      // Starting Queen + Helmsman just added.
      w.specialists.filter((s) => s.ownerId === me).length,
    );
  });

  it('hides enemy specialists at outposts the viewer cannot see', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const them = w.players[2]!.id;
    // Pick an enemy outpost outside any of me's sonar bubbles by
    // checking the visibility set directly.
    const visibleToMe = outpostsInSonarOf(w, me);
    const farOutpost = w.outposts.find(
      (o) => o.ownerId === them && !visibleToMe.has(o.id),
    );
    if (farOutpost === undefined) {
      // Some seeds may have all enemy outposts in sonar; in that case
      // the test is vacuously satisfied.
      return;
    }
    const helms = createSpecialist(w, them, 'helmsman', {
      kind: 'outpost',
      id: farOutpost.id,
    });
    const view = viewForPlayer(w, me);
    expect(view.specialists.find((s) => s.id === helms.id)).toBeUndefined();
  });

  it('shows captives held by the viewer', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const them = w.players[1]!.id;
    const myOutpost = w.outposts.find((o) => o.ownerId === me)!;
    const captive = createSpecialist(w, them, 'helmsman', {
      kind: 'outpost',
      id: myOutpost.id,
    });
    captive.state = 'captive';
    captive.captiveOf = me;
    const view = viewForPlayer(w, me);
    expect(view.specialists.find((s) => s.id === captive.id)).toBeDefined();
  });

  it('hides specialists on enemy subs outside sonar', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const them = w.players[2]!.id; // far from me
    const theirSrc = w.outposts.find(
      (o) => o.ownerId === them && !hasQueenAt(w, o.id),
    )!;
    const theirDst = w.outposts.find(
      (o) => o.ownerId === them && o.id !== theirSrc.id,
    )!;
    theirSrc.drillers = 50;
    const helms = createSpecialist(w, them, 'helmsman', {
      kind: 'outpost',
      id: theirSrc.id,
    });
    issueLaunchOrder(w, {
      ownerId: them, sourceId: theirSrc.id, destinationId: theirDst.id, drillers: 10,
      specialistIds: [helms.id as unknown as SpecialistId],
    });
    const view = viewForPlayer(w, me);
    // The Helmsman is on a sub outside my sonar — should be filtered.
    expect(view.specialists.find((s) => s.id === helms.id)).toBeUndefined();
  });
});
