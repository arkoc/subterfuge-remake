import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { subPosition, travelTimeBetween, virtualDestination } from '../src/subs.js';
import {
  BASE_MS_PER_UNIT,
  MAP_SIZE,
  type Outpost,
  type OutpostId,
  type Sub,
  type SubId,
  type PlayerId,
} from '../src/types.js';

function makeSub(id: number, src: OutpostId, dst: OutpostId, launchAt: number, arrivalAt: number): Sub {
  return {
    id: id as SubId,
    ownerId: 0 as PlayerId,
    sourceId: src,
    destinationId: dst,
    launchAt,
    arrivalAt,
    drillers: 10,
    speedMultiplier: 1.0,
  };
}

describe('toroidal travel', () => {
  it('travelTimeBetween uses the shorter wrap path', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const a = w.outposts[0]!;
    // Synthesize a second outpost on the opposite side, same y.
    const b: Outpost = { ...a, id: 999 as OutpostId, pos: { x: MAP_SIZE - a.pos.x, y: a.pos.y } };
    const linearDx = b.pos.x - a.pos.x; // could be large
    const torusDx = Math.min(Math.abs(linearDx), MAP_SIZE - Math.abs(linearDx));
    const expected = Math.round(torusDx * BASE_MS_PER_UNIT);
    expect(travelTimeBetween(a, b)).toBe(expected);
  });

  it('subPosition wraps when the shortest path crosses an edge', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const a = w.outposts[0]!;
    // Synthesize the situation by adding an opposite-edge outpost
    // and a sub between them with controlled times.
    const farId = 998 as OutpostId;
    const far: Outpost = {
      ...a,
      id: farId,
      pos: { x: (a.pos.x + MAP_SIZE - 500) % MAP_SIZE, y: a.pos.y },
    };
    w.outposts.push(far);
    const launchAt = 0;
    const arrivalAt = 1000;
    const sub = makeSub(1, a.id, farId, launchAt, arrivalAt);
    w.subs.push(sub);

    // The torus delta from a → far should be small and negative (going left
    // by 500), so at t=0.5 the sub is at x = (a.pos.x - 250 + MAP_SIZE) % MAP_SIZE.
    const expectedHalfwayX = ((a.pos.x - 250) + MAP_SIZE) % MAP_SIZE;
    const pos = subPosition(w, sub, 500);
    expect(Math.abs(pos.x - expectedHalfwayX)).toBeLessThanOrEqual(1);
  });

  it('virtualDestination flips when wrap is shorter', () => {
    const src = { x: 9500, y: 5000 };
    const dst = { x: 200, y: 5000 };
    const v = virtualDestination(src, dst);
    expect(v.x).toBe(9500 + 700); // 10200 — past the right edge, the wrapped position
    expect(v.y).toBe(5000);
  });
});
