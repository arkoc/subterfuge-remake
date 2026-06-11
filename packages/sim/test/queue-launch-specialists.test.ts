import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { queueLaunch, dispatchQueuedOrder } from '../src/queued-orders.js';
import { createSpecialist, hasQueenAt } from '../src/specialists.js';
import { tick } from '../src/tick.js';
import { HOUR_MS } from '../src/types.js';

/**
 * Regression: a queued launch carrying a specialist that's currently
 * in-flight (arriving at the source before the queue fires) must
 * succeed at dispatch time. Before this fix, `QueuedLaunchOrder` had
 * no `specialistIds` field at all, so the queue silently dropped them.
 */
describe('queueLaunch specialistIds plumbing', () => {
  it('carries specialistIds through to dispatch', () => {
    const w = generateWorld({ seed: 91, playerCount: 4 });
    const me = w.players[0]!.id;
    // Need two of my outposts: a "home" the saboteur is travelling to,
    // and a "target" destination the queued launch will fire at.
    const myOutposts = w.outposts.filter(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id),
    );
    const home = myOutposts[0]!;
    const target = w.outposts.find((o) => o.ownerId !== me)!;
    // Stage drillers so the home outpost can launch later.
    (home as { drillers: number }).drillers = 100;
    // Create a saboteur away from home (we want it to NOT be at home
    // when we queue, so the lazy-validation test is meaningful).
    const remote = myOutposts[1]!;
    (remote as { drillers: number }).drillers = 50;
    const sab = createSpecialist(w, me, 'saboteur', {
      kind: 'outpost',
      id: remote.id,
    });
    // Launch the saboteur on a sub from remote → home. After arrival
    // the specialist will be physically at home.
    const subId = issueLaunchOrder(w, {
      ownerId: me,
      sourceId: remote.id,
      destinationId: home.id,
      drillers: 5,
      specialistIds: [sab.id],
    });
    const sub = w.subs.find((s) => s.id === subId)!;
    expect(sub).toBeDefined();
    const subArrivalAt = sub.arrivalAt;
    // Queue a launch from home → target that fires AFTER the
    // saboteur arrives, and asks to load that saboteur as cargo.
    const queueAt = subArrivalAt + 1 * HOUR_MS;
    queueLaunch(w, {
      executeAt: queueAt,
      ownerId: me,
      sourceId: home.id,
      destinationId: target.id,
      drillers: 10,
      specialistIds: [sab.id],
    });
    // Tick to just before the queue fires. The saboteur should now be
    // at home (arrived via its carrying sub).
    tick(w, queueAt - 1 - w.time);
    const sabBefore = w.specialists.find(
      (s) => (s.id as unknown as number) === (sab.id as unknown as number),
    )!;
    expect(sabBefore.location.kind).toBe('outpost');
    if (sabBefore.location.kind === 'outpost') {
      expect(sabBefore.location.id).toBe(home.id);
    }
    // Dispatch the queue order — should succeed and the saboteur
    // should now be aboard a new outbound sub.
    const order = w.queuedOrders[0]!;
    const result = dispatchQueuedOrder(w, order);
    expect(result.ok).toBe(true);
    const sabAfter = w.specialists.find(
      (s) => (s.id as unknown as number) === (sab.id as unknown as number),
    )!;
    expect(sabAfter.location.kind).toBe('sub');
  });

  it('drops a queue order whose specialist never arrived at the source', () => {
    const w = generateWorld({ seed: 91, playerCount: 4 });
    const me = w.players[0]!.id;
    const myOutposts = w.outposts.filter(
      (o) => o.ownerId === me && !hasQueenAt(w, o.id),
    );
    const home = myOutposts[0]!;
    const remote = myOutposts[1]!;
    const target = w.outposts.find((o) => o.ownerId !== me)!;
    (home as { drillers: number }).drillers = 100;
    // Saboteur sits at remote — never moves to home. Queueing a
    // launch from home that asks for this saboteur should dispatch
    // unsuccessfully (silent drop) when the queue fires.
    const sab = createSpecialist(w, me, 'saboteur', {
      kind: 'outpost',
      id: remote.id,
    });
    queueLaunch(w, {
      executeAt: w.time + 1 * HOUR_MS,
      ownerId: me,
      sourceId: home.id,
      destinationId: target.id,
      drillers: 10,
      specialistIds: [sab.id],
    });
    const order = w.queuedOrders[0]!;
    const result = dispatchQueuedOrder(w, order);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('not at the source outpost');
  });
});
