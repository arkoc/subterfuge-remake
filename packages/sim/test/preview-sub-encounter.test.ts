import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { simulateSubEncounter } from '../src/preview.js';
import { hasQueenAt } from '../src/specialists.js';

/**
 * Mirror-route encounter preview: when two subs are on a collision
 * course on the same line, `simulateSubEncounter` should report who
 * wins at the meet point before either reaches its destination.
 */
describe('simulateSubEncounter', () => {
  it('returns null when no other sub shares this sub trajectory', () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    const enemy = w.players[1]!.id;
    const source = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id) && o.drillers >= 10,
    )!;
    const target = w.outposts.find(
      (o) => o.ownerId === enemy && !hasQueenAt(w, o.id),
    )!;
    const subId = issueLaunchOrder(w, {
      ownerId: me,
      sourceId: source.id,
      destinationId: target.id,
      drillers: 5,
    });
    const sub = w.subs.find((s) => s.id === subId)!;
    expect(simulateSubEncounter(w, sub)).toBeNull();
  });

  it('projects a win for the stronger sub on a mirror route', () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    const enemy = w.players[1]!.id;
    const mineOutpost = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id),
    )!;
    const enemyOutpost = w.outposts.find(
      (o) => o.ownerId === enemy && !hasQueenAt(w, o.id),
    )!;
    // Stage enough drillers for the mirror launches.
    (mineOutpost as { drillers: number }).drillers = 100;
    (enemyOutpost as { drillers: number }).drillers = 100;
    // Mirror-route pair: A → B and B → A on the same geodesic.
    const myId = issueLaunchOrder(w, {
      ownerId: me,
      sourceId: mineOutpost.id,
      destinationId: enemyOutpost.id,
      drillers: 30,
    });
    const theirId = issueLaunchOrder(w, {
      ownerId: enemy,
      sourceId: enemyOutpost.id,
      destinationId: mineOutpost.id,
      drillers: 10,
    });
    expect(myId).toBeDefined();
    expect(theirId).toBeDefined();
    const sub = w.subs.find((s) => s.id === myId)!;
    const preview = simulateSubEncounter(w, sub);
    expect(preview).not.toBeNull();
    if (preview === null) return;
    expect(preview.subDrillersBefore).toBeGreaterThan(preview.otherDrillersBefore);
    expect(preview.outcome).toBe('win');
    expect(preview.survivingDrillers).toBeGreaterThan(0);
    expect(preview.encounterAt).toBeLessThan(sub.arrivalAt);
  });
});
