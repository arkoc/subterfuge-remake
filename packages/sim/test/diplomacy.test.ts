import { describe, expect, it } from 'vitest';
import { hasQueenAt } from '../src/specialists.js';
import { generateWorld } from '../src/world-gen.js';
import { appendMessage, messagesVisibleTo } from '../src/diplomacy.js';
import { issueLaunchOrder } from '../src/orders.js';
import { tick } from '../src/tick.js';
import { type PlayerId } from '../src/types.js';

describe('chat', () => {
  it('appends a global message', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const m = appendMessage(w, { from: 0 as PlayerId, to: null, text: 'hello' });
    expect(w.messages).toHaveLength(1);
    expect(m.from).toBe(0);
    expect(m.to).toBeNull();
    expect(m.text).toBe('hello');
  });

  it('rejects empty / oversize text', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    expect(() =>
      appendMessage(w, { from: 0 as PlayerId, to: null, text: '   ' }),
    ).toThrow();
    expect(() =>
      appendMessage(w, { from: 0 as PlayerId, to: null, text: 'x'.repeat(501) }),
    ).toThrow();
  });

  it('filters DMs to participants only', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    appendMessage(w, { from: 0 as PlayerId, to: null, text: 'g' });
    appendMessage(w, { from: 0 as PlayerId, to: 1 as PlayerId, text: 'private' });
    appendMessage(w, { from: 2 as PlayerId, to: 3 as PlayerId, text: 'other' });
    const view0 = messagesVisibleTo(w, 0 as PlayerId);
    expect(view0.map((m) => m.text)).toEqual(['g', 'private']);
    const view2 = messagesVisibleTo(w, 2 as PlayerId);
    expect(view2.map((m) => m.text)).toEqual(['g', 'other']);
  });
});

describe('gift subs', () => {
  it('arrives at recipient outpost without combat', () => {
    const w = generateWorld({ seed: 1, playerCount: 4 });
    const a = 0 as PlayerId;
    const b = 1 as PlayerId;
    const source = w.outposts.find((o) => o.ownerId === a && !hasQueenAt(w, o.id))!;
    const target = w.outposts.find((o) => o.ownerId === b && !hasQueenAt(w, o.id))!;
    const beforeDrillers = target.drillers;
    issueLaunchOrder(w, {
      ownerId: a,
      sourceId: source.id,
      destinationId: target.id,
      drillers: 5,
      giftTo: b,
    });
    const sub = w.subs[0]!;
    tick(w, sub.arrivalAt - w.time);
    expect(target.ownerId).toBe(b); // unchanged — no combat
    expect(target.drillers).toBe(beforeDrillers + 5);
    expect(w.subs).toHaveLength(0);
  });
});
