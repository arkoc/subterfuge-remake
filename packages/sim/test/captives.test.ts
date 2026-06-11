import { describe, expect, it } from 'vitest';
import { generateWorld } from '../src/world-gen.js';
import { issueLaunchOrder } from '../src/orders.js';
import { tick } from '../src/tick.js';
import {
  processCaptiveActions,
  transferCaptivesOnCapture,
} from '../src/captives.js';
import {
  activeQueenOf,
  createSpecialist,
  hasQueenAt,
  queenOutpostOf,
} from '../src/specialists.js';

function captureSetup(seed = 7) {
  const w = generateWorld({ seed, playerCount: 4 });
  const a = w.players[0]!.id;
  const b = w.players[1]!.id;
  const aSrc = w.outposts.find((o) => o.ownerId === a && !hasQueenAt(w, o.id))!;
  const bSite = w.outposts.find((o) => o.ownerId === b && !hasQueenAt(w, o.id))!;
  aSrc.drillers = 200;
  bSite.drillers = 10;
  bSite.shieldCharge = 0;
  bSite.shieldChargedSince = Number.MAX_SAFE_INTEGER;
  return { w, a, b, aSrc, bSite };
}

describe('capture phase produces captives', () => {
  it('losing specialists become captives held by the winner', () => {
    const { w, a, b, aSrc, bSite } = captureSetup();
    const def = createSpecialist(w, b, 'helmsman', { kind: 'outpost', id: bSite.id });
    issueLaunchOrder(w, {
      ownerId: a, sourceId: aSrc.id, destinationId: bSite.id, drillers: 30,
    });
    const sub = w.subs[w.subs.length - 1]!;
    tick(w, sub.arrivalAt - w.time);
    expect(def.state).toBe('captive');
    expect(def.captiveOf).toBe(a);
    expect(def.location).toEqual({ kind: 'outpost', id: bSite.id });
  });
});

describe('Hypnotist conversion', () => {
  it('converts a captive at the Hypnotist outpost to the Hypnotist owner', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const queenAt = queenOutpostOf(w, a)!;
    // Player a has a Hypnotist at their queen outpost.
    createSpecialist(w, a, 'hypnotist', { kind: 'outpost', id: queenAt });
    // Spawn a captive specialist held by a, originally from b.
    const captive = createSpecialist(w, b, 'helmsman', {
      kind: 'outpost',
      id: queenAt,
    });
    captive.state = 'captive';
    captive.captiveOf = a;
    processCaptiveActions(w, w.time);
    expect(captive.state).toBe('active');
    expect(captive.ownerId).toBe(a);
    expect(captive.captiveOf).toBeUndefined();
  });

  it('demotes a converted Queen to Princess when the new owner already has a Queen', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const queenAt = queenOutpostOf(w, a)!;
    createSpecialist(w, a, 'hypnotist', { kind: 'outpost', id: queenAt });
    // b's Queen captured by a and held at a's queen outpost.
    const bQueen = activeQueenOf(w, b)!;
    bQueen.location = { kind: 'outpost', id: queenAt };
    bQueen.state = 'captive';
    bQueen.captiveOf = a;
    processCaptiveActions(w, w.time);
    // bQueen now owned by a but demoted to Princess (a already has a Queen).
    expect(bQueen.ownerId).toBe(a);
    expect(bQueen.kind).toBe('princess');
    expect(bQueen.state).toBe('active');
  });
});

describe('Diplomat release', () => {
  it('releases own captives in sonar range via a 1× home-bound sub', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    // a is the original owner; b holds the captive at b's outpost.
    // To put the captive within a Diplomat's sonar range we put
    // both Diplomat (at one of a's outposts) and b's holding outpost
    // close together — we use the existing world's player-0 and
    // player-1 outposts which are placed nearby in world-gen.
    const aDiplomatSite = w.outposts.find((o) => o.ownerId === a)!;
    const bHolding = w.outposts.find((o) => o.ownerId === b)!;
    createSpecialist(w, a, 'diplomat', { kind: 'outpost', id: aDiplomatSite.id });
    // Spawn a captive: originally a's, held by b.
    const captive = createSpecialist(w, a, 'helmsman', {
      kind: 'outpost',
      id: bHolding.id,
    });
    captive.state = 'captive';
    captive.captiveOf = b;
    // Use a giant sonar — give a 50 IO levels so range is huge.
    for (let i = 0; i < 50; i++) {
      createSpecialist(w, a, 'intelligence_officer', { kind: 'outpost', id: aDiplomatSite.id });
    }
    const subsBefore = w.subs.length;
    processCaptiveActions(w, w.time);
    expect(captive.state).toBe('active');
    expect(captive.captiveOf).toBeUndefined();
    expect(w.subs.length).toBe(subsBefore + 1);
    const newSub = w.subs[w.subs.length - 1]!;
    expect(newSub.ownerId).toBe(a);
    expect(newSub.giftTo).toBe(a);
    expect(captive.location).toEqual({ kind: 'sub', id: newSub.id });
  });

  it('Diplomat preempts enemy Hypnotist at the same outpost', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const bHolding = w.outposts.find((o) => o.ownerId === b)!;
    // b has a Hypnotist at their outpost; a has a Diplomat nearby
    // with a giant sonar via IO stacking so the captive is in range.
    createSpecialist(w, b, 'hypnotist', { kind: 'outpost', id: bHolding.id });
    const aDiplomatSite = w.outposts.find((o) => o.ownerId === a)!;
    createSpecialist(w, a, 'diplomat', { kind: 'outpost', id: aDiplomatSite.id });
    for (let i = 0; i < 100; i++) {
      createSpecialist(w, a, 'intelligence_officer', { kind: 'outpost', id: aDiplomatSite.id });
    }
    // a's captive held by b.
    const captive = createSpecialist(w, a, 'helmsman', {
      kind: 'outpost',
      id: bHolding.id,
    });
    captive.state = 'captive';
    captive.captiveOf = b;
    processCaptiveActions(w, w.time);
    // Diplomat won: captive is back with a (on a release sub), not converted to b.
    expect(captive.ownerId).toBe(a);
    expect(captive.state).toBe('active');
    expect(captive.location.kind).toBe('sub');
  });
});

describe('transferCaptivesOnCapture', () => {
  it('transfers captives to the new outpost owner', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const c = w.players[2]!.id;
    const out = w.outposts.find((o) => o.ownerId === b)!;
    // c's captive held by b at this outpost.
    const captive = createSpecialist(w, c, 'helmsman', { kind: 'outpost', id: out.id });
    captive.state = 'captive';
    captive.captiveOf = b;
    out.ownerId = a; // attacker captured the outpost
    transferCaptivesOnCapture(w, out, a);
    expect(captive.state).toBe('captive');
    expect(captive.captiveOf).toBe(a);
  });

  it('frees captives whose original owner is the new outpost owner', () => {
    const w = generateWorld({ seed: 7, playerCount: 4 });
    const a = w.players[0]!.id;
    const b = w.players[1]!.id;
    const out = w.outposts.find((o) => o.ownerId === b)!;
    // a's captive held by b at this outpost.
    const captive = createSpecialist(w, a, 'helmsman', { kind: 'outpost', id: out.id });
    captive.state = 'captive';
    captive.captiveOf = b;
    out.ownerId = a; // a recaptures
    transferCaptivesOnCapture(w, out, a);
    expect(captive.state).toBe('active');
    expect(captive.captiveOf).toBeUndefined();
  });
});
