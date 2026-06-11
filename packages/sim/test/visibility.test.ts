import { describe, expect, it } from 'vitest';
import { hasQueenAt } from '../src/specialists.js';
import { generateWorld } from '../src/world-gen.js';
import {
  outpostsInSonarOf,
  subsInSonarOf,
  viewForPlayer,
} from '../src/visibility.js';
import { issueLaunchOrder } from '../src/orders.js';
import { tick } from '../src/tick.js';
import { SONAR_RANGE } from '../src/types.js';
import { dist } from '../src/geometry.js';

describe('outpostsInSonarOf', () => {
  it('includes all of your own outposts', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const visible = outpostsInSonarOf(w, me);
    for (const o of w.outposts) {
      if (o.ownerId === me) {
        expect(visible.has(o.id)).toBe(true);
      }
    }
  });

  it('includes outposts within SONAR_RANGE of any owned outpost', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const visible = outpostsInSonarOf(w, me);
    const ownedPositions = w.outposts
      .filter((o) => o.ownerId === me)
      .map((o) => o.pos);
    for (const o of w.outposts) {
      if (o.ownerId === me) continue;
      const isClose = ownedPositions.some((p) => dist(p, o.pos) <= SONAR_RANGE);
      if (isClose) {
        expect(visible.has(o.id)).toBe(true);
      }
    }
  });

  it('excludes outposts far from every owned outpost', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const visible = outpostsInSonarOf(w, me);
    const ownedPositions = w.outposts
      .filter((o) => o.ownerId === me)
      .map((o) => o.pos);
    let foundFar = false;
    for (const o of w.outposts) {
      if (o.ownerId === me) continue;
      const minDist = Math.min(...ownedPositions.map((p) => dist(p, o.pos)));
      if (minDist > SONAR_RANGE) {
        expect(visible.has(o.id)).toBe(false);
        foundFar = true;
      }
    }
    // Sanity: on a 10000-unit map with player-count 4, *something* should
    // be out of range.
    expect(foundFar).toBe(true);
  });
});

describe('subsInSonarOf', () => {
  it('always includes your own subs regardless of position', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const source = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const target = w.outposts.find((o) => o.ownerId === null)!;
    issueLaunchOrder(w, {
      ownerId: me,
      sourceId: source.id,
      destinationId: target.id,
      drillers: 5,
    });
    const sub = w.subs[0]!;
    const visible = subsInSonarOf(w, me, w.time);
    expect(visible.has(sub.id as unknown as number)).toBe(true);
  });

  it('excludes a hostile sub far from any owned outpost', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const them = w.players[1]!.id;
    const me = w.players[0]!.id;
    // Have player B launch a sub between two of B's outposts. The path
    // is presumably outside A's sonar (B and A are on opposite sides
    // of the map by world-gen's circular placement).
    const src = w.outposts.find((o) => o.ownerId === them && !hasQueenAt(w, o.id))!;
    const dst = w.outposts.find(
      (o) => o.ownerId === them && o.id !== src.id,
    )!;
    issueLaunchOrder(w, {
      ownerId: them,
      sourceId: src.id,
      destinationId: dst.id,
      drillers: 5,
    });
    const visibleForA = subsInSonarOf(w, me, w.time);
    expect(visibleForA.size).toBe(0);
  });
});

describe('viewForPlayer', () => {
  it('preserves time/winnerId, redacts the seed and other players\' hire RNG', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const v = viewForPlayer(w, me);
    expect(v.time).toBe(w.time);
    expect(v.winnerId).toBe(w.winnerId);
    // The seed must never reach a client — combined with a player id
    // it derives that player's entire hire-offer stream.
    expect(v.seed).toBe(0);
    // Own record intact; everyone else's hire-RNG state zeroed.
    expect(v.players[0]).toBe(w.players[0]);
    for (const p of v.players.slice(1)) {
      expect(p.hireSeed).toBe(0);
      expect(p.hireIndex).toBe(0);
      expect(p.lastOfferedKinds).toEqual([]);
    }
  });

  it('returns every outpost; sonar ones clear, others fogged', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const v = viewForPlayer(w, me);
    const visible = outpostsInSonarOf(w, me);
    // Outpost positions/kinds/owners are common knowledge — every
    // outpost appears in the view, fog applies to internals only.
    expect(v.outposts).toHaveLength(w.outposts.length);
    for (const o of v.outposts) {
      if (visible.has(o.id)) {
        expect(o.fogged).toBeUndefined();
      } else {
        expect(o.fogged).toBe(true);
      }
    }
  });

  it('fogged outposts preserve location + owner, redact everything else', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    // Make a non-Queen outpost far from player 0 with rich state to
    // verify all of it gets redacted.
    const them = w.players[1]!.id;
    const theirOutpost = w.outposts.find((o) => o.ownerId === them && !hasQueenAt(w, o.id))!;
    theirOutpost.drillers = 99;
    theirOutpost.shieldCharge = 10;
    const me = w.players[0]!.id;
    // Force discovery so the fogged outpost appears in the view.
    w.players[me as unknown as number]!.knownOutposts.push(
      theirOutpost.id as unknown as number,
    );
    const v = viewForPlayer(w, me);
    const fogged = v.outposts.find((o) => o.id === theirOutpost.id);
    expect(fogged).toBeDefined();
    expect(fogged!.fogged).toBe(true);
    // Preserved
    expect(fogged!.pos).toEqual(theirOutpost.pos);
    expect(fogged!.ownerId).toBe(them);
    expect(fogged!.name).toBe(theirOutpost.name);
    // Redacted
    expect(fogged!.drillers).toBe(0);
    expect(fogged!.shieldCharge).toBe(0);
  });

  it('persists discovery — once an outpost enters sonar it stays in the view forever', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const them = w.players[2]!.id;
    // Force the enemy outpost into me's knownOutposts as if I'd
    // observed it once at game start.
    const enemy = w.outposts.find((o) => o.ownerId === them)!;
    w.players[me as unknown as number]!.knownOutposts.push(
      enemy.id as unknown as number,
    );
    const v = viewForPlayer(w, me);
    expect(v.outposts.find((o) => o.id === enemy.id)).toBeDefined();
  });

  it('filters subs to visible ones only', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const me = w.players[0]!.id;
    const them = w.players[1]!.id;
    // Player A launches their own sub.
    const mySrc = w.outposts.find((o) => o.ownerId === me && !hasQueenAt(w, o.id))!;
    const myDst = w.outposts.find((o) => o.ownerId === null)!;
    issueLaunchOrder(w, {
      ownerId: me,
      sourceId: mySrc.id,
      destinationId: myDst.id,
      drillers: 3,
    });
    // Player B launches their own sub far away.
    const theirSrc = w.outposts.find((o) => o.ownerId === them && !hasQueenAt(w, o.id))!;
    const theirDst = w.outposts.find(
      (o) => o.ownerId === them && o.id !== theirSrc.id,
    )!;
    issueLaunchOrder(w, {
      ownerId: them,
      sourceId: theirSrc.id,
      destinationId: theirDst.id,
      drillers: 3,
    });
    // Tick a bit so subs are in flight (past 10-min queue).
    tick(w, 11 * 60 * 1000);
    const view = viewForPlayer(w, me);
    expect(view.subs.length).toBe(1);
    expect(view.subs[0]!.ownerId).toBe(me);
  });
});
