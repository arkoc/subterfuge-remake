import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { tick } from '../src/tick.js';
import { mirrorEncounterTime } from '../src/combat.js';
import { createSpecialist, hasQueenAt } from '../src/specialists.js';

/**
 * Saboteur on a mirror route: fires *after* the driller phase. The
 * losing side's saboteur denies the winner their intended arrival by
 * redirecting the surviving sub to its own (the winner's) nearest
 * outpost — i.e. the attacker is sent back home.
 */
describe('saboteur on mirror-route encounter', () => {
  it("losing side's saboteur sends the winning enemy home", () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    const enemy = w.players[1]!.id;
    const myOutposts = w.outposts.filter(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id),
    );
    const enemyOutposts = w.outposts.filter(
      (o) => o.ownerId === enemy && !hasQueenAt(w, o.id),
    );
    const mine = myOutposts[0]!;
    const theirs = enemyOutposts[0]!;
    (mine as { drillers: number }).drillers = 100;
    (theirs as { drillers: number }).drillers = 100;
    // Saboteur on my (weaker) sub. Enemy will outdrill me, my sub
    // dies — and the saboteur's parting shot sends the enemy home.
    const sab = createSpecialist(w, me, 'saboteur', {
      kind: 'outpost',
      id: mine.id,
    });
    const mySubId = issueLaunchOrder(w, {
      ownerId: me,
      sourceId: mine.id,
      destinationId: theirs.id,
      drillers: 5,
      specialistIds: [sab.id],
    });
    const theirSubId = issueLaunchOrder(w, {
      ownerId: enemy,
      sourceId: theirs.id,
      destinationId: mine.id,
      drillers: 25,
    });
    const mySub = w.subs.find((s) => s.id === mySubId)!;
    const theirSub = w.subs.find((s) => s.id === theirSubId)!;
    const originalEnemyDest = theirSub.destinationId;

    const meet = mirrorEncounterTime(mySub, theirSub);
    expect(meet).not.toBeNull();
    tick(w, meet! + 1 - w.time);

    // My sub is gone (lost the driller phase).
    expect(w.subs.find((s) => s.id === mySubId)).toBeUndefined();
    // Enemy survived with the driller delta.
    const theirSubAfter = w.subs.find((s) => s.id === theirSubId)!;
    expect(theirSubAfter).toBeDefined();
    expect(theirSubAfter.drillers).toBe(25 - 5);
    // Enemy redirected to one of THEIR own outposts (sent home).
    expect(theirSubAfter.destinationId).not.toBe(originalEnemyDest);
    const newDest = w.outposts.find((o) => o.id === theirSubAfter.destinationId);
    expect(newDest?.ownerId).toBe(enemy);
    // Event emitted, visible to both, mentions the saboteur.
    const sabEvent = w.events.find(
      (e) =>
        e.kind === 'combat_sub_vs_sub' &&
        e.summary.toLowerCase().includes('saboteur'),
    );
    expect(sabEvent).toBeDefined();
    expect(sabEvent!.visibleTo).toContain(me);
    expect(sabEvent!.visibleTo).toContain(enemy);
  });

  it('does nothing if the saboteur side WINS the driller phase', () => {
    const w = generateWorld({ seed: 41, playerCount: 4 });
    const me = w.players[0]!.id;
    const enemy = w.players[1]!.id;
    const mine = w.outposts.find(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id),
    )!;
    const theirs = w.outposts.find(
      (o) => o.ownerId === enemy && !hasQueenAt(w, o.id),
    )!;
    (mine as { drillers: number }).drillers = 100;
    (theirs as { drillers: number }).drillers = 100;
    // I'm dominant — saboteur on my winning sub has no opposing
    // survivor to redirect.
    const sab = createSpecialist(w, me, 'saboteur', {
      kind: 'outpost',
      id: mine.id,
    });
    const mySubId = issueLaunchOrder(w, {
      ownerId: me,
      sourceId: mine.id,
      destinationId: theirs.id,
      drillers: 30,
      specialistIds: [sab.id],
    });
    const theirSubId = issueLaunchOrder(w, {
      ownerId: enemy,
      sourceId: theirs.id,
      destinationId: mine.id,
      drillers: 5,
    });
    const mySub = w.subs.find((s) => s.id === mySubId)!;
    const theirSub = w.subs.find((s) => s.id === theirSubId)!;
    const myOriginalDest = mySub.destinationId;
    const meet = mirrorEncounterTime(mySub, theirSub);
    tick(w, meet! + 1 - w.time);

    // Enemy is gone (lost). My sub continues — NOT redirected.
    expect(w.subs.find((s) => s.id === theirSubId)).toBeUndefined();
    const mySubAfter = w.subs.find((s) => s.id === mySubId)!;
    expect(mySubAfter).toBeDefined();
    expect(mySubAfter.destinationId).toBe(myOriginalDest);
    // No saboteur event — the saboteur didn't fire (no survivor to redirect).
    const sabEvent = w.events.find(
      (e) =>
        e.kind === 'combat_sub_vs_sub' &&
        e.summary.toLowerCase().includes('saboteur'),
    );
    expect(sabEvent).toBeUndefined();
  });
});
